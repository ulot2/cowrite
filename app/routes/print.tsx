import { useEffect } from 'react'
import { requireDocument } from '~/lib/access.server'
import { docStub } from '~/lib/versions.server'
import { ReadView } from '~/components/read-view'
import type { Route } from './+types/print'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: loaderData?.title ?? 'Print' }]

// The document on a plain page with a print stylesheet. "Save as PDF" in the print dialog gives the PDF.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { document } = await requireDocument(request, params.id)
  return { title: document.title, blocks: (await docStub(params.id).readRich('now')) ?? [] }
}

export default function Print({ loaderData }: Route.ComponentProps) {
  useEffect(() => { const t = setTimeout(() => print(), 300); return () => clearTimeout(t) }, [])
  return (
    <main className="print-page">
      <p className="print-hint no-print">The print dialog opens by itself. Choose "Save as PDF" to keep a PDF. <button type="button" onClick={() => print()}>Print again</button></p>
      <h1 className="read-title">{loaderData.title}</h1>
      <ReadView blocks={loaderData.blocks} />
    </main>
  )
}
