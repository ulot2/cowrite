# CoWrite — The thread

The second cut is a 72-second product film with a continuous narrative: one idea becomes a shared draft, an accepted improvement, a recorded decision, an assigned task, and a published guide. A cobalt thread makes the relationships visible.

## Delivery

- `film/cowrite-the-thread.mp4`: 1920 × 1080, 60 fps, H.264, stereo AAC at 48 kHz, fast-start playback.
- `film/cowrite-the-thread-gentle.mp4`: the same edit with gentler motion.
- `preview.html`: player with chapter navigation, readable transcript, and system reduced-motion support.
- `film/storyboard.jpg`: 17-frame storyboard.
- `film/music.wav`, `film/effects.wav`, `film/mix.wav`: original unmastered stereo stems, 48 kHz / 16 bit.
- `film/cowrite-film-source.zip`: portable rendering source and licensed brand fonts.
- `film.py`: complete editable motion and audio source.

The first version remains in `output/`, with its original source in `render.py` and player in `preview-v1.html`.

## Edit

| Time | Scene and motion |
| --- | --- |
| 00:00–00:08 | Kinetic typography, scattered paper fragments, a gathering thread. |
| 00:08–00:13 | A geometric blue reveal resolves into the CoWrite wordmark. |
| 00:13–00:23 | A moving camera frames a shared document, simultaneous typing, named cursors, and a contextual comment. |
| 00:23–00:31 | A close-up turns the comment into a suggested edit, an accepted change, and a sign-off. |
| 00:31–00:39 | Nib’s suggestion appears; the writer explicitly accepts it. |
| 00:39–00:49 | The camera follows a connected discussion, decision, and task. |
| 00:49–00:57 | Layered versions and an offline edit demonstrate continuity. |
| 00:57–01:04 | One document fans out into public, PDF, Word, and slide formats. |
| 01:04–01:12 | The thread recaps the journey and resolves into the final brand card. |

Names, documents, and decisions are illustrative. Product claims come from `PRODUCT.md`, `README.md`, and the local app, not invented testimonials or usage figures. This work does not change the product application.

## Motion

Gate: first-time marketing. Purpose: **Explanation**. The vector renderer uses Skia for antialiasing, nested transforms, clipping, and camera composition. Typography is rasterized at double resolution from the actual Manrope and Instrument Serif fonts.

The app’s `cubic-bezier(0.2, 0.7, 0.2, 1)` controls entrances. The animate skill’s `cubic-bezier(0.77, 0, 0.175, 1)` controls spatial changes. Typical explanatory entrances run 600–900 ms, with 60–70 ms stagger; longer camera moves demonstrate relationships. Motion primarily changes transform and opacity, with path and clipping reveals for the thread and the blue transition.

The gentle edit removes camera travel, rotations, cursor pointers, and paper movement, and uses fades for entrances. The player does not autoplay. Text remains available as a transcript.

## Sound

An original 36-bar, 120 BPM composition: layered piano harmonics, warm bass, wide pads, a small melodic motif, and restrained percussion. The arrangement opens quietly, builds with the product reveal, breaks down around the decision sequence, and resolves beneath the final wordmark. Short reflections add depth.

Separate paper sounds, stereo swishes, typing, clicks, acceptance chords, and a three-note closing motif are timed to actions. Every sound is synthesized by the source; there are no third-party songs, samples, or voiceovers. The final mix targets about −16 LUFS with headroom for AAC encoding.

## Rebuild

Install Python 3.12+ and FFmpeg, then:

```sh
python -m pip install Pillow numpy skia-python
python film.py --audio
python film.py --stills
python film.py
python film.py --reduced-motion
```

`python film.py --draft` produces a 960 × 540 / 24 fps proof. The renderer reads `assets/` beside the script. If you edit the score, regenerate it with `--audio` before rendering. Rendering needs no network access.

The local `.runtime/` directory is only a development dependency cache and is excluded from Git and the portable source bundle. Both fonts retain their SIL Open Font License files.
