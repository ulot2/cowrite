import { requireUser } from '~/lib/auth.server'
import { roleOnDocument } from '~/lib/access.server'
import { atLeast } from '~/lib/roles'
import { AiLimit, ask, isCommand, MAX_INSTRUCTION } from '~/lib/ai.server'
import { docStub } from '~/lib/versions.server'
import { toText } from '~/lib/rich'
import type { Route } from './+types/api.ai'

// POST { documentId, command, text?, instruction? }. Whole-document commands read the text themselves.
// Anyone who may suggest (reviewer and up) may ask Nib, because the answer arrives as a suggestion.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const body = await request.json().catch(() => ({})) as { documentId?: string; command?: string; text?: string; instruction?: string }
  const command = String(body.command ?? '')
  if (!isCommand(command)) return Response.json({ error: 'Unknown command' }, { status: 400 })
  const role = await roleOnDocument(user.id, String(body.documentId ?? ''))
  if (!role) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!atLeast(role, 'reviewer')) return Response.json({ error: 'Only people who can suggest changes can ask Nib' }, { status: 403 })
  const selected = String(body.text ?? '').trim()
  const readDocument = async () => toText((await docStub(String(body.documentId)).readRich('now')) ?? [])

  let text: string, document = '', instruction = ''
  if (command === 'custom') {
    // A selection gets only the selection, so the model cannot mix the rest in. New writing gets
    // the document as context.
    instruction = String(body.instruction ?? '').trim()
    if (!instruction) return Response.json({ error: 'Tell Nib what to do' }, { status: 400 })
    if (instruction.length > MAX_INSTRUCTION) return Response.json({ error: `Keep the instruction under ${MAX_INSTRUCTION} characters` }, { status: 400 })
    text = selected
    if (!text) document = await readDocument()
  } else if (['improve', 'fix', 'shorten', 'continue'].includes(command)) {
    // Rewrites get only the selected text ("continue": the text before the cursor).
    text = selected
    if (!text) return Response.json({ error: command === 'continue' ? 'Write something first' : 'Select some text first' }, { status: 400 })
  } else {
    text = await readDocument()
    if (!text) return Response.json({ error: 'The document is empty' }, { status: 400 })
  }

  try {
    const answer = await ask(command, text, document, instruction)
    if (!answer) return Response.json({ error: 'Nib gave an empty answer. Try again.' }, { status: 502 })
    if (text && answer === text) return Response.json({ error: 'Nib found nothing to change.' }, { status: 422 })
    return Response.json({ text: answer })
  } catch (e) {
    if (e instanceof AiLimit) return Response.json({ error: 'Nib is out of free uses for today. Try again tomorrow.' }, { status: 429 })
    console.error(e)
    return Response.json({ error: 'Nib did not answer. Try again.' }, { status: 502 })
  }
}
