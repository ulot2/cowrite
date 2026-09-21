import { Form, Link, redirect } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { getDocument, usersById } from '~/lib/db.server'
import { roleOnDocument } from '~/lib/access.server'
import { listDocumentEvents, logEvent } from '~/lib/events.server'
import { diffBlocks, docStub, type Block, type DiffRow } from '~/lib/versions.server'
import { atLeast } from '~/lib/roles'
import { timeAgo } from '~/lib/time'
import { Activity } from '~/components/activity'
import { Avatar } from '~/components/avatar'
import { Icon } from '~/components/icon'
import { colorFor } from '~/lib/color'
import type { Route } from './+types/history'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `History · ${loaderData?.document.title ?? 'Document'} · cowrite` }]

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const role = await roleOnDocument(user.id, params.id)
  const document = role && await getDocument(params.id)
  if (!role || !document) throw new Response('Not found', { status: 404 })

  const stub = docStub(params.id)
  const rows = await stub.listVersions()
  const people = new Map((await usersById(rows.map((v) => v.created_by).filter((id): id is string => !!id))).map((u) => [u.id, u.name]))
  const versions = rows.map((v) => ({ ...v, author: v.created_by ? people.get(v.created_by) ?? 'Someone' : null }))

  const url = new URL(request.url)
  const selected = versions.find((v) => v.id === Number(url.searchParams.get('v'))) ?? versions[0] ?? null
  const blocks = selected ? await stub.readVersion(selected.id) : null
  // ?against= is another version id, or "now" for the live document. The diff always reads old → new.
  const againstParam = url.searchParams.get('against')
  const against = againstParam === 'now' ? 'now' : versions.find((v) => v.id === Number(againstParam))?.id ?? null
  const other = against && selected ? await stub.readVersion(against) : null
  const olderFirst = against === 'now' || (against !== null && selected !== null && against > selected.id)
  const diff = blocks && other ? (olderFirst ? diffBlocks(blocks, other) : diffBlocks(other, blocks)) : null

  return { document, canEdit: atLeast(role, 'editor'), versions, selected, blocks, against, diff, events: await listDocumentEvents(params.id) }
}

// Save and restore need an editor. The role is checked here, not trusted from the page.
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  if (!atLeast(await roleOnDocument(user.id, params.id), 'editor')) throw new Response('Editors can save and restore versions', { status: 403 })
  const f = await request.formData()
  const stub = docStub(params.id)
  if (f.get('intent') === 'save') {
    const name = String(f.get('name') ?? '').trim().slice(0, 80)
    if (!name) return null
    const id = await stub.saveVersion(name, user.id)
    await logEvent(params.id, user.id, 'version', `saved the version “${name}”`)
    throw redirect(`/doc/${params.id}/history?v=${id}`)
  }
  if (f.get('intent') === 'restore') {
    const id = Number(f.get('id'))
    const version = (await stub.listVersions()).find((v) => v.id === id)
    if (!version || !(await stub.restoreVersion(id))) throw new Response('No such version', { status: 404 })
    await logEvent(params.id, user.id, 'restored', version.name ? `restored the version “${version.name}”` : 'restored an automatic version')
    throw redirect(`/doc/${params.id}`)
  }
  return null
}

// A version's blocks as plain headings and paragraphs. Formatting inside a block is not shown here.
function BlockView({ block }: { block: Block }) {
  const Tag = block.type === 'heading' ? (`h${Math.min(3, block.level ?? 1) + 2}` as 'h3') : 'p'
  return <Tag className={`vb vb-${block.type}`}>{block.type === 'image' ? 'Image' : block.text || ' '}</Tag>
}

const labels: Record<DiffRow['kind'], string> = { same: '', removed: 'Removed', added: 'Added' }

export default function History({ loaderData, params }: Route.ComponentProps) {
  const { document, canEdit, versions, selected, blocks, against, diff } = loaderData
  const changes = diff?.filter((r) => r.kind !== 'same').length ?? 0
  const n = versions.length
  return (
    <div className="page history">
      <div className="doc-bar">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/documents">Documents</Link><span aria-hidden="true">/</span><Link to={`/doc/${params.id}`}>{document.title}</Link><span aria-hidden="true">/</span><span>History</span></nav>
        <div className="doc-tools"><Link className="tool" to={`/doc/${params.id}`}><Icon name="back" /><span className="tool-label">Open the document</span></Link></div>
      </div>
      <header className="history-head">
        <p className="eyebrow">Version history</p>
        <h1>{document.title}</h1>
        <p className="muted">{n === 0 ? 'No versions yet' : n === 1 ? '1 version' : `${n} versions`} · a version is saved by itself every 30 minutes of editing</p>
      </header>

      <div className="history-layout">
        <aside className="versions" aria-label="Versions">
          {canEdit && (
            <Form method="post" className="save-version" key={n}> {/* remounts after a save, so the field clears */}
              <input type="hidden" name="intent" value="save" />
              <input name="name" placeholder="Name this version" aria-label="Name for the version" maxLength={80} required />
              <button className="primary">Save</button>
            </Form>
          )}
          {n === 0 ? (
            <p className="muted small">The first version is saved a few seconds after the first edit.</p>
          ) : (
            <ol className="version-list">
              {versions.map((v, i) => (
                <li key={v.id} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <Link to={`?v=${v.id}`} aria-current={v.id === selected?.id ? 'page' : undefined}>
                    <strong>{v.name ?? 'Automatic'}</strong>
                    <span className="muted">{v.author ?? 'cowrite'} · {timeAgo(v.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </aside>

        {selected && blocks && (
          <section className="sheet" aria-label="Selected version">
            <header className="version-head">
              <div className="version-meta">
                <Avatar name={selected.author ?? 'cowrite'} color={selected.created_by ? colorFor(selected.created_by) : 'var(--fg-muted)'} size={32} />
                <div>
                  <h2>{selected.name ?? 'Automatic version'}</h2>
                  <p className="muted">{selected.author ? `Saved by ${selected.author}` : 'Saved by cowrite'} · <time dateTime={new Date(selected.created_at).toISOString()}>{timeAgo(selected.created_at)}</time></p>
                </div>
              </div>
              <div className="version-actions">
                <Form method="get" className="compare">
                  <input type="hidden" name="v" value={selected.id} />
                  <select name="against" defaultValue={against ?? ''} aria-label="Compare to">
                    <option value="">Compare to…</option>
                    <option value="now">Current document</option>
                    {versions.filter((v) => v.id !== selected.id).map((v) => <option key={v.id} value={v.id}>{v.name ?? 'Automatic'} · {timeAgo(v.created_at)}</option>)}
                  </select>
                  <button>Compare</button>
                </Form>
                {canEdit && (
                  <Form method="post" onSubmit={(e) => { if (!confirm('Restore this version? The text as it is now is saved first, so you can come back.')) e.preventDefault() }}>
                    <input type="hidden" name="intent" value="restore" />
                    <input type="hidden" name="id" value={selected.id} />
                    <button className="primary">Restore</button>
                  </Form>
                )}
              </div>
            </header>
            {diff ? (
              <>
                <p className="muted small" role="status">{changes === 0 ? 'No difference between the two.' : `${changes} ${changes === 1 ? 'block' : 'blocks'} changed. Older version first.`}</p>
                <ol className="diff">
                  {diff.map((r, i) => (
                    <li key={i} data-kind={r.kind}>
                      <span className="diff-mark" aria-hidden={r.kind === 'same'}>{labels[r.kind]}</span>
                      {r.kind === 'removed' ? <del><BlockView block={r.block} /></del> : r.kind === 'added' ? <ins><BlockView block={r.block} /></ins> : <BlockView block={r.block} />}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="version-body">
                {blocks.length === 0 ? <p className="muted">This version is empty.</p> : blocks.map((b, i) => <BlockView key={i} block={b} />)}
              </div>
            )}
          </section>
        )}
      </div>

      <Activity events={loaderData.events} here={params.id} />
    </div>
  )
}
