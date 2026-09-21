# Design notes

The look is quiet editorial: white space, one accent color, a serif for the wordmark and document titles, a sans for everything else. Light and dark follow the system setting.

## Tokens

All values live on `:root` in `app/app.css`, with a dark set under `prefers-color-scheme: dark`. Screens use the token names, never raw values.

| Token | Use |
|---|---|
| `--bg`, `--bg-side`, `--surface` | Page, sidebar, and raised surfaces such as cards and inputs |
| `--fg`, `--fg-muted` | Text, and secondary text (both pass 4.5:1 on their backgrounds) |
| `--border`, `--hover` | Hairlines, and the hover wash on rows and menu items |
| `--accent`, `--accent-soft`, `--accent-fg` | The one accent, its 16% wash for focus rings and the active item, and text on top of it |
| `--ok`, `--warn`, `--warn-soft`, `--danger` | Status colors. Never decoration. |
| `--radius`, `--sidebar`, `--measure` | 6 px corners, the sidebar width, and the 42rem text column |
| `--font`, `--font-display` | Instrument Sans, Instrument Serif |
| `--t-fast`, `--t-base`, `--ease-out`, `--ease-in` | 150 ms for hover and focus, 220 ms for enter and exit |

## Motion

Only `opacity` and `transform` animate. Enter is a fade with a 6 px rise (`rise`) or drop (`drop`); avatars scale in (`pop`); pages fade. Lists stagger by 30 ms per row. Everything is off under `prefers-reduced-motion: reduce`.

## Parts

- Shell: sidebar with the wordmark, a secondary "New document", the document list with the active item in the accent wash, and the account menu (a native `<details>`). On phones the sidebar is a drawer behind a Menu button.
- Documents page: heading, count, one primary action, rows with title, "Edited 2 hours ago", and member avatars. Delete shows on hover or focus.
- Document page: presence avatars top right, a quiet pill only while connecting or offline, the title in the display serif, the text on the page itself.
- Avatars: initials on the user's color, which comes from a hash of the user id, so it is the same everywhere.

## Accessibility

Every control has a visible focus ring. Names on cursors are text. The status pill has `role="status"`. The Tab key moves focus and never gets trapped in the editor.
