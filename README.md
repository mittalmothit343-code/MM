# Two Ships in an Infinite Ocean

A story for Mohit & Sezal. One 3D ocean, told two ways:

- **The film** — a 1 minute 52 second cut with its own camera, captions and
  transport controls. Press play and watch.
- **The scroll story** — the same world, paced by the reader, with the harbour
  chapters, the ship's log and the photo gallery underneath.

Three files, no build step. Three.js and GSAP come from a CDN.

---

## Running it

Because the gallery discovers photos by requesting them, open the folder over
HTTP rather than double-clicking `index.html`:

```bash
cd two-ships
python3 -m http.server 8000     # then visit http://localhost:8000
```

To publish it, drop the folder on any static host — Netlify, Vercel, GitHub
Pages, Cloudflare Pages. There is nothing to build.

---

## Editing the words

Everything the story says about the two of you lives in one object: `CONFIG` at
the top of `script.js` (§0). Change it once and the scroll scenes, the island
labels, the popups, the ship's log and the film all update together.

```js
const CONFIG = {
  rokaDate: '17th May 2026',
  names: { first: 'Mohit', second: 'Sezal' },
  harbors: [
    {
      date:  '30th May 2026',        // shown in the scene and the log
      short: '30 MAY',               // painted on the island in 3D — keep it tiny
      numeral: 'XI',                 // the scene's chapter mark
      name:  'The First Harbor',     // the scene heading
      story: '…',                    // the main line
      gift:  '…'                     // the quiet italic line underneath
    },
    …
  ]
};
```

**The four harbour entries are placeholders.** Replace `name`, `story` and
`gift` with what actually happened on those days — that is the part only you
can write.

Adding a fifth harbour to the array is enough on its own: a fifth island
appears on the water at the right point on the path, a fifth scene is cloned
into the page, and the log grows a row. Nothing else needs touching.

---

## Adding photos

Two places want photos. Both are discovered automatically — no filenames to
register anywhere.

**The main gallery** — number them from 1, contiguously:

```
assets/photos/1.jpg
assets/photos/2.jpg
assets/photos/3.png     ← jpg, jpeg, png and webp all work
```

**Per-harbour photos** — these become the flag flying on that island and the
photos in its popup. The first number is the harbour (1–4), the second is the
photo within it:

```
assets/photos/harbors/1-1.jpg    ← flies on island 1
assets/photos/harbors/1-2.jpg
assets/photos/harbors/2-1.jpg
```

Until real photos exist the popups show generated placeholders and say so. If
you would rather not manage files, paste a URL straight into
`CONFIG.harborPhotos` instead:

```js
harborPhotos: { 1: 'https://example.com/ourphoto.jpg', 2: null, 3: null, 4: null }
```

**Link previews:** add `assets/og.jpg` at 1200×630 and shared links will show
it. The meta tags already point there.

---

## Retiming the film

The film is one paused GSAP timeline in `script.js` §8. Shots are written in
absolute seconds, so it reads like a shot list:

```js
cut(28, [-31, 7, -5], [START_M.x, -1, START_M.z]);   // hard cut at 0:28
move(28, 8, [-17, 4.5, -8], [START_M.x, -0.8, START_M.z]);  // drift for 8s
cue(29.2, 5.2, 'name', '…MOHIT…');                   // caption, 5.2s on screen
```

- `cut(at, cameraPos, lookAt)` — the camera is somewhere new on the next frame.
- `move(at, dur, cameraPos, lookAt, ease)` — it drifts within the shot.
- `cue(at, dur, kind, html)` — a caption. `kind` is one of `title`, `sub`,
  `name`, `quote`, `roka`.

If you change the runtime, update `FILM_DURATION`, the `FILM_CHAPTERS` port
list (those are the marks on the transport), and the `1:52` label on the entry
button in `index.html`.

Anything that is a *state* rather than a movement — the radar's readout, which
ships are lit, the glow at the meeting — is derived from the playhead inside
`renderFilmFrame()`. That is deliberate: it means dragging the scrubber
backwards genuinely undoes things instead of leaving the radar stuck on
"TARGET FOUND".

### Controls

| | |
|---|---|
| Space | play / pause |
| ← → | back / forward 5s |
| Shift + ← → | 15s, when the scrubber has focus |
| Esc | leave the film |

---

## Sound

There are no audio files. Everything is synthesised live in the browser with
the Web Audio API (`script.js` §5): the swell is filtered noise with a slow
low-pass breath, the score is a three-oscillator drone that the film raises and
lowers by act, and the pings and stings are short enveloped tones. Nothing can
go missing, and the whole thing costs zero bytes of download.

If you would rather use real recordings, replace §5 with `<audio>` elements and
keep the same function names — everything else calls into them.

---

## Performance

The ocean is the expensive part: a 400×400 plane whose vertices are displaced
every frame. Two things keep it honest.

- **Device tiering.** `PERF` at the top of `script.js` measures the device once
  and picks the mesh density, star count, ship count and pixel ratio to match.
  Phones get a 56×56 ocean, desktops 96×96.
- **Analytic normals.** Lighting normals are computed from the wave's own slope
  rather than by rebuilding every face normal with `computeVertexNormals()`
  each frame. Same surface, a fraction of the work.

Rendering pauses entirely when the tab is hidden.

---

## Accessibility

Reduced motion is respected both from the OS and from the checkbox on the entry
screen: waves stop, the radar sweep stops, the camera stops swaying, and
transitions collapse to near-instant. Everything stays readable and the story
still tells itself.

The gallery and popups are keyboard-operable, focus is returned to wherever it
came from when a dialog closes, and the film's scrubber is a real
`role="slider"` with arrow-key control.
