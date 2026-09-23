import type { Block, Inline } from '~/lib/rich'

// The document as a page. React escapes every string, and links were filtered when the tree was
// read, so a published page cannot carry a script.
function Text({ content }: { content: Inline[] }) {
  return content.map((i, n) => {
    let el: React.ReactNode = i.text
    if (i.code) el = <code>{el}</code>
    if (i.bold) el = <strong>{el}</strong>
    if (i.italic) el = <em>{el}</em>
    if (i.underline) el = <u>{el}</u>
    if (i.strike) el = <s>{el}</s>
    if (i.href) el = <a href={i.href} target="_blank" rel="noopener noreferrer">{el}</a>
    return <span key={n}>{el}</span>
  })
}

const listTag = { bulletListItem: 'ul', numberedListItem: 'ol', checkListItem: 'ul' } as const
type ListType = keyof typeof listTag

function One({ block }: { block: Block }) {
  const text = <Text content={block.content} />
  switch (block.type) {
    case 'heading': {
      const H = `h${Math.min(block.props.level ?? 1, 3)}` as 'h1'
      return <H>{text}</H>
    }
    case 'quote': return <blockquote>{text}</blockquote>
    case 'codeBlock': return <pre><code>{block.content.map((i) => i.text).join('')}</code></pre>
    case 'image': return block.props.url ? <figure><img src={block.props.url} alt={block.props.caption ?? ''} />{block.props.caption && <figcaption>{block.props.caption}</figcaption>}</figure> : null
    case 'table': return (
      <div className="read-table"><table><tbody>
        {(block.rows ?? []).map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><Text content={cell} /></td>)}</tr>)}
      </tbody></table></div>
    )
    // A <p> cannot hold blocks, so nested children sit in an indented box after it.
    default: return <><p>{text}</p>{block.children.length > 0 && <div className="read-indent"><Blocks blocks={block.children} /></div>}</>
  }
}

// Consecutive list items of one kind share a list element; their children nest inside the item.
export function Blocks({ blocks }: { blocks: Block[] }) {
  const out: React.ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const type = blocks[i].type
    if (!(type in listTag)) { out.push(<One key={i} block={blocks[i]} />); continue }
    const items: Block[] = []
    while (i < blocks.length && blocks[i].type === type) items.push(blocks[i++])
    i--
    const List = listTag[type as ListType]
    out.push(
      <List key={i} className={type === 'checkListItem' ? 'checks' : undefined}>
        {items.map((b, n) => (
          <li key={n}>
            {type === 'checkListItem' && <input type="checkbox" checked={!!b.props.checked} readOnly aria-label={b.props.checked ? 'Done' : 'Not done'} />}
            <Text content={b.content} />
            {b.children.length > 0 && <Blocks blocks={b.children} />}
          </li>
        ))}
      </List>,
    )
  }
  return out
}

export function ReadView({ blocks }: { blocks: Block[] }) {
  return <div className="read-view"><Blocks blocks={blocks} /></div>
}
