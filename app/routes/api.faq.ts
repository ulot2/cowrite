import { env } from 'cloudflare:workers'
import { AiLimit, ask } from '~/lib/ai.server'
import type { Route } from './+types/api.faq'

// POST { question } from the landing page: Nib answers a visitor's own question. No account, so the
// limits count per visitor (a one-way code of the IP address) and for the whole page, per day, to
// keep the landing page from using up the free AI allowance that Nib in the app needs.
const MAX_QUESTION = 300
const PER_VISITOR = 5
const PER_DAY = 100

// Everything Nib may say about CoWrite. Keep it in step with the landing page and the README.
const facts = `CoWrite keeps a team's ideas, discussions, decisions, and documents in one space, linked both ways.
A space holds one piece of work. Its members see its Overview ("Needs attention": questions to decide, documents to review, tasks to do), an Ideas board with votes, Discussions, Documents, numbered Decisions, and Tasks.
An idea can become a discussion. A question has an owner and a "decide by" date. When it is answered it becomes a numbered decision (D-1, D-2), and the decision keeps the conversation that made it, under "Why". A decision can replace an older one.
Documents are written live together: every cursor shows a name. Blocks include headings, lists, quotes, code, tables, links, images, tasks with an owner and a date, and decisions. Comments, replies, reactions, and @mentions work on selected text.
Offline: you keep writing, your edits are saved on your device, and they merge with everyone else's when you are back, with nothing to fix by hand.
Review: turn on Suggest and edits become suggestions that an editor accepts or rejects. A document is an idea, a draft, in review, approved, or done. Reviewers sign off section by section, and a concern blocks approval.
Versions: saved automatically while you work. You can name, compare, and restore any version.
Roles: viewer, commenter, reviewer, editor, owner. Share by email with a role, or with a link. A space can be made public, so anyone signed in who has its link can read it. Otherwise only the people you add can see a space.
CoWrite does not send emails yet, so you tell people yourself when you add them.
Nib is the AI assistant. It runs on Cloudflare Workers AI. It improves, shortens, fixes, and summarizes text, answers questions about a space with its sources, proposes next steps from a discussion, checks a document against the decisions in force before review, and writes a space's weekly summary. Nib only suggests: nothing changes until a person accepts it. Each person can switch Nib off in Settings. Nib has a free daily allowance; when it is used up, Nib is back the next day.
Export: download any document as Markdown, Word, or plain text, or print it to PDF. Publish a document as a public page, or present it as slides.
Search covers titles, text, and comments. A bell shows what other people did. Settings has avatar color and photo, notifications, theme, and text size.
Sign up with an email and a password, or with GitHub.
Price: free. There is no paid plan today, and nothing asks for a card.
Open source under the MIT license. The code is on GitHub at https://github.com/ulot2/cowrite, where you can read it, run it yourself, or open an issue. It runs on Cloudflare Workers, Durable Objects, and D1, with Yjs for merging edits and BlockNote as the editor.
There is no mobile app; CoWrite works in the browser.`

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
    return Response.json({ question, answer: answer || 'I do not know. Ask on GitHub, and the team can answer.' })
  } catch (e) {
    if (e instanceof AiLimit) return Response.json({ error: 'Nib is out of free answers for today. Try again tomorrow, or ask on GitHub.' }, { status: 429 })
    console.error(e)
    return Response.json({ error: 'Nib did not answer. Try again.' }, { status: 502 })
  }
}
