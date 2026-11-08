# Contributing

Thanks for helping. A few rules keep the library small and dependable.

## Setup

```bash
npm install
npx playwright install chromium firefox webkit
npm run check      # typecheck + unit + e2e (3 engines) + size budget
```

`npm run serve` serves the repo at http://127.0.0.1:4173 — open `/examples/vanilla-html/` or `/playground/`.

## Rules

- **Every function and every feature has a test.** Pure logic gets unit tests (`tests/unit`, Vitest);
  anything about the real page gets a Playwright test (`tests/e2e`) that runs on Chromium, Firefox and WebKit.
- **`src/core/` is pure**: no `window`, `document`, `Date.now` or `Math.random`. Time comes from the clock port,
  randomness from the trace seed. This is what makes seeking and golden-frame tests possible.
- **The shell is thin.** Each frame reads layout, then computes, then writes. Never read layout after writing.
- **The trace format is the contract.** A change to it updates `schema/trace.v1.json`, the validator in
  `src/core/format.ts`, and the contract fixtures in `tests/unit/schema.test.ts` together.
- **Size budget.** `size-limit` fails CI if a bundle grows past its limit. If you must raise it, say why in the PR.

See `docs/` in the design notes for the architecture (functional core, reducer + effects, ports).
