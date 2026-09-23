// The document as data, outside the editor: what the object reads from its Yjs XML, and what
// the public page, print, slides, export, and search use. Plain data, so it crosses RPC and JSON.

export type Inline = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; href?: string }
export type Block = {
  type: string
  props: {
    level?: number; checked?: boolean; language?: string; url?: string; caption?: string
    // task: its id, who, when, done. decision: its id, status, number.
    taskId?: string; assignee?: string; assigneeName?: string; due?: string; done?: boolean
    decisionId?: string; status?: string; number?: number
  }
  content: Inline[]
  rows?: Inline[][][] // tables: rows of cells of inline content
  children: Block[]
}

export const inlineText = (content: Inline[]) => content.map((i) => i.text).join('')

// Links keep only safe targets: the web, mail, or a path on this site.
export const safeHref = (href: unknown) => {
  const h = String(href ?? '').trim()
  return /^(https?:|mailto:)/i.test(h) || (h.startsWith('/') && !h.startsWith('//')) ? h : undefined
}

const md = (content: Inline[]) => content.map((i) => {
  if (i.code) return '`' + i.text + '`'
  let t = i.text.replace(/([\\*_`[\]])/g, '\\$1')
  if (!t.trim()) return t
  if (i.bold) t = `**${t}**`
  if (i.italic) t = `_${t}_`
  if (i.strike) t = `~~${t}~~`
  return i.href ? `[${t}](${i.href})` : t
}).join('')

// " (@Bea, due 2026-10-01)" after a task, when it has either.
export const taskMeta = (b: Block) => {
  const bits = [b.props.assigneeName && `@${b.props.assigneeName}`, b.props.due && `due ${b.props.due}`].filter(Boolean)
  return bits.length ? ` (${bits.join(', ')})` : ''
}

export const toMarkdown = (blocks: Block[], depth = 0): string => {
  const pad = '  '.repeat(depth)
  let n = 0
  return blocks.map((b) => {
    n = b.type === 'numberedListItem' ? n + 1 : 0
    const text = md(b.content)
    const kids = b.children.length ? '\n' + toMarkdown(b.children, depth + 1) : ''
    switch (b.type) {
      case 'heading': return `${'#'.repeat(b.props.level ?? 1)} ${text}`
      case 'bulletListItem': return `${pad}- ${text}${kids}`
      case 'numberedListItem': return `${pad}${n}. ${text}${kids}`
      case 'checkListItem': return `${pad}- [${b.props.checked ? 'x' : ' '}] ${text}${kids}`
      case 'quote': return `> ${text}`
      case 'codeBlock': return '```' + (b.props.language ?? '') + '\n' + inlineText(b.content) + '\n```'
      case 'image': return `![${b.props.caption ?? ''}](${b.props.url ?? ''})`
      case 'task': return `${pad}- [${b.props.done ? 'x' : ' '}] ${text}${taskMeta(b)}${kids}`
      case 'decision': return `> **D-${b.props.number || '?'}** (${b.props.status ?? 'proposed'}): ${text}`
      case 'table': {
        const rows = (b.rows ?? []).map((r) => `| ${r.map(md).join(' | ')} |`)
        return rows.length ? [rows[0], `|${' --- |'.repeat(b.rows![0].length)}`, ...rows.slice(1)].join('\n') : ''
      }
      default: return `${pad}${text}${kids}`
    }
  }).join(depth ? '\n' : '\n\n')
}

export const toText = (blocks: Block[]): string =>
  blocks.map((b) => [b.type === 'table' ? (b.rows ?? []).map((r) => r.map(inlineText).join('\t')).join('\n') : inlineText(b.content), toText(b.children)].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')

export type Slide = { blocks: Block[]; notes: string[] }

// One slide per level-1 heading; level 2 when there is no level 1; else the whole document.
// A paragraph that starts with "Note:" is a speaker note.
export const toSlides = (blocks: Block[]): Slide[] => {
  const levels = blocks.filter((b) => b.type === 'heading').map((b) => b.props.level ?? 1)
  const at = levels.includes(1) ? 1 : levels.includes(2) ? 2 : 0
  const slides: Slide[] = []
  for (const b of blocks) {
    if (!slides.length || (at && b.type === 'heading' && b.props.level === at)) slides.push({ blocks: [], notes: [] })
    const text = inlineText(b.content)
    if (b.type === 'paragraph' && /^note:/i.test(text)) slides.at(-1)!.notes.push(text.replace(/^note:\s*/i, ''))
    else slides.at(-1)!.blocks.push(b)
  }
  return slides.filter((s) => s.blocks.length || s.notes.length)
}

// Images and links inside this site are stored as paths. Files that leave the site need full URLs.
export const withOrigin = (blocks: Block[], origin: string): Block[] => {
  const abs = (u?: string) => (u?.startsWith('/') ? origin + u : u)
  const fix = (content: Inline[]) => content.map((i) => (i.href ? { ...i, href: abs(i.href) } : i))
  return blocks.map((b) => ({ ...b, props: { ...b.props, url: abs(b.props.url) }, content: fix(b.content), rows: b.rows?.map((r) => r.map(fix)), children: withOrigin(b.children, origin) }))
}
