import { env } from 'cloudflare:workers'

// One place talks to the model. To use Claude later, only this file changes.
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast'
// ponytail: the input is cut at 12,000 characters; chunking long documents can come later.
const MAX_INPUT = 12000

const plain = 'Answer with the result only: no preface, no quotes, no Markdown.'
const prompts = {
  improve: `Rewrite the text to be clearer and better written. Keep its meaning, language, and length. ${plain}`,
  shorten: `Rewrite the text to be about half as long. Keep every fact. ${plain}`,
  continue: `Write the next one or two sentences that continue the text, in the same voice. Do not repeat the text. ${plain}`,
  summarize: `Summarize the document in two to four sentences. ${plain}`,
  contradictions: `List every pair of statements in the document that contradict each other, one per line, as "X, but Y". If there are none, answer "None found". ${plain}`,
  actions: `List the action items in the document, one short imperative sentence per line. If there are none, answer "None found". ${plain}`,
  reply: `You are CoWrite AI, a helpful assistant inside a shared document. Answer the last comment in the thread in at most four sentences, using the document when it helps. ${plain}`,
} as const
export type Command = keyof typeof prompts
export const isCommand = (c: string): c is Command => Object.hasOwn(prompts, c) && c !== 'reply'

export class AiLimit extends Error {}

// Runs one command over the text. `context` is the whole document for commands on a selection.
export async function ask(command: Command, text: string, context = ''): Promise<string> {
  if ((env as { AI_FAKE?: string }).AI_FAKE) return `AI ${command}: ${text.length}` // tests never call the model
  const user = (context ? `Document:\n${context.slice(0, MAX_INPUT)}\n\n` : '') + `Text:\n${text.slice(0, MAX_INPUT)}`
  try {
    const out = await env.AI.run(MODEL, { messages: [{ role: 'system', content: prompts[command] }, { role: 'user', content: user }], max_tokens: 700 }) as { response?: string }
    return (out.response ?? '').trim()
  } catch (e) {
    // Workers AI answers 4006 when the free daily allowance is used up.
    if (String(e).includes('4006') || /daily free allocation/i.test(String(e))) throw new AiLimit()
    throw e
  }
}
