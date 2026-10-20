# CoWrite explainer films

**Latest: [CoWrite — The thread](FILM.md)** — a rebuilt 72-second film at 1080p / 60 fps, with a continuous visual narrative, original score, and synchronized sound design. Open `preview.html`, or play `film/cowrite-the-thread.mp4`. Editable source: `film.py` and `film/cowrite-film-source.zip`.

## First cut — From thought to done

A 60-second, 16:9 motion graphics explainer for people meeting CoWrite for the first time. On-screen storytelling, original instrumental music, and timed sound effects. No voiceover.

## Deliverables

- `output/cowrite-explainer.mp4` — 1920 × 1080, 30 fps, H.264 + stereo AAC, fast-start web playback.
- `output/cowrite-explainer-reduced-motion.mp4` — the same story and audio with gentle opacity changes instead of spatial movement.
- `preview.html` — accessible, user-initiated player, chapter navigation, reduced-motion preference, downloads, and text transcript.
- `output/storyboard.jpg` and `output/scene-*.jpg` — visual storyboard and individual scene frames.
- `output/music-original.wav`, `output/sound-effects.wav`, `output/mix.wav` — original 48 kHz stereo PCM stems and mix, before mastering.
- `render.py` — editable, deterministic source for every frame and sound.

## Story

| Time | Story beat |
| --- | --- |
| 00–05 | Good ideas get scattered across a draft, a chat, and a task list. |
| 05–10 | CoWrite brings the journey from idea to done into one space. |
| 10–16 | Collect an idea and turn it into a discussion with a decision owner and date. |
| 16–23 | Write together with named cursors and comments in context. |
| 23–30 | Suggest a change, accept it, sign off, and approve. |
| 30–36 | Keep a numbered decision connected to its original discussion. |
| 36–42 | Create an assigned, dated task linked to the work. |
| 42–49 | Nib proposes a shorter introduction; the writer accepts. |
| 49–55 | Version history, offline editing, publishing, slides, and export. |
| 55–60 | Brand, final message, and the real product URL. |

Product examples are simplified illustrations based on `PRODUCT.md`, `README.md`, and the app. Ada, Bea, Launch plan, and D-12 are fictional demo content. They are not customer claims. The app itself is not modified.

## Motion and sound

Frequency gate: rare / first-time. Purpose: **Explanation**.

The film uses predetermined layer transforms and opacity, a six-frame cross-dissolve between chapters, 60 ms stagger on the idea-to-done chain, and a typed sentence with its named cursor. Entrances retain the app's `--ease-out: cubic-bezier(0.2, 0.7, 0.2, 1)`; on-screen travel uses the animate skill's `cubic-bezier(0.77, 0, 0.175, 1)`. Explanatory entrances generally take 650 ms. The reduced-motion export keeps fades and removes position and scale animation. The player never autoplays.

The original 112 BPM score contains 28 bars of soft electric-piano voicings, mallet plucks, bass, and restrained synthesized percussion. Separate effects mark transitions, typing, and accepted changes. No third-party audio samples or songs are used. Final audio is mastered toward −16 LUFS integrated with a −1.5 dBTP ceiling.

The colors come from `app/app.css`. Manrope and Instrument Serif are the product's actual fonts. The talking-C mark follows `app/components/logo.tsx`. Fonts are redistributed with their SIL Open Font License files in `assets/`.

## Rebuild

Requirements: Python with Pillow and NumPy, plus FFmpeg available on PATH.

```sh
python render.py --stills
python render.py
python render.py --reduced-motion
```

Run these from this folder, or pass the absolute path to `render.py`. Rendering does not need network access. If you change the score, remove `output/mix.wav` before rebuilding so the audio stems regenerate.

Open `preview.html` directly, or serve this directory with `python -m http.server 4337 --bind 127.0.0.1` and open `http://127.0.0.1:4337/preview.html`.
