# trace-avatar

**Show your users how, or do it for them.** One trace, two modes, on your real page:

- **Show me**: a smooth, human-looking ghost cursor walks through the steps over the page, with captions. It never
  touches the app. Docs, onboarding, demos, bug repros.
- **Do it for me**: the same cursor really clicks, types, picks options and submits, while the viewer watches.
  Demo accounts, sandbox set-up, "fill this in for me" helpers.

Element-anchored, so it survives layout changes. Zero dependencies. Record a trace by using your app.

| Show me | Do it for me |
|---|---|
| ![Show me: a cursor named Sarah walks through creating an invoice, with captions, without touching the form](https://raw.githubusercontent.com/saidiadegoke/trace-avatar/main/media/show-me.gif) | ![Do it for me: the same guide fills in the customer and amount and sends the invoice](https://raw.githubusercontent.com/saidiadegoke/trace-avatar/main/media/do-it-for-me.gif) |

<sub>Rendered from `examples/vanilla-html` with [trace-avatar-render](https://github.com/saidiadegoke/trace-avatar-render).</sub>

**Show me:**

```html
<script src="https://cdn.jsdelivr.net/npm/trace-avatar/dist/trace.min.js"></script>
<script>
  TraceAvatar.createTrace({
    trace: {
      version: 1,
      avatar: { name: 'Sarah · Sales' },
      steps: [
        { type: 'click', target: { role: 'button', name: 'New invoice' }, say: 'Start from New invoice.' },
        { type: 'type',  target: { role: 'textbox', name: 'Customer' }, text: 'Ada Stores' },
        { type: 'click', target: { text: 'Send invoice' }, say: 'Send it — done.' },
      ],
    },
    controls: true,
    autoplay: true,
  });
</script>
```

**Do it for me:** the `trace-perform` build acts on the page, and also plays Show me when you pass `mode: 'overlay'`.

```html
<script src="https://cdn.jsdelivr.net/npm/trace-avatar/dist/trace-perform.min.js"></script>
<button id="do-it">Do it for me</button>
<script>
  document.getElementById('do-it').onclick = () =>
    TraceAvatar.createTrace({ trace: '/tours/invoice.trace.json', controls: true, autoplay: true });
</script>
```

**[Try the playground →](https://saidiadegoke.github.io/trace-avatar/)**: edit a trace, record your own, and play it as
Show me or Do it for me.

Try it locally: `npm i && npm run build && npm run serve`, then open
`http://127.0.0.1:4173/examples/vanilla-html/` (switch between the two modes at the bottom left),
`/examples/guides-html/` (a whole app's guides from one script tag), or `/playground/`.

| | Show me (`mode: 'overlay'`) | Do it for me (`mode: 'perform'`) |
|---|---|---|
| Import | `trace-avatar` · `trace.min.js` | `trace-avatar/perform` · `trace-perform.min.js` |
| Touches the app | never: click-through overlay | clicks, types, presses keys, hovers |
| Typed text | shown in a chip | typed into the field (React/Vue/Svelte see it) |
| Masked fields | shown as `•••` | handed to the viewer: "Your turn: type in “Password”" |
| Viewer steps in | pauses; play resumes where it was | pauses; play resumes at the next `checkpoint` |
| Use it on | any page | sandbox or demo data |

Everything else is shared: the trace format, the recorder, captions, controls, pages and navigation, waits,
`prepare`, `resumeKey`, events, React and the custom element.

## Why it's different

- **Anchored to elements, not pixels.** Each step finds its element by CSS selector, then role + accessible name,
  then visible text, and only last by recorded pixels (scaled to the screen). A trace recorded on a 1440px laptop
  lands correctly on a 1280px one and in a 390px mobile layout.
- **Moves like a person.** Gentle curves at a human pace (seeded, so the same trace always moves the same way),
  or the real recorded pointer path re-anchored to today's page.
- **Lives on your live page.** The overlay is isolated in a shadow root and follows elements as the page or a panel
  scrolls. Viewers can pause, take over, then resume the guide.
- **Does real work, safely.** Do it for me sets values the way frameworks notice, never learns a password (the viewer
  types masked fields), waits for the app (`until: { text: 'Saved' }`) instead of racing it, and survives full page
  loads.
- **Never fails silently.** A missing element makes the step wait with "Looking for “Save”…", then report `stalled`.
- **Accessible.** Respects `prefers-reduced-motion`, announces captions in an `aria-live` region, keyboard controls.

## Install

```bash
npm i trace-avatar
```

```js
import { createTrace } from 'trace-avatar';            // Show me

const guide = createTrace({ trace: '/tours/invoice.trace.json', controls: true });
guide.on('step', ({ index, element }) => console.log('step', index, element));
guide.on('stalled', ({ index, reason }) => console.warn('step', index, reason));
guide.play();
```

```js
import { createTrace } from 'trace-avatar/perform';    // Do it for me (mode: 'perform' is the default here)

const helper = createTrace({
  trace: '/tours/invoice.trace.json',
  navigate: (path) => router.push(path),                // go to the pages the trace needs
  prepare: async (requires) => requires.includes('signed-in') ? isSignedIn() : true,
  onReset: () => resetSandbox(),                        // before a restart
});
helper.on('handoff', ({ step }) => console.log('viewer types', step.target?.name));
helper.play();
```

### React

```jsx
import { TraceAvatar, useTrace } from 'trace-avatar/react';
import { createPerformer } from 'trace-avatar/perform';   // only for Do it for me

// Show me
<TraceAvatar trace={tour} autoplay controls onEnd={() => track('tour_done')} />

// Do it for me
<TraceAvatar trace={tour} mode="perform" performer={createPerformer} autoplay controls
             navigate={router.push} onHandoff={({ step }) => toast(`Your turn: ${step.target?.name}`)} />

// or drive it yourself
const guide = useTrace({ trace: tour, controls: true });
<button onClick={() => guide?.play()}>Show me how</button>
```

See [examples/react-demo/App.tsx](examples/react-demo/App.tsx) for a Show me / Do it for me switch.

### Any framework, or none: the custom element

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/trace-avatar/dist/element.js"></script>
<trace-avatar src="/tours/invoice.trace.json" controls autoplay avatar-name="Sarah"></trace-avatar>
```

For Do it for me, add `mode="perform"` and give it hands (and any hooks) through the `hooks` property:

```js
import { createPerformer } from 'trace-avatar/perform';
document.querySelector('trace-avatar').hooks = { performer: createPerformer, navigate: (p) => router.push(p) };
```

Attributes: `src`, `controls`, `autoplay`, `rate`, `loop`, `captions`, `takeover`, `keyboard`, `avatar-name`, `avatar-image`, `avatar-color`,
`mode`, `resume-key`. Events: `trace-step`, `trace-stalled`, `trace-page`, `trace-handoff`, `trace-blocked`,
`trace-state`, `trace-end`, `trace-error`.

## Guides for your whole app: one script tag

```html
<script src="https://cdn.jsdelivr.net/npm/trace-avatar/dist/trace-auto.min.js"
        data-guides="/guides/index.json" data-perform="true" defer></script>

<button data-trace-guide="create-invoice">Show me how</button>
<button data-trace-guide="create-invoice" data-trace-mode="perform">Do it for me</button>
```

A small round button in the corner lists the guides for the page the viewer is on: "Show me · Do it for me". Any
element with `data-trace-guide="id"` starts one, including elements your framework renders later. While a guide
plays, the corner button becomes **Stop guide**. A guide carries on after a full page load. The player is fetched
on the first play, so until then the page pays about 5 KB.

`/guides/index.json` lists the guides (schema: `trace-avatar/guides.schema.json`):

```json
{
  "version": 1,
  "guides": [
    { "id": "create-invoice", "title": "Create an invoice", "trace": "create-invoice.trace.json",
      "modes": ["overlay", "perform"], "pages": ["/app/invoices", "/app"] }
  ]
}
```

| Script attribute | Default | |
|---|---|---|
| `data-guides` | — | the manifest URL (trace URLs in it are relative to it) |
| `data-launcher` | `bottom-right` | `bottom-left`, or `off` to hide the corner button and use your own buttons |
| `data-perform` | `false` | `true` allows Do it for me, for guides whose `modes` include `"perform"` (both must agree) |
| `data-links` | on | `overlay`: links play Show me only; `off`: links are ignored |

Without `pages` a guide is offered on every page. Only guides in the manifest can play, by id.

**Links.** `https://your.app/app/invoices?trace=create-invoice` opens the page and plays the guide; add
`&trace-mode=perform` for Do it for me (or use `#trace=…` if your server drops unknown parameters). The launcher has
**Copy link** on every guide, and `guides.link(id, { mode, path })` builds one.

- The parameter is removed from the address on arrival, so a reload doesn't replay it.
- If your `prepare` hook says the viewer must sign in first, the link waits through the sign-in (even a full page
  reload) for up to 10 minutes and plays once the guide can start.
- **A link can only name a guide id from your manifest**, never a trace or a trace URL, so nobody can put their
  own guide on your app by sending a link.
- **Do it for me from a link always asks first** ("Do it for me: Create an invoice — Start · Show me instead ·
  Cancel"). A link alone never makes your app act.

From npm, with your router and hooks:

```js
import { mount } from 'trace-avatar/auto';

const guides = mount({
  guides: '/guides/index.json',
  perform: true,
  navigate: (path) => router.push(path),
  prepare: async () => isSignedIn(),
  launcher: 'bottom-left',           // or false
});
guides.play('create-invoice', { mode: 'perform' });
guides.on('error', (e) => console.warn(e.message));   // unknown ids, refused modes, load failures
```

React: `<TraceGuides guides="/guides/index.json" perform navigate={router.push} />` from `trace-avatar/react`.
Custom element: `<trace-guides src="/guides/index.json" perform launcher="bottom-left">` from
`trace-avatar/element` (events `guides-ready`, `guides-play`, `guides-end`, `guides-stop`, `guides-error`).
Try it: `examples/guides-html/`.

**Record guides in the app (the studio).** Let the people you choose record guides where they work, with no JSON:

```js
mount({
  guides: '/guides/index.json',
  record: {
    allowed: () => user.role === 'owner',              // checked before the studio loads
    save: (trace, entry) => api.saveGuide(trace, entry), // default: a .trace.json download
    requires: ['signed-in'],
  },
});
```

"● Record a guide" appears in the launcher, `Alt+Shift+R` starts recording (`shortcut` changes it, `false` turns it
off) and so does `?trace-record=1`, all only when `allowed()` says yes. The studio (about 14 KB) is loaded then, never
before.

- **While recording**, a bar shows the time and the steps: **Pause**, **+ Caption** (on the last step), **Wait for…**
  (click an element: wait until it shows some text, or until it's gone, so Do it for me waits for your app), **Mask /
  Reveal** (click a field; passwords, card numbers and codes can never be revealed), **Stop**, and **⇅** to move
  the bar between the bottom and the top of the page. The recording carries
  on across full page loads and sign-ins.
- **After Stop**, a review panel lists the steps in words ("Click "Save"", "Wait for "Saved""): edit captions, move
  or delete steps, mark checkpoints and pauses, set the title, id, modes and pages. **▶ Show me** and **▶ Do it for
  me** test it right there (Do it for me can cross page loads). **Save** hands `save` the trace and its manifest
  entry; **Download** and **Copy JSON** are always there, and the raw JSON is under "Advanced".
- Saving is your app's job (your API, a CMS, a pull request); trace-avatar hosts nothing.

Without the loader: `import { createStudio } from 'trace-avatar/studio'` (CDN: `trace-studio.min.js`, global
`TraceAvatarStudio`), then `createStudio({ save }).start()`. The playground's Record button uses it.

## The trace format

A trace is plain JSON (`version: 1`). The schema ships at `trace-avatar/schema.json`.

```jsonc
{
  "version": 1,
  "meta": { "title": "Create an invoice", "viewport": { "w": 1440, "h": 900 }, "seed": 7 },
  "avatar": { "name": "Sarah · Sales", "image": "/sarah.png", "color": "#2456d8" },
  "steps": [
    { "type": "click", "target": { "sel": "[data-testid=new-invoice]" }, "say": "Start here." },
    { "type": "wait",  "target": { "sel": "#customer" }, "timeout": 5000 },
    { "type": "type",  "target": { "role": "textbox", "name": "Customer" }, "text": "Ada Stores" },
    { "type": "key",   "keys": "Mod+Enter", "say": "Save with ⌘↵." },
    { "type": "hover", "target": { "text": "Total" }, "hold": 1200, "pause": true }
  ]
}
```

| Step | Shows | Fields |
|---|---|---|
| `move` | cursor travels to the element | `target` |
| `click` / `dblclick` | travel, press, ripple, ring | `target` |
| `type` | travel, text appearing in a chip | `target`, `text`, `mask?` |
| `key` | a shortcut chip (`⌘↵`, `Ctrl+Enter`) | `keys`, `target?` |
| `scroll` | scrolls the page or the element | `to` or `by`, `target?` |
| `hover` | travel, then stay | `target`, `hold?` |
| `wait` | holds until the element exists, or until a condition holds | `target`, `until?`, `timeout?` |
| `note` | a caption only | `say`, `hold?` |

Any step may carry `say` (caption), `highlight` (ring), `pause` (stop after this step), `t` (ms from start; omit it
and the step follows the previous one), `page` (the page it happens on, see below), and `checkpoint` (where perform mode resumes after the viewer steps in). Targets take any of `sel`, `role` + `name`, `text`, `xy`, plus `at: { rx, ry }`
to aim at a point inside the element. An optional `path` (`[[t, x, y], …]`) replays a real pointer path.

`validate(trace)` returns every problem with a path to it, and `createTrace` throws a `TraceError` for an invalid trace.

## Guides across pages

A step can name the page it happens on: `"page": "/app/tasks/new"`, with `*` for one path segment (`/app/tasks/*`).
Later steps keep that page until another step names one. The recorder fills it in for you, with record ids as `*`.

- On the wrong page the guide **doesn't search**, since a lookalike element on another page is not the one meant. It
  waits with "Open /app/tasks/new to continue" and carries on when the viewer gets there. It never gives up.
- Give it your router and it goes there itself: `createTrace({ trace, navigate: (path) => router.push(path) })`.
  Only pages without `*` are navigated to; the `page` event (`{ index, want, at }`) tells you about every one.
- If the viewer clicks through ahead of the guide, it catches up to the first later step on their page. It never
  skips its own start.
- Older traces without `page` play exactly as before.

## Waiting for the app

A `wait` step holds until its element exists. With `until` it holds until something has happened. It works in both
modes: Show me waits for the viewer's own click to take effect, Do it for me waits for its own.

```jsonc
{ "type": "wait", "until": { "text": "Saved" }, "say": "Saving…" }                       // the page shows "Saved"
{ "type": "wait", "target": { "sel": "#status" }, "until": { "text": "Running" } }        // that element does
{ "type": "wait", "target": { "sel": ".spinner" }, "until": { "gone": true }, "timeout": 60000 }  // it went away
```

The check runs at most every 250 ms, and only after the page has changed. It times out after `timeout` ms (default
5 s, at most 10 minutes) with a `stalled` event (`reason: 'until-timeout'`).

## Do it for me (perform mode)

```jsonc
{
  "version": 1,
  "meta": { "title": "Start a task", "requires": ["signed-in"] },
  "steps": [
    { "type": "click", "page": "/app", "target": { "role": "link", "name": "New task" } },
    { "type": "type",  "page": "/app/tasks/new", "target": { "role": "textbox", "name": "Objective" }, "text": "Check prices" },
    { "type": "type",  "target": { "role": "textbox", "name": "Budget code" }, "text": "•••", "mask": true },
    { "type": "click", "target": { "role": "button", "name": "Start task" }, "checkpoint": true },
    { "type": "wait",  "page": "/app", "target": { "sel": "#status" }, "until": { "text": "Running" }, "say": "Starting…" }
  ]
}
```

```js
import { createTrace } from 'trace-avatar/perform';   // CDN: trace-perform.min.js (TraceAvatar global)

createTrace({ trace, autoplay: true, navigate: (path) => router.push(path), prepare: () => isSignedIn() });
```

The same trace plays as Show me with `mode: 'overlay'` (or from `trace-avatar`). In Do it for me the guide really clicks, types, presses keys and hovers. Point it at **sandbox or demo data**: a trace can click
anything the page lets it.

- **Inputs:** values are set the way React, Vue and Svelte notice (native setter, then `input`); a select picks
  the option whose text you typed; rich-text editors get `insertText`; Enter in a form field submits the form.
- **Masked fields** (passwords, anything the recorder masked): the guide stops, focuses the field, says
  "Your turn: type in “Password”, then press play" and emits `handoff`. It never knows the text.
- **The viewer steps in:** real input pauses the guide. When they press play, it goes on from the next step marked
  `checkpoint: true`, since the page may have moved on. It never seeks backwards; restart starts over.
- **What it can't do:** browsers ignore synthetic events for file pickers, fullscreen, the clipboard, payment and
  other cross-origin iframes. Put a hand-off (`pause: true` with a `say`) there.

| Option | |
|---|---|
| `mode` | `'overlay'` (default in `trace-avatar`) or `'perform'` (default in `trace-avatar/perform`) |
| `prepare(requires, trace)` | runs before every start: sign into the sandbox, check the session. Return `true`, or `false` / `{ ok: false, say }` to show the message and stay put (`blocked` event); play tries again |
| `onReset()` | perform mode: put the app back before a restart |
| `resumeKey` | carry on after a full page load: the step is kept in `sessionStorage`, and a guide created with the same key on the next page (within 10 minutes) picks up from there |
| `performer` | the hands, for the main entry, React or the custom element: `performer: createPerformer` from `trace-avatar/perform` |

`meta.requires` (e.g. `["signed-in"]`) tells `prepare` what the guide needs; the recorder's `requires` option fills it
in. In React, pass `onHandoff` / `onBlocked`; on `<trace-avatar mode="perform" resume-key="…">`, set the `hooks`
property (`{ performer, prepare, onReset, navigate, currentPath }`) and listen for `trace-handoff` / `trace-blocked`.

## Options

| Option | Default | |
|---|---|---|
| `trace` | — | a trace object, or the URL of a `.trace.json` |
| `root` | `document` | where elements are looked up |
| `avatar` | trace's | `{ name, image, color }` override |
| `controls` | `false` | a small play/pause/step/speed/restart bar |
| `autoplay` | `false` | |
| `rate` | `1` | 0.25–4 |
| `loop` | `false` | |
| `captions` | `'bubble'` | `'bubble'`, `'bar'` or `'none'` |
| `takeover` | `'pause'` | what real viewer input does while playing: `'pause'` or `'ignore'` |
| `keyboard` | `false` | Space/K play-pause, ←/→ steps (outside form fields) |
| `reducedMotion` | `'auto'` | follows `prefers-reduced-motion` |
| `seed` | trace's | changes the shape of authored paths |
| `navigate` | — | `(path) => void`: go to a page the trace needs (e.g. `router.push`); without it the guide waits |
| `currentPath` | `location.pathname` | where the viewer is, for apps that route without the address bar |
| `mode` | `'overlay'` | `'perform'` acts on the page (see Do it for me) |
| `prepare` / `onReset` / `resumeKey` | — | see Do it for me; `prepare` and `resumeKey` work in overlay mode too |
| `locators` | — | your own element finders, tried first: `(target, root, step) => Element \| null` |

Events (`on(name, fn)`): `step`, `stalled`, `page`, `handoff`, `blocked`, `state`, `end`, `error`.

Controller: `play()`, `pause()`, `toggle()`, `stop()`, `seek(ms)`, `next()`, `prev()`, `setRate(r)`, `on(event, fn)`,
`state`, `index`, `time`, `duration`, `trace`, `ready`, `destroy()`.

## Recording a trace

```js
import { createRecorder } from 'trace-avatar/record';   // or the CDN build: TraceAvatarRecord

const rec = createRecorder({ title: 'Create an invoice', avatar: { name: 'Sarah' } });
rec.start();
// … use the page …
const trace = rec.stop();   // a valid trace.json, or null if nothing happened
```

- Clicks, double-clicks, typing (one step per field), shortcuts (`Mod+K`, Enter, Esc, Tab), page and panel scrolls,
  and the pointer path (sampled at ~30 Hz, simplified, capped in memory).
- Pauses over 4 s play back as 1.5 s (`maxGapMs`, 0 keeps real time). Scrolls the player does anyway (it scrolls
  each target into view) are dropped; `scrolls: 'all'` keeps them.
- Each element is described by its most stable selector (`data-testid`, a human id, name, aria-label, then a short
  path), plus role + name, text and the pixel point, so it can be found again after the page changes. Addresses
  with record ids are skipped, a link in two places is scoped by its landmark (`nav a[href=…]`), a card is named by
  its title, and a field is never described by what was typed in it.
- The pixel point is the last resort: while a step's element is missing, the guide waits ("Looking for …"), so a
  viewer can click along through a multi-page app.
- **Typed text is masked by default.** Mark demo fields `data-trace-reveal` to keep their text. Passwords, card,
  one-time-code and other secret fields are always masked. `data-trace-ignore` hides anything from the recorder.
- **Across page loads.** Give the recorder a `persistKey` (`createRecorder({ persistKey: 'app' })`) and create
  it on every page: a recording that was going on the last page carries on, in the same tab, for up to 30 minutes
  (`persistMs`). The page load itself counts as a pause. Coming back from another site (a sign-in) adds a pause step,
  "Sign in, then press play.", and `signed-in` to `meta.requires`. `rec.restored` tells you it carried on.
- For authors in your app, use the studio (above): it adds captions, waits and mask choices while recording, and a
  review panel after.
- The recorder's own API for tools: `caption(say)`, `waitFor(el, { text } | { gone: true })`, `mark(el, 'mask' |
  'reveal' | null)`, `elapsed`, `destroy({ keep: true })` (stop listening, keep the recording for the next page).

## Theming

```css
:root {
  --ta-color: #2456d8;      /* cursor, ring, chips */
  --ta-badge-bg: #111827;   --ta-badge-fg: #f9fafb;
  --ta-caption-bg: #111827; --ta-caption-fg: #f9fafb;
  --ta-font: system-ui, sans-serif;
  --ta-z: 2147483000;
}
```

Dark-mode colours apply automatically unless you set your own.

## GIFs and videos of a guide

[trace-avatar-render](https://github.com/saidiadegoke/trace-avatar-render) plays a trace on your real app in
headless Chromium and writes a GIF or an MP4. Long waits (loading, saving) are cut, a stalled guide fails the
render (so a docs GIF that no longer matches the app fails CI), and masked fields only ever get dots.

```bash
npx trace-avatar-render invoice.trace.json --url http://localhost:3000/app --out invoice.gif
```

The GIFs at the top of this page are made that way from `examples/vanilla-html` (`?mode=off` loads it with no
guide running, for the renderer to bring its own).

## What it does not do (yet)

- **Import rrweb recordings.** Planned.
- **Cross-origin iframes.** A page script cannot see into them.

## Size

About 14 KB min+brotli for the player (locators, overlay, controls, validation, pages, waits); perform mode is a
separate 15 KB entry (player + hands), the recorder a separate 9 KB one, the studio about 14 KB (loaded only for authors), and the guides loader about
6 KB until its first play. `size-limit` guards each in CI.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every function and feature has a test: unit tests for the pure core and
Playwright tests on Chromium, Firefox and WebKit for the page. If this saves you time, a ⭐ helps others find it.

## License

MIT
