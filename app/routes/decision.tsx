import { Form, Link, redirect, useNavigation } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { roleOnDocument, roleOnSpace } from '~/lib/access.server'
import { getDecision, replaceableDecisions, setSupersedes, wouldCycle } from '~/lib/work.server'
import { usersById } from '~/lib/db.server'
import { docStub } from '~/lib/versions.server'
import { logEvent, logSpaceEvent } from '~/lib/events.server'
import { atLeast } from '~/lib/roles'
import { colorFor } from '~/lib/color'
import { timeAgo } from '~/lib/time'
import { Avatar } from '~/components/avatar'
import { Icon } from '~/components/icon'
import { Select } from '~/components/select'
import { ConnectedWork } from '~/components/connected-work'
import { DecisionBriefView, hasDecisionBrief } from '~/components/decision-brief-view'
import { decisionRecordings } from '~/lib/discussions.server'
import { createDecisionPlan, linkedDecisionPlans, planPeople } from '~/lib/decision-plans.server'
import { decisionPlanVersion } from '~/lib/decision-plan'
import { DecisionPlan } from '~/components/decision-plan'
import type { Route } from './+types/decision'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: loaderData ? `D-${loaderData.decision.number}: ${loaderData.decision.text} · cowrite` : 'Decision · cowrite' }]

// Who may see and change a decision: its space's members, or, outside a space, its document's.
const access = async (userId: string, d: { space_id: string | null; document_id: string }) =>
  d.space_id ? { role: await roleOnSpace(userId, d.space_id), need: 'editor' as const } : { role: await roleOnDocument(userId, d.document_id), need: 'editor' as const }

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const decision = await getDecision(params.id)
  const { role, need } = decision ? await access(user.id, decision) : { role: null, need: 'editor' as const }
  if (!decision || !role) throw new Response('Not found', { status: 404 })
  const canEdit = atLeast(role, need)
  const [recordings, plans, planMembers] = await Promise.all([
    decision.source_type === 'discussion' ? decisionRecordings(decision.id) : [],
    linkedDecisionPlans(user.id, decision.id),
    canEdit ? planPeople(decision) : [],
  ])

  // Why: the discussion that produced it, read from the space's room.
  const discussion = decision.source_type === 'discussion' && decision.space_id && decision.source_id
    ? await docStub(`${decision.space_id}:space`).readDiscussion(decision.source_id) : null
  const people = new Map((await usersById([...new Set([...(discussion?.posts.map((p) => p.userId) ?? []), discussion?.owner ?? ''])].filter(Boolean))).map((u) => [u.id, u]))
  const look = (id: string) => { const u = people.get(id); return { name: u?.name ?? 'Someone', color: colorFor(id, u?.color), image: u?.image ?? null } }
  return {
    decision,
    recordings,
    plans, planMembers,
    canEdit,
    discussion: discussion && { ...discussion, owner: discussion.owner ? look(discussion.owner) : null, posts: discussion.posts.map((p) => ({ ...p, who: look(p.userId) })) },
    choices: canEdit ? await replaceableDecisions(decision) : [],
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const decision = await getDecision(params.id)
  const { role, need } = decision ? await access(user.id, decision) : { role: null, need: 'editor' as const }
  if (!decision || !role) throw new Response('Not found', { status: 404 })
  if (!atLeast(role, need)) throw new Response('Only editors can change decisions or create plans', { status: 403 })
  const f = await request.formData()
  if (f.get('intent') === 'create-plan') {
    let result: Awaited<ReturnType<typeof createDecisionPlan>>
    try { result = await createDecisionPlan(user.id, decision, f) } catch (error) {
      console.error('Decision plan unavailable', error)
      return { planError: 'The plan could not be created right now. Your draft is still here; try again.', planRequest: String(f.get('request') ?? '') }
    }
    if ('error' in result) return { planError: result.error, planRequest: String(f.get('request') ?? '') }
    throw redirect(`/doc/${result.id}`)
  }
  if (f.get('intent') !== 'supersede') return null
  const olderId = String(f.get('older') ?? '')
  if (!olderId) { await setSupersedes(decision.id, null); return { ok: true } }
  const older = await getDecision(olderId)
  const sameLog = older && (decision.space_id ? older.space_id === decision.space_id : !older.space_id && older.owner_id === decision.owner_id)
  if (!older || !sameLog || older.id === decision.id) return { error: 'Pick a decision from this log.' }
  if (older.replaced_by && older.replaced_by !== decision.id) return { error: `D-${older.number} is already replaced by D-${older.replaced_by_number}.` }
  if (await wouldCycle(decision.id, older.id)) return { error: `D-${older.number} already comes after this decision.` }
  await setSupersedes(decision.id, older.id)
  const text = `replaced D-${older.number} with D-${decision.number}: “${decision.text.slice(0, 80)}”`
  const link = `/decision/${decision.id}`
  await (decision.space_id ? logSpaceEvent(decision.space_id, user.id, 'decision', text, link) : logEvent(decision.document_id, user.id, 'decision', text, link))
  return { ok: true }
}

const label: Record<string, string> = { proposed: 'Proposed', decided: 'Decided', dropped: 'Dropped', reopened: 'Reopened' }
const pill = (status: string) => (status === 'decided' ? 'approved' : status === 'proposed' ? 'review' : 'draft')
const date = (ms: number) => new Date(ms).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })

export default function Decision({ loaderData, actionData }: Route.ComponentProps) {
  const { decision: d, canEdit, discussion, choices, recordings, plans, planMembers } = loaderData
  const recording = recordings.find((item) => item.id === d.recording_id)
  const earlier = recordings.filter((item) => item.id !== d.recording_id)
  const saving = useNavigation().state !== 'idle'
  const replaced = !!d.replaced_by
  const back = d.space_id ? `/space/${d.space_id}?tab=decisions` : `/doc/${d.document_id}`
  return (
    <div className="page decision-page">
      <div className="doc-bar">
        <nav className="crumbs" aria-label="Breadcrumb">
          {d.space_id ? <><Link to={`/space/${d.space_id}`}>{d.space_name}</Link><span aria-hidden="true">/</span><Link to={back}>Decisions</Link></> : <Link to={back}>{d.title}</Link>}
          <span aria-hidden="true">/</span><span>{`D-${d.number}`}</span>
        </nav>
      </div>

      {replaced && (
        <p className="replaced-banner" role="status">
          <Icon name="history" />
          <span>This decision was replaced by <Link to={`/decision/${d.replaced_by}`}>{`D-${d.replaced_by_number}`}</Link>{d.replaced_at ? ` on ${date(d.replaced_at)}` : ''}. It stays here so the history makes sense.</span>
        </p>
      )}

      <header className="page-title decision-title" data-replaced={replaced || undefined}>
        <p className="eyebrow">{`Decision D-${d.number}`}{d.space_name && <> · {d.space_name}</>}</p>
        <h1>{d.text || 'Untitled decision'}</h1>
        <div className="title-meta">
          <span className="status" data-status={replaced ? 'draft' : pill(d.status)}>{replaced ? 'Replaced' : label[d.status] ?? d.status}</span>
          <p className="muted">{d.decided_at ? <>Decided {date(d.decided_at)}{d.decided_by_name && <> by {d.decided_by_name}</>}</> : 'Not decided yet'}</p>
        </div>
      </header>

      {d.outcome && (
        <section className="outcome" aria-label="What was decided">
          <p className="outcome-label">What was decided</p>
          <p>{d.outcome}</p>
        </section>
      )}
      {recording && <section className="decision-rationale" aria-label="Final reasoning"><h2>Final reasoning</h2><p>{recording.reasoning}</p></section>}
      {d.status === 'reopened' && <p className="muted small">This question is open again. The last recorded choice and its brief are preserved below until another decision is recorded.</p>}

      <DecisionPlan key={`plan:${d.id}`} source={{ decisionId: d.id, number: d.number, text: d.text, choice: d.outcome || d.text, reasoning: recording?.reasoning ?? '', version: decisionPlanVersion(d) }}
        people={planMembers} plans={plans} canCreate={canEdit && d.status === 'decided' && !replaced} destination={d.space_id ? `in ${d.space_name || 'this space'}` : 'with the source document’s members'} />

      <section className="chain" aria-label="Related decisions">
        {d.supersedes && <p><Icon name="history" />Replaces <Link to={`/decision/${d.supersedes}`}>{`D-${d.supersedes_number}`}</Link>: {d.supersedes_text}</p>}
        {replaced && <p><Icon name="up" />Replaced by <Link to={`/decision/${d.replaced_by}`}>{`D-${d.replaced_by_number}`}</Link></p>}
        {canEdit && (
          <Form method="post" className="supersede">
            <input type="hidden" name="intent" value="supersede" />
            <label htmlFor="older">This replaces</label>
            <Select key={d.supersedes ?? ''} name="older" label="This replaces" defaultValue={d.supersedes ?? ''}
              options={[{ value: '', label: 'No earlier decision' }, ...choices.map((c) => ({ value: c.id, label: `D-${c.number}: ${c.text.slice(0, 60)}` }))]} />
            <button className="primary" disabled={saving} aria-busy={saving}>Save</button>
            {actionData && 'error' in actionData && <p className="setting-said" data-error role="alert">{actionData.error}</p>}
          </Form>
        )}
      </section>

      <ConnectedWork key={d.id} kind="decision" id={d.id} defaultOpen />

      <section className="why" aria-labelledby="why-title">
        <h2 id="why-title">Why</h2>
        {recording && <section className="decision-record-brief" aria-label="Preserved decision brief"><div className="brief-heading"><div><h3>Brief at the time of the decision</h3><p className="muted small">Saved with this decision. Later edits to the discussion do not change it.</p></div></div>
          {hasDecisionBrief(recording.brief) ? <DecisionBriefView brief={recording.brief} /> : <p className="muted small">No brief was added before this decision was recorded.</p>}</section>}
        {earlier.length > 0 && <section className="decision-history" aria-label="Decision history"><h3>Earlier recorded versions</h3>{earlier.map((item) => <details key={item.id} data-disclosure><summary><strong>{item.choice}</strong><span className="muted small">{item.at ? date(item.at) : 'Date not recorded'} · {item.byName}</span><Icon name="chevron" /></summary>
          <div>{item.legacy ? <p className="muted small">Original plain answer. A separate rationale and brief snapshot were not recorded.</p> : <><h4>Final reasoning</h4><p>{item.reasoning}</p><h4>Brief preserved with this version</h4>{hasDecisionBrief(item.brief) ? <DecisionBriefView brief={item.brief} /> : <p className="muted small">No brief was added.</p>}</>}</div></details>)}</section>}
        {d.source_type === 'discussion' ? (
          discussion ? (
            <>
              <p className="muted">
                Decided in the discussion <Link to={`/space/${d.space_id}?tab=discussions&d=${d.source_id}`}>{discussion.title}</Link>
                {discussion.owner && <>, with {discussion.owner.name} deciding</>}{discussion.due && <> by {new Date(discussion.due + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</>}.
              </p>
              {!recording && hasDecisionBrief(discussion.brief) && <section className="decision-record-brief" aria-label="Decision brief"><div className="brief-heading"><div><h3>Current source brief</h3><p className="muted small">This older decision has no saved brief snapshot. These are the current options and recommendation in the discussion.</p></div></div><DecisionBriefView brief={discussion.brief} /></section>}
              <ol className="transcript">
                {discussion.posts.map((p, i) => (
                  <li key={i}>
                    <Avatar name={p.who.name} color={p.who.color} image={p.who.image} size={28} />
                    <div><p className="post-head"><strong>{p.who.name}</strong><time className="muted">{timeAgo(p.createdAt)}</time></p><p className="post-text">{p.text}</p></div>
                  </li>
                ))}
              </ol>
            </>
          ) : <p className="muted">The discussion behind this decision is gone.</p>
        ) : (
          <p className="muted">
            Recorded in the document <Link to={`/doc/${d.document_id}`}><Icon name="docs" />{d.title || 'Untitled'}</Link>
            {d.document_status && <> (status: {d.document_status === 'review' ? 'in review' : d.document_status})</>}. Open it to read the reasoning around the decision.
          </p>
        )}
      </section>
    </div>
  )
}
