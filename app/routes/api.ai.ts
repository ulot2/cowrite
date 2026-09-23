import { requireUser } from '~/lib/auth.server'
import { roleOnDocument } from '~/lib/access.server'
import { atLeast } from '~/lib/roles'
import { AiLimit, ask, isCommand } from '~/lib/ai.server'
import { docStub } from '~/lib/versions.server'
import { toText } from '~/lib/rich'
import type { Route } from './+types/api.ai'

// POST { documentId, command, text? }. Whole-document commands read the text themselves.
// Anyone who may suggest (reviewer and up) may ask, because the answer arrives as a suggestion.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const body = await request.json().catch(() => ({})) as { documentId?: string; command?: string; text?: string }
  const command = String(body.command ?? '')
  if (!isCommand(command)) return Response.json({ error: 'Unknown command' }, { status: 400 })
  const role = await roleOnDocument(user.id, String(body.documentId ?? ''))
  if (!role) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!atLeast(role, 'reviewer')) return Response.json({ error: 'Only people who can suggest changes can use AI' }, { status: 403 })
  const doc = toText((await docStub(String(body.documentId)).readRich('now')) ?? [])
  const selection = ['improve', 'shorten', 'continue'].includes(command)
  const text = selection ? String(body.text ?? '').trim() : doc
  if (!text) return Response.json({ error: selection ? 'Select some text first' : 'The document is empty' }, { status: 400 })
  try {
    return Response.json({ text: await ask(command, text, selection ? doc : '') })
  } catch (e) {
    if (e instanceof AiLimit) return Response.json({ error: 'The AI is out of free uses for today. Try again tomorrow.' }, { status: 429 })
    console.error(e)
    return Response.json({ error: 'The AI did not answer. Try again.' }, { status: 502 })
  }
}
