import { Link } from 'react-router'
import { Icon } from './icon'

// Present and export. Plain links: the export route answers a file download, print opens its own page.
export function MoreMenu({ documentId }: { documentId: string }) {
  const file = (format: string) => `/doc/${documentId}/export?format=${format}`
  return (
    <details className="status-menu more-menu">
      <summary className="tool" aria-label="More: present and export"><Icon name="more" /></summary>
      <div className="popover">
        <Link className="button ghost" to={`/doc/${documentId}/present`}>Present</Link>
        <p className="menu-label">Export</p>
        <a className="button ghost" href={file('docx')} download>Word (.docx)</a>
        <a className="button ghost" href={file('md')} download>Markdown (.md)</a>
        <a className="button ghost" href={file('txt')} download>Plain text (.txt)</a>
        <a className="button ghost" href={`/doc/${documentId}/print`} target="_blank" rel="noopener">PDF (print)</a>
      </div>
    </details>
  )
}
