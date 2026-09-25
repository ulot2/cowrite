import { useState } from 'react'
import { Link, redirect, useFetcher } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { deleteSpace, getSpace, listMembers, roleOnSpace, transferSpace, updateSpace } from '~/lib/access.server'
import { listSpaceDocuments } from '~/lib/db.server'
import { logSpaceEvent } from '~/lib/events.server'
import { colors } from '~/lib/color'
import { Confirm } from '~/components/confirm'
import { Icon } from '~/components/icon'
import { isUpload, Said, uploadImage } from '~/components/said'
import { Select } from '~/components/select'
import { SpaceMark } from '~/components/space-mark'
import type { Route } from './+types/space-settings'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `Settings · ${loaderData?.space.name ?? 'Space'} · cowrite` }]

// Only the owner opens this page and changes these settings.
const ownerOf = async (request: Request, id: string) => {
  const user = await requireUser(request)
  const role = await roleOnSpace(user.id, id)
  const space = role && await getSpace(id)
  if (!role || !space) throw new Response('Not found', { status: 404 })
  if (role !== 'owner') throw new Response('Only the owner can change the settings of this space', { status: 403 })
  return { user, space }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, space } = await ownerOf(request, params.id)
  return {
    space,
    others: (await listMembers('space', params.id)).filter((m) => m.user_id !== user.id),
    documents: (await listSpaceDocuments(params.id, 'owner')).length,
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, space } = await ownerOf(request, params.id)
  const f = await request.formData()
  const intent = String(f.get('intent'))
  const value = String(f.get('value') ?? '').trim()
  const done = { intent, ok: true as const }
  switch (intent) {
    case 'name':
      if (!value || value.length > 60) return { intent, error: 'Use a name of 1 to 60 characters.' }
      await updateSpace(space.id, { name: value })
      if (value !== space.name) await logSpaceEvent(space.id, user.id, 'space', `renamed the space to “${value}”`)
      return done
    case 'description':
      if (value.length > 140) return { intent, error: 'Keep the description to 140 characters.' }
      await updateSpace(space.id, { description: value })
      return done
    case 'logo':
      // Only an image this app stored (from /upload), or nothing to remove the logo.
      if (value && !isUpload(value)) return { intent, error: 'That logo did not upload. Try again.' }
      await updateSpace(space.id, { logo: value || null })
      return done
    case 'color':
      await updateSpace(space.id, { color: colors.includes(value) ? value : null })
      return done
    case 'visibility': {
      const visibility = value === 'public' ? 'public' : 'private'
      await updateSpace(space.id, { visibility })
      if (visibility !== space.visibility) await logSpaceEvent(space.id, user.id, 'space', `made the space ${visibility}`)
      return done
    }
    case 'add-docs':
      await updateSpace(space.id, { add_docs: value === 'commenter' ? 'commenter' : 'editor' })
      return done
    case 'nib':
      await updateSpace(space.id, { nib: f.get('nib') === 'on' ? 1 : 0 })
      return done
    case 'transfer': {
      const next = (await listMembers('space', space.id)).find((m) => m.user_id === value && m.user_id !== user.id)
      if (!next) return { intent, error: 'Choose a member of this space.' }
      await transferSpace(space.id, user.id, next.user_id)
      await logSpaceEvent(space.id, user.id, 'shared', `made ${next.name} the owner`)
      throw redirect(`/space/${space.id}`)
    }
    case 'delete-space':
      await deleteSpace(space.id)
      throw redirect('/')
  }
  return null
}

// Two to three choices that save as soon as one is picked.
function Choice({ fetcher, intent, label, value, options }: { fetcher: ReturnType<typeof useFetcher>; intent: string; label: string; value: string; options: [string, string][] }) {
  const shown = fetcher.formData?.get('intent') === intent ? String(fetcher.formData.get('value')) : value
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={shown === v} className={shown === v ? 'on' : ''}
          onClick={() => fetcher.submit({ intent, value: v }, { method: 'post' })}>{text}</button>
      ))}
    </div>
  )
}

export default function SpaceSettings({ loaderData }: Route.ComponentProps) {
  const { space, others, documents } = loaderData
  const name = useFetcher()
  const description = useFetcher()
  const logo = useFetcher()
  const color = useFetcher()
  const access = useFetcher()
  const nib = useFetcher()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [next, setNext] = useState(others[0]?.user_id ?? '')

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true); setUploadError('')
    try { logo.submit({ intent: 'logo', value: await uploadImage(file) }, { method: 'post' }) } catch (e) { setUploadError((e as Error).message) }
    setUploading(false)
  }
  // The mark as it will look, while a change is on its way.
  const pending = (f: ReturnType<typeof useFetcher>, fallback: string | null) => f.formData ? String(f.formData.get('value') || '') || null : fallback
  const shown = { ...space, logo: pending(logo, space.logo), color: pending(color, space.color) }
  const nextName = others.find((m) => m.user_id === next)?.name ?? ''

  const sections: [string, string][] = [['profile', 'Profile'], ['access', 'Access'], ['nib', 'Nib'], ['owner', 'Owner'], ['danger', 'Delete space']]
  return (
    <div className="page settings">
      <div className="doc-bar">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span aria-hidden="true">/</span><Link to={`/space/${space.id}`}>{space.name}</Link><span aria-hidden="true">/</span><span>Settings</span></nav>
      </div>
      <header className="page-title">
        <p className="eyebrow">Space settings</p>
        <h1>{space.name}</h1>
        <p className="muted">Only you, the owner, can see and change these. Most save as you make them.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <div className="settings-sections">
          <section id="profile" className="settings-card" aria-labelledby="profile-title">
            <header><h2 id="profile-title">Profile</h2><p>How the space looks in the sidebar and on its page.</p></header>
            <div className="setting-row">
              <div className="photo-row">
                <SpaceMark space={shown} size={64} />
                <div><strong>Logo</strong><span>PNG, JPEG, GIF, or WebP, up to 2 MB. A square image looks best.</span></div>
              </div>
              <div className="setting-actions">
                <label className="button" aria-busy={uploading}>
                  {uploading ? <span className="spinner" aria-hidden="true" /> : <Icon name="up" />}{space.logo ? 'Change logo' : 'Upload logo'}
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
                </label>
                {space.logo && <button type="button" className="ghost" onClick={() => logo.submit({ intent: 'logo', value: '' }, { method: 'post' })}>Remove</button>}
              </div>
              {uploadError && <p className="setting-said" data-error role="alert">{uploadError}</p>}
              <Said fetcher={logo} intent="logo" />
            </div>
            <name.Form method="post" className="setting-row">
              <input type="hidden" name="intent" value="name" />
              <label htmlFor="space-name"><strong>Name</strong><span>Every member sees it in their sidebar.</span></label>
              <div className="setting-actions">
                <input id="space-name" name="value" defaultValue={space.name} maxLength={60} required />
                <button className="primary" disabled={name.state !== 'idle'} aria-busy={name.state !== 'idle'}>Save</button>
              </div>
              <Said fetcher={name} intent="name" />
            </name.Form>
            <description.Form method="post" className="setting-row">
              <input type="hidden" name="intent" value="description" />
              <label htmlFor="space-description"><strong>Description</strong><span>One line under the name, on the space page. Leave it empty for none.</span></label>
              <div className="setting-actions">
                <input id="space-description" name="value" defaultValue={space.description} maxLength={140} placeholder="What this space is for" />
                <button className="primary" disabled={description.state !== 'idle'} aria-busy={description.state !== 'idle'}>Save</button>
              </div>
              <Said fetcher={description} intent="description" />
            </description.Form>
            <div className="setting-row">
              <div><strong>Color</strong><span>Behind the first letter of the name when there is no logo.</span></div>
              <div className="swatches" role="radiogroup" aria-label="Space color">
                <button type="button" role="radio" aria-checked={!shown.color} className="swatch auto" title="Automatic" onClick={() => color.submit({ intent: 'color', value: '' }, { method: 'post' })}><span className="sr-only">Automatic</span>A</button>
                {colors.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={shown.color === c} className="swatch" style={{ background: c }} title={c} onClick={() => color.submit({ intent: 'color', value: c }, { method: 'post' })}>
                    <span className="sr-only">Color {c}</span>{shown.color === c && <Icon name="check" />}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section id="access" className="settings-card" aria-labelledby="access-title">
            <header><h2 id="access-title">Access</h2><p>Who can open the space, and who can add to it. Add people and make a share link with Share on the space page.</p></header>
            <div className="setting-row">
              <div><strong>Who can open it</strong><span>Public: anyone with the link can read it. Only members can write.</span></div>
              <Choice fetcher={access} intent="visibility" label="Who can open it" value={space.visibility} options={[['private', 'Members only'], ['public', 'Anyone with the link']]} />
            </div>
            <div className="setting-row">
              <div><strong>Who can add documents</strong><span>Editors can always add documents. Commenters can add them too when you allow it.</span></div>
              <Choice fetcher={access} intent="add-docs" label="Who can add documents" value={space.add_docs} options={[['editor', 'Editors'], ['commenter', 'Editors and commenters']]} />
            </div>
            <Said fetcher={access} intent="visibility" />
            <Said fetcher={access} intent="add-docs" />
          </section>

          <section id="nib" className="settings-card" aria-labelledby="nib-title">
            <header><h2 id="nib-title"><span className="ai-mark" aria-hidden="true">✦</span> Nib</h2><p>The assistant, for this space.</p></header>
            <nib.Form method="post" onChange={(e) => nib.submit(e.currentTarget)}>
              <input type="hidden" name="intent" value="nib" />
              <label className="setting-row">
                <div><strong>Use Nib in this space</strong><span>Off stops the weekly summary, Ask, suggested next steps, and the check before review, for every member. Each person still chooses whether Nib helps them write.</span></div>
                <input type="checkbox" role="switch" className="switch" name="nib" defaultChecked={space.nib !== 0} />
              </label>
            </nib.Form>
            <Said fetcher={nib} intent="nib" />
          </section>

          <section id="owner" className="settings-card" aria-labelledby="owner-title">
            <header><h2 id="owner-title">Owner</h2><p>The owner changes these settings and can delete the space. A space has one owner.</p></header>
            <div className="setting-row">
              <div><strong>Make someone else the owner</strong><span>{others.length ? 'You stay in the space as an editor.' : 'Add someone to the space first, with Share on the space page.'}</span></div>
              {others.length > 0 && (
                <div className="setting-actions">
                  <Select name="next" label="New owner" options={others.map((m) => ({ value: m.user_id, label: m.name, hint: m.email }))} defaultValue={next} onChange={setNext} />
                  <Confirm title={`Make ${nextName} the owner?`} confirm="Make owner" busy="Changing…" tone="primary" fields={{ intent: 'transfer', value: next }}
                    trigger={(open) => <button type="button" className="button" onClick={open}>Make owner</button>}>
                    <p>{nextName} can then change these settings and delete the space. You stay in the space as an editor.</p>
                    <p>Only {nextName} can make you the owner again.</p>
                  </Confirm>
                </div>
              )}
            </div>
          </section>

          <section id="danger" className="settings-card danger-zone" aria-labelledby="danger-title">
            <header><h2 id="danger-title">Delete space</h2><p>This cannot be undone.</p></header>
            <div className="setting-row">
              <div>
                <strong>Delete this space</strong>
                <span>Its discussions, ideas, members, and share link go. {documents === 0 ? 'It has no documents.' : documents === 1 ? 'Its document stays.' : `Its ${documents} documents stay.`}</span>
              </div>
              <Confirm title={`Delete “${space.name}”?`} confirm="Delete space" busy="Deleting…" fields={{ intent: 'delete-space' }}
                trigger={(open) => <button type="button" className="danger-solid" onClick={open}><Icon name="trash" />Delete space</button>}>
                <p>The space, its members, its discussions, and its share link go away. This cannot be undone.</p>
                <ul>
                  <li><strong>{documents} {documents === 1 ? 'document is' : 'documents are'} kept.</strong> They move out of the space and stay with the people added to them.</li>
                  <li>People who could open them only through this space lose access.</li>
                </ul>
              </Confirm>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
