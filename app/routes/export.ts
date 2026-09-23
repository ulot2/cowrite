import { requireDocument } from '~/lib/access.server'
import { docStub } from '~/lib/versions.server'
import { inlineText, toMarkdown, toText, withOrigin, type Block, type Inline } from '~/lib/rich'
import type { Route } from './+types/export'

// /doc/:id/export?format=md|txt|docx — a download of the document as it is now.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { document } = await requireDocument(request, params.id)
  const blocks = withOrigin((await docStub(params.id).readRich('now')) ?? [], new URL(request.url).origin)
  const format = new URL(request.url).searchParams.get('format')
  const name = document.title.replace(/[^\w\- ]+/g, '').trim() || 'document'
  const download = (body: BodyInit, type: string, ext: string) =>
    new Response(body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}.${ext}"` } })

  if (format === 'md') return download(`# ${document.title}\n\n${toMarkdown(blocks)}\n`, 'text/markdown; charset=utf-8', 'md')
  if (format === 'txt') return download(`${document.title}\n\n${toText(blocks)}\n`, 'text/plain; charset=utf-8', 'txt')
  if (format === 'docx') return download(await toWord(document.title, blocks), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx')
  throw new Response('Unknown format', { status: 400 })
}

// A Word file from the tree. Loaded on first use, so only a Word export pays for the library.
const toWord = async (title: string, blocks: Block[]) => {
  const d = await import('docx')
  const runs = (content: Inline[]) => content.map((i) => {
    const run = new d.TextRun({ text: i.text, bold: i.bold, italics: i.italic, strike: i.strike, underline: i.underline || i.href ? {} : undefined, font: i.code ? 'Consolas' : undefined })
    return i.href ? new d.ExternalHyperlink({ link: i.href, children: [run] }) : run
  })
  const headings = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3]
  const out: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = []
  const walk = (list: Block[], level: number) => {
    for (const b of list) {
      switch (b.type) {
        case 'heading': out.push(new d.Paragraph({ heading: headings[Math.min((b.props.level ?? 1) - 1, 2)], children: runs(b.content) })); break
        case 'bulletListItem': out.push(new d.Paragraph({ bullet: { level }, children: runs(b.content) })); break
        case 'numberedListItem': out.push(new d.Paragraph({ numbering: { reference: 'numbers', level }, children: runs(b.content) })); break
        case 'checkListItem': out.push(new d.Paragraph({ bullet: { level }, children: [new d.TextRun(b.props.checked ? '☑ ' : '☐ '), ...runs(b.content)] })); break
        case 'quote': out.push(new d.Paragraph({ indent: { left: 720 }, children: runs(b.content) })); break
        case 'codeBlock': out.push(...inlineText(b.content).split('\n').map((line) => new d.Paragraph({ children: [new d.TextRun({ text: line, font: 'Consolas' })] }))); break
        case 'image': out.push(new d.Paragraph({ children: [new d.ExternalHyperlink({ link: b.props.url ?? '', children: [new d.TextRun({ text: b.props.caption || 'Image', style: 'Hyperlink' })] })] })); break
        case 'table': out.push(new d.Table({ rows: (b.rows ?? []).map((row) => new d.TableRow({ children: row.map((cell) => new d.TableCell({ children: [new d.Paragraph({ children: runs(cell) })] })) })) })); break
        default: out.push(new d.Paragraph({ children: runs(b.content) }))
      }
      if (b.children.length) walk(b.children, level + 1)
    }
  }
  walk(blocks, 0)
  const doc = new d.Document({
    title,
    numbering: { config: [{ reference: 'numbers', levels: [0, 1, 2, 3].map((level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) }] },
    sections: [{ children: [new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(title)] }), ...out] }],
  })
  return new Uint8Array(await d.Packer.toArrayBuffer(doc))
}
