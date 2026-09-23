import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { ConnectionState, Presence } from './rich-editor.client'
import type { Person } from './mentions.client'
import { Icon } from './icon'
import { Select } from './select'

type Group = { id: string; name: string }
type Task = { assignee?: string; assigneeName?: string; due?: string; done?: boolean }
type Card = { id: string; text: string; group: string; pos: number; votes: string[]; task?: Task; doc?: string }

type Props = {
  documentId: string
  user: { id: string; name: string; color: string }
  canEdit: boolean
  people: Person[]
  onStatus: (state: ConnectionState, others: Presence[], openComments: number) => void
}

// A brainstorm board. Same object and socket as a document; the content is `groups` (columns) and
// `cards` (one Y.Map per card), so cards sync live, work offline, and merge like text.
// ponytail: a card's text is one value, last writer wins; a Y.Text per card if two people type in one card.
export function Board({ documentId, user, canEdit, people, onStatus }: Props) {
  const [sync] = useState(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(url, documentId, doc, { disableBc: true, connect: false })
    provider.awareness.setLocalStateField('user', { name: user.name, color: user.color })
    return { doc, provider, groups: doc.getArray<Group>('groups'), cards: doc.getMap<Y.Map<unknown>>('cards') }
  })
  const [groups, setGroups] = useState<Group[]>([])
  const [cards, setCards] = useState<Card[]>([])

  // Connect on mount, read on every change, free everything a tick after unmount (see rich-editor).
  const destroyTimer = useRef<number>(undefined)
  useEffect(() => {
    clearTimeout(destroyTimer.current)
    const { doc, provider, groups, cards } = sync
    provider.connect()
    const read = () => {
      setGroups(groups.toArray())
      setCards([...cards.entries()].map(([id, c]) => ({
        id, text: String(c.get('text') ?? ''), group: String(c.get('group') ?? ''), pos: Number(c.get('pos') ?? 0),
        votes: [...((c.get('votes') as Y.Map<boolean> | undefined)?.keys() ?? [])], task: c.get('task') as Task | undefined, doc: c.get('doc') as string | undefined,
      })).sort((a, b) => a.pos - b.pos))
    }
    const report = () => {
      const state: ConnectionState = provider.wsconnected ? 'connected' : provider.shouldConnect ? 'connecting' : 'disconnected'
      const others = [...provider.awareness.getStates()].filter(([id]) => id !== doc.clientID).map(([, s]) => s.user).filter(Boolean)
      onStatus(state, others, 0)
    }
    groups.observe(read); cards.observeDeep(read); provider.on('status', report); provider.awareness.on('change', report)
    read(); report()
    return () => {
      groups.unobserve(read); cards.unobserveDeep(read); provider.off('status', report); provider.awareness.off('change', report)
      provider.disconnect()
      destroyTimer.current = window.setTimeout(() => { provider.destroy(); doc.destroy() }, 0)
    }
  }, [sync, onStatus])

  const card = (id: string) => sync.cards.get(id)!
  const lastPos = (group: string) => Math.max(0, ...cards.filter((c) => c.group === group).map((c) => c.pos))
  const [fresh, setFresh] = useState<string | null>(null) // a card just added: its text field takes focus
  const addCard = (group: string) => {
    const c = new Y.Map<unknown>()
    const id = crypto.randomUUID()
    setFresh(id)
    sync.doc.transact(() => {
      sync.cards.set(id, c)
      c.set('text', ''); c.set('group', group); c.set('pos', lastPos(group) + 1); c.set('votes', new Y.Map())
    })
  }
  // Drop before `before` (or at the end): the new position sits halfway between its neighbours.
  const move = (id: string, group: string, before?: string) => {
    const list = cards.filter((c) => c.group === group && c.id !== id)
    const at = before ? list.findIndex((c) => c.id === before) : -1
    const pos = at < 0 ? lastPos(group) + 1 : ((list[at - 1]?.pos ?? list[at].pos - 1) + list[at].pos) / 2
    sync.doc.transact(() => { card(id).set('group', group); card(id).set('pos', pos) })
  }
  const vote = (id: string) => {
    const votes = card(id).get('votes') as Y.Map<boolean>
    if (votes.has(user.id)) votes.delete(user.id); else votes.set(user.id, true)
  }
  const setTask = (id: string, patch: Task | null) => card(id).set('task', patch && { ...(card(id).get('task') as Task | undefined), ...patch })
  const addGroup = () => sync.groups.push([{ id: crypto.randomUUID(), name: 'New column' }])
  const renameGroup = (i: number, name: string) => sync.doc.transact(() => { const g = sync.groups.get(i); sync.groups.delete(i, 1); sync.groups.insert(i, [{ ...g, name }]) })

  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null) // the column a card is dragged over
  const votes = cards.reduce((n, c) => n + c.votes.length, 0)
  const makeDoc = useFetcher<{ created?: string }>()
  const pendingCard = useRef<string | null>(null)
  useEffect(() => { if (makeDoc.data?.created && pendingCard.current) { card(pendingCard.current).set('doc', makeDoc.data.created); pendingCard.current = null } }, [makeDoc.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    <p className="board-summary muted" role="status">
      {groups.length} {groups.length === 1 ? 'column' : 'columns'} · {cards.length} {cards.length === 1 ? 'card' : 'cards'} · {votes} {votes === 1 ? 'vote' : 'votes'}
      {canEdit && <span className="board-hint"> · Drag cards between columns, or use a card's menu</span>}
    </p>
    <div className="board" aria-label="Board">
      {groups.map((g, gi) => (
        <section key={g.id} className="board-column" aria-labelledby={`col-${g.id}`} data-over={(dragging && over === g.id) || undefined}
          onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(g.id) } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) }}
          onDrop={(e) => { e.preventDefault(); if (dragging) move(dragging, g.id); setDragging(null); setOver(null) }}>
          <header className="board-column-head">
            <span className="board-dot" aria-hidden="true" />
            {canEdit ? <input id={`col-${g.id}`} className="board-column-name" defaultValue={g.name} key={g.name} aria-label="Column name" onBlur={(e) => e.target.value.trim() && e.target.value !== g.name && renameGroup(gi, e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
              : <h2 id={`col-${g.id}`} className="board-column-name">{g.name}</h2>}
            <span className="board-count" aria-label={`${cards.filter((c) => c.group === g.id).length} cards`}>{cards.filter((c) => c.group === g.id).length}</span>
          </header>
          {!cards.some((c) => c.group === g.id) && <p className="board-empty">{canEdit ? 'No cards yet. Add one, or drop one here.' : 'No cards yet.'}</p>}
          <ol className="board-cards">
            {cards.filter((c) => c.group === g.id).map((c) => (
              <li key={c.id} className="board-card" draggable={canEdit} data-dragging={dragging === c.id || undefined} data-done={c.task?.done || undefined}
                onDragStart={() => setDragging(c.id)} onDragEnd={() => { setDragging(null); setOver(null) }}
                onDragOver={(e) => { if (dragging && dragging !== c.id) e.preventDefault() }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragging && dragging !== c.id) move(dragging, g.id, c.id); setDragging(null); setOver(null) }}>
                <div className="board-card-body">
                  {c.task && <input type="checkbox" className="task-check" checked={!!c.task.done} disabled={!canEdit} aria-label={c.task.done ? 'Mark as not done' : 'Mark as done'} onChange={(e) => setTask(c.id, { done: e.target.checked })} />}
                  {canEdit ? <textarea className="board-card-text" defaultValue={c.text} key={c.text} placeholder="Write an idea" aria-label="Card text" rows={2} autoFocus={c.id === fresh}
                    onBlur={(e) => e.target.value !== c.text && card(c.id).set('text', e.target.value)} />
                    : <p className="board-card-text">{c.text}</p>}
                </div>
                {c.task && (
                  <div className="task-meta">
                    <Select key={c.task.assignee} name="assignee" label="Assigned to" className="quiet" disabled={!canEdit} defaultValue={c.task.assignee ?? ''}
                      options={[{ value: '', label: 'No one' }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                      onChange={(v) => setTask(c.id, { assignee: v, assigneeName: people.find((p) => p.id === v)?.name ?? '' })} />
                    <input type="date" className="task-due" value={c.task.due ?? ''} disabled={!canEdit} aria-label="Due date" onChange={(e) => setTask(c.id, { due: e.target.value })} />
                  </div>
                )}
                <div className="board-card-foot">
                  <button type="button" className="ghost vote" aria-pressed={c.votes.includes(user.id)} disabled={!canEdit} onClick={() => vote(c.id)} aria-label={`Vote. ${c.votes.length} ${c.votes.length === 1 ? 'vote' : 'votes'}`}>
                    <Icon name="up" />{c.votes.length}
                  </button>
                  {c.doc && <Link to={`/doc/${c.doc}`} className="board-card-link"><Icon name="docs" />Document</Link>}
                  {canEdit && (
                    <details className="status-menu card-menu">
                      <summary className="tool icon-only" aria-label="Card actions"><Icon name="more" /></summary>
                      <div className="popover">
                        {groups.length > 1 && (
                          <>
                            <p className="menu-label">Move to</p>
                            {groups.filter((o) => o.id !== g.id).map((o) => <button key={o.id} type="button" className="ghost" onClick={() => move(c.id, o.id)}>{o.name}</button>)}
                          </>
                        )}
                        <p className="menu-label">Turn into</p>
                        <button type="button" className="ghost" onClick={() => setTask(c.id, c.task ? null : { assignee: '', assigneeName: '', due: '', done: false })}>{c.task ? 'An idea again' : 'A task'}</button>
                        {!c.doc && <button type="button" className="ghost" disabled={!c.text.trim() || makeDoc.state !== 'idle'} onClick={() => { pendingCard.current = c.id; makeDoc.submit({ intent: 'card-doc', title: c.text.slice(0, 120) }, { method: 'post' }) }}>A document</button>}
                        <button type="button" className="ghost danger" onClick={() => sync.cards.delete(c.id)}>Delete card</button>
                      </div>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {canEdit && <button type="button" className="ghost board-add" onClick={() => addCard(g.id)}><Icon name="plus" />Add a card</button>}
        </section>
      ))}
      {canEdit && <button type="button" className="board-add-column" onClick={addGroup}><Icon name="plus" />Add a column</button>}
    </div>
    </>
  )
}
