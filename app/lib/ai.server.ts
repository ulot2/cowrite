import { env } from 'cloudflare:workers'

// One place talks to the model. To use Claude later, only this file changes.
// The 70B model follows "rewrite only this text" reliably; the 8B one mixed in the context.
// About 30 neurons a request, so the free 10,000 a day is a few hundred requests.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
// ponytail: the input is cut at 12,000 characters; chunking long documents can come later.
const MAX_INPUT = 12000

const rules = 'Reply with the result only. No introduction, no explanation, no quotes around it, no Markdown. Keep the language of the text.'
const rewrite = (task: string) => `You are an editor. ${task} Change only the text between <text> and </text>. ${rules}`
const prompts = {
  improve: rewrite('Rewrite the text so it is clearer and reads better. Keep its meaning, facts, tone, and about the same length.'),
  fix: rewrite('Fix the spelling, grammar, and punctuation of the text. Change nothing else.'),
  shorten: rewrite('Make the text shorter: cut filler words, merge ideas, and use shorter phrasing. The result must have fewer words than the text, about half for long text. Keep every important fact.'),
  continue: `You are a writer. Write the next one to three sentences that continue the text between <text> and </text>, in the same voice and language. Do not repeat the text. ${rules}`,
  summarize: `Summarize the document between <text> and </text> in two to four sentences. ${rules}`,
  contradictions: `Find statements in the document between <text> and </text> that contradict each other. Write one per line, as "X, but Y". If there are none, reply exactly: None found. ${rules}`,
  actions: `List the action items in the document between <text> and </text>: things someone must do. Write one short imperative sentence per line, starting with the person's name and a colon when the document names who must do it. If there are none, reply exactly: None found. ${rules}`,
  reply: `You are CoWrite AI, an assistant inside a shared document. The document is between <document> and </document>, and the comment thread between <text> and </text>. Answer the last comment helpfully in at most four sentences. ${rules}`,
} as const
export type Command = keyof typeof prompts
export const isCommand = (c: string): c is Command => Object.hasOwn(prompts, c) && c !== 'reply'

export class AiLimit extends Error {}

// Small models sometimes wrap the answer anyway: drop a lead-in line and surrounding quotes.
export const clean = (out: string) =>
  out.trim()
    .replace(/^(here is|here's|sure|certainly)[^\n]*:\s*\n?/i, '')
    .replace(/^<text>\s*|\s*<\/text>$/g, '')
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim()

// Runs one command over the text. `document` is extra context, used only by comment replies.
export async function ask(command: Command, text: string, document = ''): Promise<string> {
  if ((env as { AI_FAKE?: string }).AI_FAKE) return `AI ${command}: ${text.length}` // tests never call the model
  const user = (document ? `<document>\n${document.slice(0, MAX_INPUT)}\n</document>\n\n` : '') + `<text>\n${text.slice(-MAX_INPUT)}\n</text>`
  try {
    const out = await env.AI.run(MODEL, {
      messages: [{ role: 'system', content: prompts[command] }, { role: 'user', content: user }],
      max_tokens: 700,
      temperature: 0.3,
    }) as { response?: string }
    return clean(out.response ?? '')
  } catch (e) {
    // Workers AI answers 4006 when the free daily allowance is used up.
    if (String(e).includes('4006') || /daily free allocation/i.test(String(e))) throw new AiLimit()
    throw e
  }
}
