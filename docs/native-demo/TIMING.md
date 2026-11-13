# cowrite: 58-second demo, timing sheet

`cowrite-native-demo.mp4` is 58.0 s, 1920×1080, 30 fps, H.264, and silent.
`cowrite-native-demo-voiceover.mp4` is the same video with the recorded voiceover (AAC, −16 LUFS).
Native's form asks: "Why did you build it, and how did you approach it?" (one minute max).

Everything on screen is the live app at cowrite.tnuell.sbs, with two demo accounts (Ada Okafor, Bea Lindqvist).
Nib's answers are real model output. Waits are trimmed and some parts are sped up (about 1.1× to 2×).
The test run is the real `npm test` log from this repository, shown sped up.

| # | Time | On screen | Say (about two short sentences) |
|---|------|-----------|----------------------------------|
| 1 | 0:00–0:06 | The "Launch plan" space. Needs attention lists a late task, a task due this week, an open question for Bea, and a document waiting for review. Nib's "This week" summary is below. | "Teams decide things in chat, write them in docs, and track them in a task list. Then nobody remembers why. I built cowrite to keep the decision, the discussion, and the work in one place." |
| 2 | 0:06–0:17 | Split screen, same document. Ada types a sentence and it appears live in Bea's window under Ada's named cursor. Bea selects "a short weekly check-in" and comments; Ada clicks the highlight and sees Bea's thread. | "Under the hood, every document is a Yjs CRDT. Each document has its own Cloudflare Durable Object, so every keystroke passes through one place in order and reaches everyone live." |
| 3 | 0:17–0:23 | Bea's browser goes offline (red label). Both people keep typing; neither sees the other's sentence. Bea comes back online (green label) and both windows end with identical text. | "Go offline and keep writing. When you reconnect, the two sides swap only what the other is missing, and the text merges with nothing lost." |
| 4 | 0:23–0:36 | Ada selects the wordy paragraph and asks Nib to make it shorter. Nib's real rewrite arrives as a suggestion; both windows read "Suggestion 1 of 1 · by Nib". Ada accepts it. | "Nib, the AI assistant, never edits behind your back. Its answer arrives as a suggestion that a person accepts or rejects." |
| 5 | 0:36–0:46 | Ada asks the space "What have we decided, and what is still open?" Nib answers with numbered sources [1]–[4]. Ada opens source 1, decision D-1, and scrolls to "Why": the brief and the discussion that produced it. | "You can ask the whole space a question and get an answer with numbered sources. Every decision links back to the conversation that made it." |
| 6 | 0:46–0:54 | The real `npm test` run, sped up, ending on `# tests 128`, `# pass 128`, `# fail 0`. | "It's backed by 128 end-to-end tests over real WebSockets, including the offline merge. They all pass." |
| 7 | 0:54–0:58 | End card: the cowrite logo and cowrite.tnuell.sbs. | "It's live at cowrite.tnuell.sbs. Try it in two tabs." |

## Notes

- Crossfades (0.3 s) start at 0:06, 0:36, 0:46 and 0:54. Segments 2–4 are one continuous split-screen take.
- Say **128** tests (or "over a hundred"). An older line in the application email and in the README says sixty-one, but the suite now has 128, and the video shows 128.
- The "Ada's browser" and "Bea's browser · offline / back online" labels are added in editing. The network was really cut: while offline, neither window had the other's sentence.
