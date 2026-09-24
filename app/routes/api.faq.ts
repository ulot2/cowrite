import { env } from 'cloudflare:workers'
import { AiLimit, ask } from '~/lib/ai.server'
import type { Route } from './+types/api.faq'

// POST { question } from the landing page: Nib answers a visitor's own question. No account, so the
// limits count per visitor (a one-way code of the IP address) and for the whole page, per day, to
// keep the landing page from using up the free AI allowance that Nib in the app needs.
const MAX_QUESTION = 300
const PER_VISITOR = 5
const PER_DAY = 100

// Everything Nib may say about CoWrite, one fact per line. Keep it true and in step with the landing
// page and the README: Nib answers only from this text.
const facts = `CoWrite is free. There is no paid plan today, and nothing asks for a card.
CoWrite keeps a team's ideas, discussions, decisions, and documents in one space, linked both ways.
A space holds one piece of work: its ideas board, its discussions, its documents, its numbered decisions, and its tasks.
Only the people you add can see a space. If you make a space public, anyone signed in who has its link can read it.
Add people by the email they sign up with, and give each one a role: viewer, commenter, reviewer, editor, or owner. You can also share a link to the space.
CoWrite does not send emails yet, so tell people yourself when you add them.
Everyone writes in the same document at the same time, and every cursor shows a name.
If you lose the connection, keep writing. Your edits are saved on your device and merge with everyone else's when you are back.
A question can have an owner and a “decide by” date. When it is answered, it becomes a numbered decision that keeps the conversation that made it.
Turn on Suggest, and your edits become suggestions that an editor accepts or rejects.
A document goes from draft to in review to approved. Reviewers sign off section by section, and an open concern blocks approval.
CoWrite saves versions while you work. You can name, compare, and restore any of them.
Nib is the AI assistant. It improves, shortens, fixes, and summarizes text, answers questions about a space, and checks a document against the team's decisions.
Nib only suggests. Nothing changes until a person accepts it, and you can switch Nib off in Settings.
Nib runs on Cloudflare Workers AI. It reads your work only when you ask it something, when a document goes to review, and to write a space's weekly summary.
Download any document as Markdown, Word, or plain text, or print it to PDF. You can also publish a document as a public page, or present it as slides.
A document can hold headings, lists, quotes, code, tables, links, images, tasks with an owner and a date, and decisions.
Each task shows on the Tasks page of the person it is for, with its date.
Select any text to comment on it. You can reply, react, and mention people with @, and they see it in their bell.
Search finds words in document titles, text, and comments.
Sign up with an email and a password, or with GitHub.
You can try CoWrite without an account in the playground, at /play: a page with the full editor that only you can see. It stays in your browser for 7 days after your last edit, and you can download it at any time.
CoWrite works in the browser, on a computer or a phone. There is no app to install.
The code is open source under the MIT license. You can read it, run it yourself, or open an issue on GitHub.
CoWrite runs on Cloudflare Workers, Durable Objects, and D1, with Yjs to merge edits and BlockNote as the editor.`
const NO_ANSWER = 'We do not have an answer to that yet. Ask on GitHub, and the team will answer.'

const today = () => new Date().toISOString().slice(0, 10)
const visitor = async (request: Request) => {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local'
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.BETTER_AUTH_SECRET}:${today()}:${ip}`))
  return [...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function action({ request }: Route.ActionArgs) {
  const body = await request.json().catch(() => ({})) as { question?: unknown }
  const question = String(body.question ?? '').trim()
  if (!question) return Response.json({ error: 'Type a question first.' }, { status: 400 })
  if (question.length > MAX_QUESTION) return Response.json({ error: `Keep the question under ${MAX_QUESTION} characters.` }, { status: 400 })

  // Count first, then decide: both counters go up in one batch, so two requests cannot both slip in.
  // Past days' rows are no use to the limits, so the same batch drops them.
  const count = (who: string) => env.DB.prepare('INSERT INTO faq_asks (day, who, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1 RETURNING n').bind(today(), who)
  const [mine, all] = (await env.DB.batch<{ n: number }>([count(await visitor(request)), count('*'), env.DB.prepare('DELETE FROM faq_asks WHERE day < ?').bind(today())]))
    .map((r) => r.results[0]?.n ?? 0)
  if (mine > PER_VISITOR) return Response.json({ error: `You have asked ${PER_VISITOR} questions today. Ask again tomorrow, or ask on GitHub.` }, { status: 429 })
  if (all > PER_DAY) return Response.json({ error: 'Nib has answered a lot of questions today. Try again tomorrow, or ask on GitHub.' }, { status: 429 })

  try {
    const answer = await ask('faq', question, facts)
    return Response.json({ question, answer: !answer || answer.includes('NO_ANSWER') ? NO_ANSWER : answer })
  } catch (e) {
    if (e instanceof AiLimit) return Response.json({ error: 'Nib is out of free answers for today. Try again tomorrow, or ask on GitHub.' }, { status: 429 })
    console.error(e)
    return Response.json({ error: 'Nib did not answer. Try again.' }, { status: 502 })
  }
}
