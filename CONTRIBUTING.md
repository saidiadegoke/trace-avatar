# Contributing

Thanks for helping. A few rules keep the library small and dependable.

## Setup

```bash
npm install
npx playwright install chromium firefox webkit
npm run check      # typecheck + unit + e2e (3 engines) + size budgets
```

`npm run serve` serves the repo at http://127.0.0.1:4173. Open `/examples/vanilla-html/` (Show me / Do it for me
switch at the bottom left, or `?mode=perform`) or `/playground/` (pick the mode next to Play).

## Two modes, one player

The library plays a trace in two modes, and nearly everything is shared between them:

- **Show me** (`mode: 'overlay'`, the `trace-avatar` entry, `trace.min.js`): draws over the page and never touches it.
- **Do it for me** (`mode: 'perform'`, the `trace-avatar/perform` entry, `trace-perform.min.js`): the same player,
  plus hands that click, type and press keys.

Where things live:

| | |
|---|---|
| `src/core/` | the pure player (`player.ts`: reducer + effects, both modes), the format and validator (`format.ts`), motion, the recorder core (`build.ts`) |
| `src/shell/` | browser adapters: page lookup and `until` checks (`page.dom.ts`), the overlay (`renderer.shadow.ts`), input, the perform hands (`perform.dom.ts`), the recorder (`recorder.dom.ts`) |
| `src/index.ts` | the facade: `createTrace`, events, `prepare` / `onReset` / `resumeKey`, running effects |
| `src/perform/` | the Do it for me entry: re-exports everything and wires in the hands |
| `src/auto/` | the guides loader: `mount.ts` (manifest, launcher, buttons, carrying on) takes its chunk loaders as arguments; `index.ts` (npm, `import()`) and `cdn.ts` (script tag) pass them. The manifest is `src/core/manifest.ts`, the launcher `src/shell/launcher.dom.ts` |
| `src/react/`, `src/element/` | adapters; both pass `mode` and `performer` through |
| `examples/`, `playground/` | both offer both modes; keep it that way when you add an example |

The player decides *what* happens (an `act` or `handoff` effect in perform mode); the shell decides *how*. Mode
differences belong in the player as data (effects, pause reasons), not as `if (perform)` scattered through the shell.

## Rules

- **Every function and every feature has a test.** Pure logic gets unit tests (`tests/unit`, Vitest);
  anything about the real page gets a Playwright test (`tests/e2e`) that runs on Chromium, Firefox and WebKit.
- **Test both modes.** A feature that changes playback is tested as Show me and as Do it for me (or the test says
  why it applies to one). Perform features are tested against a real framework too: `tests/e2e/fixtures/*.tsx` are
  React apps bundled by `scripts/fixtures.mjs` (run by `npm run test:e2e`; the `.js` output is gitignored).
- **Examples are tested.** The vanilla and guides examples, the playground, the README quick starts and the React example
  (mounted by `tests/e2e/fixtures/react-example.tsx`) all run in `tests/e2e/examples.spec.ts`.
- **`src/core/` is pure**: no `window`, `document`, `Date.now` or `Math.random`. Time comes from the clock port,
  randomness from the trace seed. This is what makes seeking and golden-frame tests possible.
- **The shell is thin.** Each frame reads layout, then computes, then writes. Never read layout after writing.
- **Perform mode is careful.** Its events are synthetic (`isTrusted: false`) and must never be taken for a viewer
  takeover. A masked field's text is never in a trace: the viewer types it. Act errors are emitted, never thrown.
- **The trace format is the contract.** A change to it updates `schema/trace.v1.json`, the validator in
  `src/core/format.ts`, and the contract fixtures in `tests/unit/schema.test.ts` together.
- **Size budgets.** `size-limit` fails CI if a bundle grows past its limit (player, React, CDN, perform, recorder).
  If you must raise one, say why in the PR and in the CHANGELOG.

See `docs/` in the design notes for the architecture (functional core, reducer + effects, ports).
