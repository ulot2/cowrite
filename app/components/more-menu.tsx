import { Link } from 'react-router'
import { Icon } from './icon'

// Export and present. Plain links: the export route answers a file download, print opens its own page.
export function MoreMenu({ documentId }: { documentId: string }) {
  const file = (format: string) => `/doc/${documentId}/export?format=${format}`
  return (
    <details className="status-menu more-menu">
      <summary className="tool" data-tip="Export or present"><Icon name="download" /><span className="tool-label">Export</span></summary>
      <div className="popover">
        <p className="menu-label">Download as</p>
        <a className="button ghost" href={file('docx')} download>Word (.docx)</a>
        <a className="button ghost" href={file('md')} download>Markdown (.md)</a>
        <a className="button ghost" href={file('txt')} download>Plain text (.txt)</a>
        <a className="button ghost" href={`/doc/${documentId}/print`} target="_blank" rel="noopener">PDF (print)</a>
        <p className="menu-label">Show</p>
        <Link className="button ghost" to={`/doc/${documentId}/present`}>Present as slides</Link>
      </div>
    </details>
  )
}
