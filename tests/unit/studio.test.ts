// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_REC_KEY, STUDIO_REVIEW_KEY, createStudio, defaultStudioLoaders } from '../../src/studio/index';
import type { Studio, StudioOptions, StudioPlayer } from '../../src/studio/index';
import { parse } from '../../src/core/format';
import { validateManifest } from '../../src/core/manifest';
import { createEmitter } from '../../src/shell/emitter';
import type { TraceController, TraceEvents, TraceOptions } from '../../src/index';
import { html } from './dom-helpers';

type Ctl = TraceController & { emit: <K extends keyof TraceEvents>(k: K, d: TraceEvents[K]) => void; destroyed: boolean; plays: number; state: string };

function fakePlayer(state = 'playing') {
  const made: Array<{ opts: TraceOptions; ctl: Ctl }> = [];
  const mod: StudioPlayer = {
    createTrace(opts) {
      const em = createEmitter<TraceEvents>();
      const ctl = {
        ready: Promise.resolve(), state, destroyed: false, plays: 0,
        play() { ctl.plays += 1; ctl.state = 'playing'; },
        destroy() { ctl.destroyed = true; },
        on: em.on, emit: em.emit,
      } as unknown as Ctl;
      made.push({ opts, ctl });
      return ctl;
    },
  };
  return { mod, made, load: vi.fn(async () => mod) };
}

let open: Studio[] = [];
let p = fakePlayer();
const make = (o: StudioOptions = {}) => {
  const s = createStudio({ recorder: { allowSynthetic: true }, ...o }, { player: p.load });
  open.push(s);
  return s;
};
const tick = async (n = 8) => { for (let k = 0; k < n; k += 1) await Promise.resolve(); };
const sr = (s: Studio) => s.host.shadowRoot!;
const btn = (s: Studio, text: string) => {
  const b = Array.from(sr(s).querySelectorAll('button')).find((x) => x.textContent === text || x.getAttribute('aria-label') === text);
  if (!b) throw new Error(`no button "${text}": ${Array.from(sr(s).querySelectorAll('button')).map((x) => x.textContent).join(' | ')}`);
  return b as HTMLButtonElement;
};
const input = (s: Studio, label: string) => sr(s).querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const labelled = (s: Studio, text: string) => Array.from(sr(s).querySelectorAll('label')).find((l) => l.firstChild?.textContent === text)!.querySelector('input') as HTMLInputElement;
const typeInto = (el: HTMLInputElement, v: string) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }));
const visible = (s: Studio, sel: string) => !(sr(s).querySelector(sel) as HTMLElement).hidden;

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); history.replaceState({}, '', '/app/invoices'); p = fakePlayer(); });
afterEach(() => { open.forEach((s) => s.destroy()); open = []; sessionStorage.clear(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

/** Record: click New, type a name, stop. */
function recordSome(s: Studio) {
  s.start();
  click(document.querySelector('#new')!);
  const f = document.querySelector('#customer') as HTMLInputElement;
  f.value = 'Ada';
  f.dispatchEvent(new Event('input', { bubbles: true }));
  s.stop();
}

describe('studio: recording', () => {
  it('starts with a toolbar and a first-time note; stop opens the review with the steps', () => {
    html('<button id="new">New invoice</button><input id="customer" aria-label="Customer" data-trace-reveal>');
    const s = make();
    expect(s.state).toBe('idle');
    expect(visible(s, '.bar')).toBe(false);
    expect(s.host.getAttribute('data-trace-avatar')).toBe('studio');
    s.start();
    expect(s.state).toBe('recording');
    expect(visible(s, '.bar')).toBe(true);
    expect(sr(s).querySelector('.bar')!.getAttribute('role')).toBe('toolbar');
    expect(sr(s).querySelector('.tip')!.textContent).toContain('Nothing leaves this page until you save');
    click(btn(s, 'Got it'));
    expect(localStorage.getItem('trace-avatar:studio:seen')).toBe('1');
    click(document.querySelector('#new')!);
    expect(sr(s).querySelector('.bar')!.textContent).toContain('1 step');
    click(btn(s, 'Move the bar to the other edge'));
    expect(sr(s).querySelector('.bar')!.classList.contains('top')).toBe(true);
    click(btn(s, 'Move the bar to the other edge'));
    expect(sr(s).querySelector('.bar')!.classList.contains('top')).toBe(false);
    click(btn(s, '❚❚ Pause'));
    expect(s.state).toBe('paused');
    click(btn(s, '▶ Resume'));
    expect(s.state).toBe('recording');
    s.stop();
    expect(s.state).toBe('review');
    expect(visible(s, '.bar')).toBe(false);
    expect(visible(s, '.panel')).toBe(true);
    expect(Array.from(sr(s).querySelectorAll('li')).map((li) => li.firstChild!.textContent)).toEqual(['1. Click "New invoice" /app/invoices']);
    // The second time, no first-time note.
    const again = make();
    again.start();
    expect(visible(again, '.tip')).toBe(false);
  });

  it('+ Caption puts a caption on the last step', () => {
    html('<button id="new">New invoice</button>');
    const s = make();
    s.start();
    click(document.querySelector('#new')!);
    click(btn(s, '+ Caption'));
    const c = input(s, 'Caption for the last step');
    c.value = 'Start a new invoice';
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(sr(s).querySelector('.bar [role=status]')!.textContent).toContain('Caption added.');
    s.stop();
    expect(s.trace!.steps[0].say).toBe('Start a new invoice');
    expect(input(s, 'Caption for step 1').value).toBe('Start a new invoice');
  });

  it('Wait for… picks an element without the app (or the recorder) seeing the click', () => {
    html('<button id="new">New invoice</button><div id="status">Saving…</div>');
    const appClicks = vi.fn();
    document.querySelector('#status')!.addEventListener('click', appClicks);
    const s = make();
    s.start();
    click(btn(s, 'Wait for…'));
    expect(sr(s).querySelector('.bar [role=status]')!.textContent).toContain('Click what to wait for');
    document.querySelector('#status')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(visible(s, '.box')).toBe(true);
    click(document.querySelector('#status')!);
    expect(appClicks).not.toHaveBeenCalled();
    const t = input(s, 'Text to wait for');
    expect(t.value).toBe('Saving…');
    t.value = 'Saved';
    click(btn(s, 'Until it shows this'));
    // The picker is off again: the next click is the app's.
    click(document.querySelector('#status')!);
    expect(appClicks).toHaveBeenCalledTimes(1);
    click(btn(s, 'Wait for…'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    click(document.querySelector('#new')!); // not picked: recorded
    click(btn(s, 'Wait for…'));
    click(document.querySelector('#status')!);
    click(btn(s, 'Until it is gone'));
    s.stop();
    const tr = s.trace!;
    expect(tr.steps.map((x) => [x.type, x.until])).toEqual([['wait', { text: 'Saved' }], ['click', undefined], ['click', undefined], ['wait', { gone: true }]]);
    expect(parse(tr).ok).toBe(true);
  });

  it('Mask / Reveal: a field can be revealed for this recording; a password cannot', () => {
    html('<input id="customer" aria-label="Customer"><input id="pw" type="password"><p id="p">text</p>');
    const s = make();
    s.start();
    click(btn(s, 'Mask / Reveal'));
    click(document.querySelector('#p')!);
    expect(sr(s).querySelector('.bar [role=status]')!.textContent).toContain('not a field');
    click(btn(s, 'Mask / Reveal'));
    click(document.querySelector('#pw')!);
    expect(btn(s, 'Reveal').disabled).toBe(true);
    expect(sr(s).querySelector('.bar [role=status]')!.textContent).toContain('always masked');
    click(btn(s, 'Mask / Reveal'));
    click(document.querySelector('#customer')!);
    click(btn(s, 'Reveal'));
    expect(sr(s).querySelector('.bar [role=status]')!.textContent).toContain('Revealed');
    const f = document.querySelector('#customer') as HTMLInputElement;
    f.value = 'Ada';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    s.stop();
    expect(s.trace!.steps.find((x) => x.type === 'type')).toMatchObject({ text: 'Ada' });
  });

  it('nothing recorded: the review says so and offers to record again', () => {
    html('<p>x</p>');
    const s = make();
    s.start();
    s.stop();
    expect(sr(s).querySelector('.panel')!.textContent).toContain('Nothing was recorded.');
    click(btn(s, '● Record again'));
    expect(s.state).toBe('recording');
  });
});

describe('studio: review', () => {
  const page = '<button id="new">New invoice</button><input id="customer" aria-label="Customer" data-trace-reveal>';

  it('title makes the id (until the id is edited); save gets a valid trace and its manifest entry', async () => {
    html(page);
    const save = vi.fn(async () => {});
    const s = make({ save, requires: ['signed-in'] });
    const saved = vi.fn();
    s.on('save', saved);
    recordSome(s);
    expect(btn(s, 'Save').disabled).toBe(true);
    expect(sr(s).querySelector('.err')!.textContent).toContain('Give the guide a title.');
    typeInto(labelled(s, 'Title'), 'Create an invoice');
    expect(labelled(s, 'Id').value).toBe('create-an-invoice');
    expect(btn(s, 'Save').disabled).toBe(false);
    typeInto(labelled(s, 'Id'), 'new-invoice');
    typeInto(labelled(s, 'Title'), 'Create an invoice!');
    expect(labelled(s, 'Id').value).toBe('new-invoice');
    expect(labelled(s, 'Pages it is listed on').value).toBe('/app/invoices');
    click(btn(s, 'Save'));
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    const [trace, entry] = save.mock.calls[0] as unknown as [import('../../src/core/format').Trace, import('../../src/core/manifest').Guide];
    expect(parse(trace).ok).toBe(true);
    expect(trace.meta).toMatchObject({ title: 'Create an invoice!', requires: ['signed-in'], url: '/app/invoices' });
    expect(trace.steps[0].page).toBe('/app/invoices');
    expect(trace.steps[1].page).toBeUndefined();
    expect(entry).toEqual({ id: 'new-invoice', title: 'Create an invoice!', trace: 'new-invoice.trace.json', modes: ['overlay', 'perform'], pages: ['/app/invoices'] });
    expect(validateManifest({ version: 1, guides: [entry] }).ok).toBe(true);
    expect(sr(s).querySelector('.st')!.textContent).toBe('Saved.');
    expect(saved).toHaveBeenCalledWith({ trace, entry });
    expect((save.mock.calls[0] as unknown[])[2]).toEqual({}); // a new recording: no `from`
  });

  it('a failing save says why; without save, Save downloads', async () => {
    html(page);
    const s = make({ save: async () => { throw new Error('HTTP 500'); } });
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'X');
    click(btn(s, 'Save'));
    await tick();
    expect(sr(s).querySelector('.st')!.textContent).toBe('Could not save: HTTP 500');

    const urls: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { urls.push(b as Blob); return 'blob:x'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchors: string[] = [];
    const real = HTMLAnchorElement.prototype.click;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this.download); });
    const d = make();
    recordSome(d);
    typeInto(labelled(d, 'Title'), 'Send it');
    click(btn(d, 'Save (download)'));
    expect(anchors).toEqual(['send-it.trace.json']);
    expect(parse(JSON.parse(await urls[0].text())).ok).toBe(true);
    expect(sr(d).querySelector('.st')!.textContent).toContain('"id":"send-it"');
    click(btn(d, 'Download'));
    expect(anchors).toHaveLength(2);
    void real;
  });

  it('copy JSON uses the clipboard and says when it cannot', async () => {
    html(page);
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const s = make();
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'X');
    click(btn(s, 'Copy JSON'));
    await tick();
    expect(parse(JSON.parse((write.mock.calls[0] as unknown as [string])[0])).ok).toBe(true);
    expect(sr(s).querySelector('.st')!.textContent).toBe('Copied the trace JSON.');
    write.mockRejectedValueOnce(new Error('no'));
    click(btn(s, 'Copy JSON'));
    await tick();
    expect(sr(s).querySelector('.st')!.textContent).toContain('Could not copy');
  });

  it('edits steps: caption, move, delete, checkpoint, pause; errors block saving', () => {
    html(page);
    const s = make();
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'X');
    typeInto(input(s, 'Caption for step 2'), 'Who it is for');
    click(btn(s, 'Move step 2 up'));
    expect(s.trace!.steps.map((x) => x.type)).toEqual(['type', 'click']);
    expect(s.trace!.steps[0]).toMatchObject({ say: 'Who it is for', page: '/app/invoices' });
    expect(btn(s, 'Move step 1 up').disabled).toBe(true);
    expect(btn(s, 'Move step 2 down').disabled).toBe(true);
    const flags = sr(s).querySelectorAll('li')[1].querySelectorAll('input[type=checkbox]');
    (flags[0] as HTMLInputElement).checked = true;
    flags[0].dispatchEvent(new Event('change'));
    (flags[1] as HTMLInputElement).checked = true;
    flags[1].dispatchEvent(new Event('change'));
    expect(s.trace!.steps[1]).toMatchObject({ checkpoint: true, pause: true });
    (flags[1] as HTMLInputElement).checked = false;
    flags[1].dispatchEvent(new Event('change'));
    expect(s.trace!.steps[1].pause).toBeUndefined();
    typeInto(input(s, 'Caption for step 1'), '  ');
    expect(s.trace!.steps[0].say).toBeUndefined();
    click(btn(s, 'Delete step 1'));
    click(btn(s, 'Delete step 1'));
    expect(s.trace!.steps).toEqual([]);
    expect(sr(s).querySelector('.err')!.textContent).toContain('no steps');
    expect(btn(s, '▶ Show me').disabled).toBe(true);
    expect(btn(s, 'Download').disabled).toBe(true);
  });

  it('modes and pages become the manifest entry; without Do it for me there is no such choice', () => {
    html(page);
    const s = make();
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'X');
    const perform = Array.from(sr(s).querySelectorAll('fieldset label')).find((l) => l.textContent === 'Do it for me')!.querySelector('input')!;
    perform.checked = false;
    perform.dispatchEvent(new Event('change'));
    typeInto(labelled(s, 'Pages it is listed on'), '/app/*, /home ,');
    expect(s.entry).toMatchObject({ modes: ['overlay'], pages: ['/app/*', '/home'] });
    const show = Array.from(sr(s).querySelectorAll('fieldset label')).find((l) => l.textContent === 'Show me')!.querySelector('input')!;
    show.checked = false;
    show.dispatchEvent(new Event('change'));
    expect(s.entry!.modes).toEqual(['overlay']); // an entry always offers something

    const n = make({ perform: false });
    recordSome(n);
    expect(sr(n).querySelector('fieldset')!.textContent).not.toContain('Do it for me');
    expect(() => btn(n, '▶ Do it for me')).toThrow();
    expect(n.entry!.modes).toEqual(['overlay']);
  });

  it('Advanced: the JSON can be edited and applied; bad JSON is refused with the reason', () => {
    html(page);
    const s = make();
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'X');
    const details = sr(s).querySelector('details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    const ta = sr(s).querySelector('textarea')!;
    expect(JSON.parse(ta.value).steps).toHaveLength(2);
    ta.value = '{nope';
    click(btn(s, 'Apply JSON'));
    expect(sr(s).querySelector('.st')!.textContent).toContain('Not JSON');
    ta.value = JSON.stringify({ version: 1, steps: [{ type: 'click' }] });
    click(btn(s, 'Apply JSON'));
    expect(sr(s).querySelector('.st')!.textContent).toContain('Not a valid trace');
    ta.value = JSON.stringify({ version: 1, steps: [{ type: 'note', say: 'Hello', page: '/a' }, { type: 'note', say: 'Bye' }] });
    click(btn(s, 'Apply JSON'));
    expect(sr(s).querySelectorAll('li')).toHaveLength(2);
    expect(s.trace!.steps).toEqual([{ type: 'note', say: 'Hello', page: '/a' }, { type: 'note', say: 'Bye' }]);
  });
});

describe('studio: edit a saved guide', () => {
  const saved = {
    version: 1 as const,
    meta: { title: 'Create an invoice', url: '/app/invoices' },
    steps: [
      { type: 'click' as const, page: '/app/invoices', target: { role: 'button', name: 'New invoice' }, say: 'Start here.' },
      { type: 'hover' as const, target: { role: 'textbox', name: 'Customer' }, say: 'Who it is for.' },
    ],
  };

  it('opens the review on the guide; its save says which guide it came from', async () => {
    const save = vi.fn(async () => {});
    const s = make({ save });
    s.edit(saved, { id: 'new-invoice', title: 'Create an invoice', modes: ['overlay'], pages: ['/app/invoices'] });
    expect(s.state).toBe('review');
    expect(sr(s).querySelector('h2')!.textContent).toBe('Edit the guide');
    expect(labelled(s, 'Id').value).toBe('new-invoice');
    expect(labelled(s, 'Pages it is listed on').value).toBe('/app/invoices');
    expect(input(s, 'Caption for step 2').value).toBe('Who it is for.');
    typeInto(input(s, 'Caption for step 2'), 'The customer.');
    typeInto(labelled(s, 'Title'), 'Make an invoice'); // the id stays: it is the guide's
    expect(labelled(s, 'Id').value).toBe('new-invoice');
    click(btn(s, 'Save'));
    await tick();
    const [trace, entry, info] = save.mock.calls[0] as unknown as [typeof saved, { id: string; modes: string[] }, { from?: string }];
    expect(info).toEqual({ from: 'new-invoice' });
    expect(entry).toMatchObject({ id: 'new-invoice', title: 'Make an invoice', modes: ['overlay'] });
    expect(trace.steps[1].say).toBe('The customer.');
    expect(trace.steps[0].page).toBe('/app/invoices');
    expect(saved.steps[1].say).toBe('Who it is for.'); // the guide passed in is not changed
  });

  it('carries on across a page load, still knowing where it came from; a new recording forgets it', async () => {
    const save = vi.fn(async () => {});
    const s1 = make({ save });
    s1.edit(saved, { id: 'new-invoice' });
    s1.destroy();
    const s2 = make({ save });
    expect(s2.state).toBe('review');
    expect(labelled(s2, 'Title').value).toBe('Create an invoice'); // from the trace's meta
    click(btn(s2, 'Save'));
    await tick();
    expect((save.mock.calls[0] as unknown[])[2]).toEqual({ from: 'new-invoice' });
    html('<button id="new">New invoice</button><input id="customer" aria-label="Customer" data-trace-reveal>');
    recordSome(s2);
    typeInto(labelled(s2, 'Title'), 'Another');
    click(btn(s2, 'Save'));
    await tick();
    expect((save.mock.calls[1] as unknown[])[2]).toEqual({});
  });

  it('refuses a trace the player could not play; without Do it for me the mode is dropped', () => {
    const s = make({ perform: false });
    expect(() => s.edit({ version: 1, steps: [{ type: 'nope' }] } as never, { id: 'x' })).toThrow(/not a valid trace/);
    s.edit(saved, { id: 'x', modes: ['overlay', 'perform'] });
    expect(s.entry!.modes).toEqual(['overlay']);
  });
});

describe('studio: AI suggestions', () => {
  beforeEach(() => {
    html('<button id="new">New invoice</button><div id="status"></div><input id="customer" aria-label="Customer" data-trace-reveal>');
    document.querySelector('#new')!.addEventListener('click', () => { document.querySelector('#status')!.textContent = 'Invoice saved'; });
    // happy-dom lays nothing out: count every element as visible for the recorder's "what appeared".
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  });
  const answers: Record<string, unknown> = {
    captions: { steps: [{ n: 1, say: 'Start a new invoice' }, { n: 2, say: 'Who is it for?' }] },
    waits: { waits: [{ after: 1, text: 'Invoice saved', why: 'saving takes a moment' }] },
    title: { title: 'Make an invoice' },
  };

  it('suggests captions, a wait (from what appeared) and a title; each is accepted or rejected; nothing typed is sent', async () => {
    const ai = vi.fn(async (task: string) => answers[task]);
    const s = createStudio({ recorder: { allowSynthetic: true }, ai }, { player: p.load, assist: () => import('../../src/studio/assist-ui') });
    open.push(s);
    s.start();
    click(document.querySelector('#new')!);
    await tick();
    const f = document.querySelector('#customer') as HTMLInputElement;
    f.value = 'Ada';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    s.stop();
    click(btn(s, '✨ Suggest captions, waits, a title'));
    await vi.waitFor(() => btn(s, 'Captions'));
    // Captions: accept one, reject the other.
    click(btn(s, 'Captions'));
    await vi.waitFor(() => expect(sr(s).querySelectorAll('ol[aria-label=Suggestions] li')).toHaveLength(2));
    click(btn(s, 'Accept: Step 1, caption'));
    expect(input(s, 'Caption for step 1').value).toBe('Start a new invoice');
    click(btn(s, 'Reject: Step 2, caption'));
    expect(sr(s).querySelector('ol[aria-label=Suggestions]')).toBeNull();
    expect(s.trace!.steps[1].say).toBeUndefined();
    // Waits: the recorder saw "Invoice saved" appear after step 1.
    click(btn(s, 'Waits'));
    await vi.waitFor(() => btn(s, 'Accept: After step 1, wait until the page shows'));
    click(btn(s, 'Accept: After step 1, wait until the page shows'));
    expect(s.trace!.steps.map((x) => x.type)).toEqual(['click', 'wait', 'type']);
    expect(s.trace!.steps[1]).toMatchObject({ type: 'wait', until: { text: 'Invoice saved' } });
    // Title: also the id (not edited by hand).
    click(btn(s, 'A title'));
    await vi.waitFor(() => btn(s, 'Accept: Title'));
    click(btn(s, 'Accept: Title'));
    expect(labelled(s, 'Title').value).toBe('Make an invoice');
    expect(s.entry!.id).toBe('make-an-invoice');
    expect(ai.mock.calls.map((c) => c[0])).toEqual(['captions', 'waits', 'title']);
    // Nothing typed was sent; what's sent is shown.
    // (The instructions' own example says "Sent to Ada"; the data must not hold the typed name.)
    const typed = 'Ada';
    expect(JSON.stringify(ai.mock.calls.map((c) => (c as unknown[])[1]))).not.toContain(typed);
    const det = sr(s).querySelector('.ai details') as HTMLDetailsElement;
    det.open = true;
    det.dispatchEvent(new Event('toggle'));
    expect(det.querySelector('pre')!.textContent).toContain('Invoice saved');
    expect(det.querySelector('pre')!.textContent).not.toContain('Ada');
  });

  it('an AI that fails says so; without ai there is no Suggest; without anything seen, Waits is off', async () => {
    const ai = vi.fn(async () => { throw new Error('quota exceeded'); });
    const s = createStudio({ recorder: { allowSynthetic: true }, ai }, { player: p.load, assist: () => import('../../src/studio/assist-ui') });
    open.push(s);
    s.start();
    (document.querySelector('#customer') as HTMLInputElement).value = 'x';
    document.querySelector('#customer')!.dispatchEvent(new Event('input', { bubbles: true }));
    s.stop();
    click(btn(s, '✨ Suggest captions, waits, a title'));
    await vi.waitFor(() => btn(s, 'Waits'));
    expect(btn(s, 'Waits').disabled).toBe(true);
    click(btn(s, 'Captions'));
    await vi.waitFor(() => expect(sr(s).querySelector('.ai')!.textContent).toContain('The AI could not answer: quota exceeded'));
    const plain = make();
    recordSome(plain);
    expect(Array.from(sr(plain).querySelectorAll('button')).some((b) => b.textContent!.includes('Suggest'))).toBe(false);
  });
});

describe('studio: test play', () => {
  const page = '<button id="new">New invoice</button><input id="customer" aria-label="Customer" data-trace-reveal>';

  it('plays Show me and Do it for me with the app hooks; the review comes back at the end', async () => {
    vi.useFakeTimers();
    html(page);
    const prepare = vi.fn(() => true);
    const onReset = vi.fn();
    const s = make({ prepare, onReset });
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'X');
    click(btn(s, '▶ Show me'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('testing');
    expect(visible(s, '.panel')).toBe(false);
    expect(p.made[0].opts).toMatchObject({ mode: 'overlay', autoplay: true, resumeKey: 'studio:test', controls: true, prepare, onReset });
    expect(JSON.parse(sessionStorage.getItem(STUDIO_REVIEW_KEY)!).testing).toBe('overlay');
    p.made[0].ctl.emit('end', undefined);
    await vi.advanceTimersByTimeAsync(1200);
    expect(p.made[0].ctl.destroyed).toBe(true);
    expect(s.state).toBe('review');
    expect(sr(s).querySelector('.st')!.textContent).toBe('Played to the end.');
    expect(JSON.parse(sessionStorage.getItem(STUDIO_REVIEW_KEY)!).testing).toBeUndefined();

    click(btn(s, '▶ Do it for me'));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.made[1].opts.mode).toBe('perform');
    p.made[1].ctl.emit('state', { phase: 'playing' });
    p.made[1].ctl.emit('state', { phase: 'idle' }); // stopped from the controls
    expect(s.state).toBe('review');
    expect(sr(s).querySelector('.st')!.textContent).toBe('Stopped.');
    expect(p.load).toHaveBeenCalledTimes(1); // loaded once
  });

  it('a player that cannot load says so', async () => {
    html(page);
    const s = createStudio({ recorder: { allowSynthetic: true } }, { player: async () => { throw new Error('offline'); } });
    open.push(s);
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'X');
    click(btn(s, '▶ Show me'));
    await tick();
    expect(s.state).toBe('review');
    expect(sr(s).querySelector('.st')!.textContent).toBe('Could not load the player: offline');
  });

  it('the npm entry loads the perform build for test plays', async () => {
    const mod = await defaultStudioLoaders.player();
    expect(typeof mod.createTrace).toBe('function');
  });
});

describe('studio: across page loads, close and destroy', () => {
  const page = '<button id="new">New invoice</button><input id="customer" aria-label="Customer" data-trace-reveal>';

  it('a recording carries on in the next page’s studio', () => {
    html(page);
    const s = make();
    s.start();
    click(document.querySelector('#new')!);
    window.dispatchEvent(new Event('pagehide'));
    expect(sessionStorage.getItem(STUDIO_REC_KEY)).not.toBeNull();
    s.destroy(); // the page goes away; the recording stays
    expect(sessionStorage.getItem(STUDIO_REC_KEY)).not.toBeNull();
    const next = make();
    expect(next.state).toBe('recording');
    expect(visible(next, '.bar')).toBe(true);
    next.stop();
    expect(next.trace!.steps).toHaveLength(1);
    expect(sessionStorage.getItem(STUDIO_REC_KEY)).toBeNull();
  });

  it('a review carries on, edits included; a test play carries on and plays from where it was', async () => {
    html(page);
    const s = make();
    recordSome(s);
    typeInto(labelled(s, 'Title'), 'Kept');
    typeInto(input(s, 'Caption for step 1'), 'First');
    s.destroy();
    const next = make();
    expect(next.state).toBe('review');
    expect(labelled(next, 'Title').value).toBe('Kept');
    expect(input(next, 'Caption for step 1').value).toBe('First');

    click(btn(next, '▶ Do it for me'));
    await tick();
    next.destroy();
    p = fakePlayer('paused'); // the player found where it was
    const third = make();
    await tick();
    expect(third.state).toBe('testing');
    expect(p.made[0].opts).toMatchObject({ mode: 'perform', autoplay: false });
    expect(p.made[0].ctl.plays).toBe(1);
    third.destroy();
    p = fakePlayer('idle'); // it couldn't: back to the review
    const fourth = make();
    await tick();
    expect(fourth.state).toBe('review');
    expect(p.made[0].ctl.destroyed).toBe(true);
  });

  it('close forgets everything and tells the app', () => {
    html(page);
    const onClose = vi.fn();
    const s = make({ onClose });
    const closed = vi.fn();
    s.on('close', closed);
    recordSome(s);
    click(btn(s, 'Close the studio'));
    expect(s.state).toBe('closed');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(s.host.isConnected).toBe(false);
    expect(sessionStorage.getItem(STUDIO_REVIEW_KEY)).toBeNull();
    s.start();
    expect(s.state).toBe('closed');
    expect(make().state).toBe('idle');
  });

  it('every control has a name', () => {
    html(page);
    const s = make();
    s.start();
    for (const b of Array.from(sr(s).querySelectorAll('button'))) expect(b.textContent || b.getAttribute('aria-label')).toBeTruthy();
    s.stop();
    for (const b of Array.from(sr(s).querySelectorAll('button'))) expect(b.textContent || b.getAttribute('aria-label')).toBeTruthy();
    for (const i of Array.from(sr(s).querySelectorAll('input, textarea'))) expect(i.getAttribute('aria-label') || i.closest('label')).toBeTruthy();
    expect(sr(s).querySelector('.panel')!.getAttribute('role')).toBe('dialog');
    expect(sr(s).querySelector('.panel')!.getAttribute('aria-label')).toBe('Review the guide');
  });
});
