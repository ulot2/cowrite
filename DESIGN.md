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

## Accessibility

Every control has a visible focus ring. Icons are decorative; the label next to them carries the meaning, also in the collapsed rail (`aria-label`). Names on cursors are text. The status pill has `role="status"`. The Tab key moves focus and never gets trapped in the editor.
