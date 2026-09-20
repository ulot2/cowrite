# cowrite

Two browser tabs edit one text document at the same time. Each tab sees the other user's cursor and name. A tab that goes offline keeps working and merges cleanly when it returns.

[![CI](https://github.com/ulot2/cowrite/actions/workflows/ci.yml/badge.svg)](https://github.com/ulot2/cowrite/actions/workflows/ci.yml)

![Two editors side by side. Text typed in one appears in the other, with a named cursor.](docs/demo.gif)

## Try it

Live demo: **https://ulot2.github.io/cowrite/**

1. Open the link in two tabs.
2. Type in one tab. The other tab follows, and shows your cursor with your name.
3. Click "Go offline" in one tab, type in both, then click "Reconnect". Both tabs end with the same text.

The server sleeps on the free tier after 15 minutes without visitors. The first connection can take up to a minute. The page says "Connected" when it is ready.

## Why this exists

Collaborative editing is a common feature, and most explanations of it stop at the theory.
This repo is the smallest complete version I could ship: one document, one server file, one test that proves the offline merge.
The goal is a demo that a recruiter can open in two tabs and understand in one minute.

## How it works

The document is a CRDT (a data structure that merges edits from any order to the same result). We use the [Yjs](https://github.com/yjs/yjs) library for that. Each tab holds a full copy of the document. The server holds a copy too, and forwards changes between tabs over WebSockets (a two-way connection that stays open).

```mermaid
sequenceDiagram
    participant A as Tab A
    participant S as Server (server/index.js)
    participant B as Tab B
    A->>S: connect
    S->>A: sync step 1: "here is what I have"
    A->>S: sync step 2: "here is what you miss"
    A->>S: update: insert "hello" at 0
    S->>B: update: insert "hello" at 0
    A->>S: awareness: cursor at 5, name "Ada"
    S->>B: awareness: cursor at 5, name "Ada"
    Note over B: B goes offline, edits locally
    B->>S: reconnect, sync step 1 and 2
    S->>A: update: B's offline edits
```

Two channels flow through the server:

- Document updates. Each keystroke becomes a small binary update. Every tab applies every update, and Yjs guarantees that all tabs end with the same text, whatever the order of arrival.
- Awareness. Cursor position, name, and color. This channel is not stored. When a tab closes, its cursor disappears from the other tabs.

When a tab reconnects, the two sides exchange "state vectors" (a list of how many changes each side has seen from each client) and send only the missing updates. That is why the time offline does not matter.

Tabs of the same browser also sync directly through BroadcastChannel. The status line reports the server connection, not that shortcut.

## Run it locally

1. Install the dependencies with `npm install`.
2. Start the server with `npm run server`. It listens on port 1234.
3. Start the page with `npm run dev`, then open http://localhost:5173 in two tabs.

## Deploy

1. Server: on Render, create a new Blueprint instance from this repo. Render reads `render.yaml` and runs the server on the free plan.
2. Page: set the repository variable `WS_URL` to the server address with `wss://`. Then push to `main`, or run the CI workflow by hand. It builds the page and publishes it to GitHub Pages.

## Tests

`npm test` runs two tests against a real server on a free port:

- One tab goes offline, both tabs edit, the tab returns. Both tabs end with the exact same text.
- Two offline tabs insert at the same position. Both inserts survive, and both tabs agree on one order.

## Accessibility

- The editor is a native text box for screen readers, with a label, and it works with the keyboard alone. The Tab key moves focus and does not get trapped.
- The other user's cursor carries a text label with their name, not only a color.
- The status line (`role="status"`) announces connection changes and who is present.

## Limits

- One document, plain text, no accounts. That is the scope.
- The server keeps the document in memory. A restart empties it, and the connected tabs then send their copy back.

## Stack

TypeScript, Vite, CodeMirror 6, Yjs, y-websocket, a 90-line Node server on `ws`. Frontend on GitHub Pages, server on Render's free tier.
