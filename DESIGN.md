# Design notes

The look is "Studio": a white page, a gray tint only on the things you can pick up (cards, the search field, the active item), one cobalt accent, Manrope for everything except the italic serif wordmark. Light and dark follow the system setting, and the account menu can pin either one.

## Tokens

All values live on `:root` in `app/app.css`. Dark redefines the same names under `prefers-color-scheme: dark` (unless the page is pinned light) and under `[data-theme="dark"]`. Screens use the token names, never raw values.

| Token | Use |
|---|---|
| `--bg` | The page, the top bar, the sidebar |
| `--tint`, `--tint-2` | Cards, the search field, the active sidebar item, hover; `-2` is the hover of a tinted thing |
| `--fg`, `--fg-muted` | Text, and secondary text (both pass 4.5:1) |
| `--border` | Hairlines only: the top bar, the sidebar, dividers |
| `--accent`, `--accent-hover`, `--accent-soft`, `--accent-fg` | The one accent: primary button, active icon, focus ring; `-soft` is the focus wash, `-fg` the text on the accent |
| `--ok`, `--warn`, `--warn-soft`, `--danger` | Status colors. Never decoration. |
| `--shadow` | Only floating things: the account menu, the phone drawer |
| `--radius`, `--radius-lg` | 8 px controls, 12 px cards and menus |
| `--topbar`, `--sidebar`, `--rail`, `--measure` | 3.5rem bar, 14rem sidebar, 3.5rem collapsed rail, 42rem text column |
| `--font`, `--font-display` | Manrope, Instrument Serif (wordmark only) |
| `--t-fast`, `--t-base`, `--ease-out`, `--ease-in` | 150 ms for hover and focus, 220 ms for enter, exit, and the sidebar |

## Motion

Only `opacity`, `transform`, and the sidebar's grid column animate. Enter is a fade with a 6 px rise (`rise`) or drop (`drop`); avatars scale in (`pop`); pages fade; cards stagger by 30 ms. Everything is off under `prefers-reduced-motion: reduce`.

## Parts

- Top bar: wordmark, search (goes to Documents with `?q=`), the one primary button, and the account avatar. The avatar opens a native `<details>` menu with name, email, the theme choice, and sign out.
- Sidebar: Home and Documents with line icons, and a collapse control at the bottom. Collapsed, it is an icon rail. The state is saved per browser and applied before the first paint. On phones it is a drawer behind a menu button.
- Home: a greeting and the six most recent documents. Documents: all of them, with search and delete.
- Cards: title, the first lines of the text (written by the document object a few seconds after an edit), when it changed, who is on it.
- Document page: breadcrumb, presence avatars top right (a green dot means that person has a cursor in the text), a quiet pill only while connecting or offline, the title in Manrope at 2.5rem, the text on the page itself.
- Editor: BlockNote with its colors mapped to our tokens (`.bn-container` in `app.css`), so menus and the toolbar match both themes. The other user's cursor label stays visible; the library only shows it on hover.
- Comments: a "Comments" button with the open count in the presence row opens a panel beside the text (a sheet from the bottom on phones) with an Open / Resolved switch. Commented text carries the accent wash; the selected thread's text the warning wash. The library's icon-only actions get accessible names from a small observer.
- Login: a two-column page, statement left, tinted form card right.

- Share: a native `<dialog>` from the "Share" button in the presence row. Members with a role select, add by email, the link with copy and revoke, the space select. A space page uses the same header row as a document (breadcrumb, then the public switch and Share as icon tools), an eyebrow that says private or public, the name, and a meta line with the members' avatars and "New document".
- Sidebar: a "Spaces" group under Documents, one link per space and a small "New space" field.
- Cards: the space name in the accent color above the preview when the document is in a space.
- History: the same one-row header as the document (breadcrumb, "Open the document"), then a "Version history" eyebrow in the accent and the document title. Versions are a timeline on the left (a dot per version on a hairline, the selected one filled with the accent) with the "Name this version" field above; on phones the timeline becomes a strip of chips that scrolls sideways, so the text stays near the top. The chosen version sits on a sheet (white, hairline, soft shadow) with the author's avatar, "Compare to" and "Restore". The diff is a list of blocks: removed on the warning wash with a strike, added on the accent wash, each with a text label so color is not the only signal.
- Document header: the breadcrumb and the status pill on the left (Draft grey, In review warning, Approved green; owners and reviewers open it for the moves they may make), then the presence avatars and the tools: Suggest (pressed while on; a reviewer sees it on and locked), Comments, History, Share. The header spans the wide column; the title and the text sit centered at the measure.
- Suggestions: insertions on the accent wash with an accent underline, deletions struck on the warning wash, changed formatting with a dotted underline. Hovering a suggestion shows a small card under it: "Suggested by Bea" with Accept and Reject. A quiet bar above the text says how many suggestions there are and, while the cursor is in one, who made it, with Accept and Reject; otherwise Accept all and Reject all.
- Mentions: "@Name" in a comment, accent text on the accent wash, picked from a menu of the members that opens on `@`.
- Reading view: the document outside the editor, at the measure, in the same type as the editor. Public page: only the wordmark above and "Written with cowrite" below, the title, the published date. Print: the same page with a hint bar that stays off paper.
- Slides: one idea per screen, the heading large and fluid (`clamp`), the bar fades away in full screen and comes back on hover or focus, a counter below, notes on the warning wash.
- More menu (⋯): Present and the four exports, the same popover as the status menu. Outline: the side panel lists the headings, indented by level, level 1 in bold.
- Search results: the matched words on the accent wash inside the card, "In a comment" when the hit is there.
- Task block: a checkbox, the text, a quiet assignee dropdown, and a date; done tasks are struck through in the muted color. Decision block: a tinted callout with "D-12" and a status dropdown; decided has a green edge, dropped is struck through.
- Tasks page: groups in planning order (Overdue in red, This week, Later, No date, Done), one hairline row per task with a round tick that fills green.
- Board: tinted columns that scroll sideways (85% of the screen on phones), white cards that lift on hover and tilt while dragged, an up-vote that turns accent when it is yours, a card menu with Move to, Turn into (a task, a document), and Delete.
- New menu: Write, Brainstorm, Plan, and Review, each with a one-line description.
- Bell: in the top bar, a count badge in the accent, the same popover as the account menu with the newest twenty events and a dot on the unseen ones.
- Activity: rows grouped by day (Today, Yesterday, then dates) with the actor's avatar, the sentence, a link to the document, and the relative time. Shown under the cards on a space page and under the versions on a history page.

## Accessibility

Every control has a visible focus ring. Icons are decorative; the label next to them carries the meaning, also in the collapsed rail (`aria-label`). Names on cursors are text. The status pill has `role="status"`. The Tab key moves focus and never gets trapped in the editor.
