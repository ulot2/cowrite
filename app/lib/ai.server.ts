import { env } from 'cloudflare:workers'

// Nib, the writing assistant. One place talks to the model; to use Claude later, only this file changes.
// The 70B model follows "rewrite only this text" reliably; the 8B one mixed in the context.
// About 30 neurons a request, so the free 10,000 a day is a few hundred requests.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
// ponytail: the input is cut at 12,000 characters; chunking long documents can come later.
const MAX_INPUT = 12000
export const MAX_INSTRUCTION = 500

const nib = 'You are Nib, the writing assistant in CoWrite, a shared document editor.'
const rules = 'Reply with the result only. No introduction, no explanation, no quotes around it, no Markdown. Keep the language of the text.'
const markdown = 'Reply with the result only: no introduction, no explanation, no quotes around it. Use Markdown (headings, lists, bold) only when the structure helps. Keep the language of the document unless the instruction says otherwise.'
const rewrite = (task: string) => `${nib} ${task} Change only the text between <text> and </text>. ${rules}`
const prompts = {
  improve: rewrite('Rewrite the text so it is clearer and reads better. Keep its meaning, facts, tone, and about the same length.'),
  fix: rewrite('Fix the spelling, grammar, and punctuation of the text. Change nothing else.'),
  shorten: rewrite('Make the text shorter: cut filler words, merge ideas, and use shorter phrasing. The result must have fewer words than the text, about half for long text. Keep every important fact.'),
  continue: `${nib} Write the next one to three sentences that continue the text between <text> and </text>, in the same voice and language. Do not repeat the text. ${rules}`,
  summarize: `${nib} Summarize the document between <text> and </text> in two to four sentences. ${rules}`,
  contradictions: `${nib} Find statements in the document between <text> and </text> that contradict each other. Write one per line, as "X, but Y". If there are none, reply exactly: None found. ${rules}`,
  actions: `${nib} List the action items in the document between <text> and </text>: things someone must do. Write one short imperative sentence per line, starting with the person's name and a colon when the document names who must do it. If there are none, reply exactly: None found. ${rules}`,
  // A free instruction ("@nib ..."): applied to the selected text, or new writing at the cursor.
  custom: `${nib} Follow the instruction between <instruction> and </instruction>. If there is text between <text> and </text>, apply the instruction to that text and reply with its new version only. Otherwise write what the instruction asks for, to be inserted into the document; the document between <document> and </document> is context only, so never repeat it. ${markdown}`,
  reply: `${nib} The document is between <document> and </document>, and a comment thread between <text> and </text>. Answer the last comment helpfully in at most four sentences. ${rules}`,
  // The space: numbered sources between <document> tags, the question between <text> tags.
  space: `${nib} Answer the question between <text> and </text> using only the numbered sources between <document> and </document>. After each fact, cite its source as [1], [2]. If the sources do not answer the question, say that you could not find it in this space. At most six sentences. No Markdown.`,
  propose: `${nib} Read the discussion between <text> and </text>. The people who can be assigned are listed between <document> and </document>, with today's date. Propose the next steps. Reply with JSON only, in this shape: {"tasks": [{"text": "a short imperative task", "assignee": "a name from the list, or empty", "due": "YYYY-MM-DD, or empty"}], "decision": "what the discussion decided, in one sentence, or null"}. At most five tasks, only ones the discussion supports. Use null for the decision when nothing was decided.`,
  check: `${nib} Compare the document between <text> and </text> with the decisions in force and the open questions between <document> and </document>. Report only real problems, one per line: "D-9: <what the document says>, but D-9 decided <what was decided>." for a statement that goes against a decision, and "Q: <the question, exactly as listed>: <what in the document depends on it>" for a part that assumes an answer to an open question. If there are none, reply exactly: None found. No other text.`,
} as const
export type Command = keyof typeof prompts
// Commands the editor's Nib menu may send. The others run from the server only.
export const isCommand = (c: string): c is Command => Object.hasOwn(prompts, c) && !['reply', 'space', 'propose', 'check'].includes(c)

// The first {...} in an answer, parsed; null when there is none or it is not JSON.
export const readJson = (out: string): unknown => {
  const m = out.match(/\{[\s\S]*\}/)
  try { return m ? JSON.parse(m[0]) : null } catch { return null }
}

export class AiLimit extends Error {}

// Models sometimes wrap the answer anyway: drop a lead-in line, our tags, and surrounding quotes.
export const clean = (out: string) =>
  out.trim()
    .replace(/^(here is|here's|sure|certainly)[^\n]*:\s*\n?/i, '')
    .replace(/^<text>\s*|\s*<\/text>$/g, '')
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim()

const tag = (name: string, body: string) => (body ? `<${name}>\n${body}\n</${name}>\n\n` : '')

// Fixed answers of the right shape for tests.
const fake = (command: Command, text: string) => {
  if (command === 'propose') return '{"tasks": [{"text": "Book the webinar room", "assignee": "Bea", "due": "2031-05-04"}, {"text": ""}], "decision": "Launch in November"}'
  if (command === 'check') return text ? 'D-1: The text says October, but D-1 decided November.' : 'None found.'
  if (command === 'space') return `AI space: ${text.length} [1] [2]`
  return `AI ${command}: ${text.length}`
}

// Runs one command. `text` is what the command works on, `document` is context, and `instruction`
// is the person's own request (for "custom").
export async function ask(command: Command, text: string, document = '', instruction = ''): Promise<string> {
  if ((env as { AI_FAKE?: string }).AI_FAKE) return fake(command, text) // tests never call the model
  const user = tag('document', document.slice(0, MAX_INPUT)) + tag('instruction', instruction.slice(0, MAX_INSTRUCTION)) + tag('text', text.slice(-MAX_INPUT))
  try {
    const out = await env.AI.run(MODEL, {
      messages: [{ role: 'system', content: prompts[command] }, { role: 'user', content: user.trim() }],
      max_tokens: command === 'custom' ? 1200 : 700,
      temperature: 0.3,
    }) as { response?: unknown }
    // Workers AI hands back an answer that is JSON as an object already; keep it as text.
    return clean(typeof out.response === 'string' ? out.response : out.response == null ? '' : JSON.stringify(out.response))
  } catch (e) {
    // Workers AI answers 4006 when the free daily allowance is used up.
    if (String(e).includes('4006') || /daily free allocation/i.test(String(e))) throw new AiLimit()
    throw e
  }
}
