# Changelog

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
