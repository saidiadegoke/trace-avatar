# Changelog

## 0.1.3

Guides for a whole app with one script tag.

- Loader (`trace-avatar/auto`, CDN `trace-auto.min.js`): a guide manifest (`guides/index.json`, schema
  `trace-avatar/guides.schema.json`, `validateManifest`), a corner launcher that lists the guides for the current
  page ("Show me · Do it for me"), and `data-trace-guide="id"` (+ `data-trace-mode`) on any element. While a guide
  plays the launcher is a Stop button; a guide carries on after a full page load.
- Script attributes `data-guides`, `data-launcher` (`bottom-right` default, `bottom-left`, `off`), `data-perform`.
  Do it for me is offered only when the manifest entry and the app both allow it.
- `mount()` from npm, `<TraceGuides>` in `trace-avatar/react`, `<trace-guides>` in `trace-avatar/element`.
  Errors (unknown ids, refused modes, load failures) go to `error` listeners, or the console when there are none.
- The player is fetched on the first play. Budgets: the loader 5.5 KB (CDN and npm, before the first play).
- New example: `examples/guides-html/` (one script tag); the React example adds `AppGuides`.

## 0.1.2

Guides that do the work, and wait for the app to catch up.

- Perform mode (`mode: 'perform'`, from `trace-avatar/perform`; CDN `trace-perform.min.js`): the guide clicks, types,
  presses keys and hovers on the real page. Values go through the native setter plus `input`, so React, Vue and Svelte
  controlled inputs see them; selects pick their option by text; rich-text boxes get `insertText`; Enter in a form
  field submits it. Its own events are never taken for a viewer takeover. Meant for sandbox and demo data.
- Masked fields are handed over: the guide stops ("Your turn: type in “Password”, then press play"), focuses the field
  and emits `handoff`; play carries on from the next step.
- `wait` steps take `until: { text }` (the element, or the page, shows that text) or `until: { gone: true }` (the
  element went away), checked at most every 250 ms and only when the page changed. A `wait` with `until.text` needs no
  target. `timeout` is capped at 10 minutes.
- `checkpoint: true` on a step: after a takeover in perform mode, play resumes from the next checkpoint. Perform mode
  never seeks back; a restart starts over.
- `prepare(requires, trace)` runs before a guide starts and may block it with a message (`blocked` event; caption
  shown even without a cursor). `meta.requires` (e.g. `['signed-in']`); the recorder's `requires` option fills it in.
- `onReset()` puts the app back before a perform-mode restart.
- `resumeKey`: carry on across full page loads (sessionStorage, 10 minutes).
- Custom element: `mode` and `resume-key` attributes, a `hooks` property, `trace-handoff` / `trace-blocked` events.
  React: `onHandoff`, `onBlocked`, and `navigate` / `prepare` / `onReset` / `currentPath` that always call the latest
  render's function.
- Examples and docs cover both modes: the vanilla example and the playground switch between Show me and Do it for me
  (they load `trace-perform.min.js`, which plays both); the React example adds `DoItForMe` and `ShowOrDo`; the
  README leads with the two modes. Every example runs in the browser tests, in both modes.
- Size budgets: player, React and CDN 12.5 KB → 14 KB (`until`, prepare, resume, handoff); perform entry 15.5 KB.

## 0.1.1

Found by recording a real Next.js app (DutyCaptain).

- Pages: steps may name their `page` (`*` = one segment; inherited by later steps). The recorder fills it in. On the
  wrong page the guide does not search; it waits ("Open /path to continue"), never stalls, and resumes when the viewer
  arrives. `navigate: (path) => router.push(path)` lets it go there itself; a `page` event (`trace-page`, `onPage`)
  reports each one. A viewer who clicked ahead is caught up with, never past the start. `currentPath` option.
- Size budgets: player and CDN build 12 KB → 12.5 KB (pages).

- Player: a recorded pixel point no longer stands in for an element that has a selector, role or text until looking
  for it has given up. A step whose page is not there yet now waits ("Looking for …") instead of pointing at an empty
  spot; after `stalled` the cursor goes to the recorded point.
- Recorder: a field you type into is never described by what was typed in it (rich-text editors included).
- Recorder: `meta.url` is the page the recording started on, where playback must begin.
- Recorder: addresses holding a record id (`/tasks/bfd02a18-…`, `/orders/4213`) are not used as selectors; a card is
  named by its title, not its changing status text.
- Recorder: the same link in two places (sidebar and header) is told apart by its landmark: `nav a[href="/app/tasks/new"]`.
- Recorder: pauses over 4 s (a file picker, a phone call) play back as 1.5 s. Option `maxGapMs` (0 keeps real time).
- Recorder: option `scrolls` — `'auto'` (default) drops scrolls the player does anyway, since it scrolls each target
  into view; `'all'` keeps every one.

## 0.1.0

- Player: element-anchored steps (`move`, `click`, `dblclick`, `type`, `key`, `scroll`, `hover`, `wait`, `note`),
  curved human-paced motion or recorded paths, captions, typing and key chips, target ring, click ripples.
- Locators: CSS selector → role + accessible name → visible text → scaled recorded pixels; custom locators.
- Missing elements wait with a "Looking for …" caption and report `stalled`; off-screen elements scroll into view.
- Controls bar, keyboard shortcuts, viewer takeover (pause on real input), pause steps, seek/next/prev/rate, loop.
- Reduced motion, `aria-live` captions, touch traces, theming via CSS custom properties, dark mode.
- React adapter (`trace-avatar/react`), custom element (`trace-avatar/element`), CDN build (`TraceAvatar` global).
- `trace.json` v1 with a published JSON Schema.
- Recorder (`trace-avatar/record`, CDN `TraceAvatarRecord`): clicks, double-clicks, typing, shortcuts, scrolls and the
  pointer path into a valid trace; stable selectors; masking by default with `data-trace-reveal` / `data-trace-mask`;
  `data-trace-ignore`. Playground Record and Download.
