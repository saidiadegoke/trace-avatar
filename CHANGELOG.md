# Changelog

## 0.1.0 (unreleased)

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
