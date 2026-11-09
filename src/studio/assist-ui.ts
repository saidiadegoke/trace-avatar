/**
 * The studio's "Suggest" section (loaded only when an author first opens it): asks the configured AI for
 * captions, waits or a title, and lists each suggestion as before → after with Accept and Reject. Nothing
 * changes until the author accepts; the studio applies what is accepted.
 */

import { preview, suggest } from '../assist/index';
import type { Ai, Dropped, Hint, Suggestion } from '../assist/index';
import type { Trace } from '../core/format';

type Kid = Node | string | null | false | undefined;

export interface AssistUiHost {
  h(tag: string, a?: Record<string, unknown>, ...kids: Kid[]): HTMLElement;
  ai: Ai;
  /** The guide as it stands (step indexes as the review lists them). */
  trace(): Trace;
  hints(): Hint[];
  /** Apply one accepted suggestion (the studio re-renders, calling render() again). */
  accept(s: Suggestion): void;
}

export interface AssistUi { render(box: HTMLElement): void }

const TASKS = [['captions', 'Captions'], ['waits', 'Waits'], ['title', 'A title']] as const;

export function createAssistUi(host: AssistUiHost): AssistUi {
  const { h } = host;
  let pending: Suggestion[] = [];
  let dropped: Dropped[] = [];
  let busy: string | null = null;
  let message = '';
  let box: HTMLElement | null = null;
  const rerender = () => { if (box) render(box); };

  async function ask(task: 'captions' | 'waits' | 'title', label: string) {
    busy = label;
    message = '';
    rerender();
    try {
      const r = await suggest(task, host.trace(), { ai: host.ai, hints: host.hints() });
      // A new ask replaces that task's earlier suggestions.
      pending = [...pending.filter((s) => s.task !== task), ...r.suggestions];
      dropped = r.dropped;
      message = r.suggestions.length ? '' : task === 'waits' && !host.hints().length ? 'Nothing appeared on the page after any step, so there is nothing to wait for.' : 'No suggestions.';
    } catch (e) {
      message = `The AI could not answer: ${(e as Error).message}`;
    }
    busy = null;
    rerender();
  }

  function take(s: Suggestion) {
    pending = pending.filter((x) => x !== s);
    // A new wait step moves every later step down by one.
    if (s.kind === 'wait') pending = pending.map((x) => (x.index > s.index ? { ...x, index: x.index + 1 } : x));
    host.accept(s);
  }

  const labelOf = (s: Suggestion) => (s.kind === 'say' ? `Step ${s.index + 1}, caption` : s.kind === 'wait' ? `After step ${s.index + 1}, wait until the page shows` : 'Title');

  function render(el: HTMLElement) {
    box = el;
    el.textContent = '';
    const hintsNone = !host.hints().length;
    el.append(h('div', { className: 'row' }, h('span', {}, '✨ Suggest:'),
      ...TASKS.map(([task, label]) => h('button', {
        disabled: !!busy || (task === 'waits' && hintsNone),
        title: task === 'waits' && hintsNone ? 'Nothing appeared on the page after any step' : undefined,
        onclick: () => void ask(task, label),
      }, label))));
    if (busy) el.append(h('p', { className: 'st', role: 'status' }, `Asking for ${busy.toLowerCase()}…`));
    if (message) el.append(h('p', { className: 'st', role: 'status' }, message));
    if (pending.length) {
      const list = h('ol', { 'aria-label': 'Suggestions' });
      for (const s of pending) {
        list.append(h('li', {},
          h('div', {}, h('small', {}, labelOf(s))),
          s.before ? h('div', {}, h('s', {}, s.before)) : null,
          h('div', {}, s.kind === 'wait' ? `“${s.value}”` : s.value),
          s.why ? h('small', {}, s.why) : null,
          h('div', { className: 'row' },
            h('button', { className: 'go', 'aria-label': `Accept: ${labelOf(s)}`, onclick: () => take(s) }, 'Accept'),
            h('button', { 'aria-label': `Reject: ${labelOf(s)}`, onclick: () => { pending = pending.filter((x) => x !== s); rerender(); } }, 'Reject'))));
      }
      el.append(list, h('div', { className: 'row' },
        h('button', { onclick: () => { for (const s of pending.slice()) take(pending.find((x) => x.task === s.task && x.kind === s.kind && x.value === s.value) ?? s); } }, 'Accept all'),
        h('button', { onclick: () => { pending = []; rerender(); } }, 'Dismiss all')));
    }
    if (dropped.length) el.append(h('small', {}, `${dropped.length} suggestion${dropped.length > 1 ? 's' : ''} left out: ${dropped.slice(0, 3).map((d) => d.why).join('; ')}.`));
    const pre = h('pre', { style: 'white-space:pre-wrap;font:11px/1.4 ui-monospace,monospace;margin:4px 0 0;max-height:200px;overflow:auto' });
    const sent = h('details', { ontoggle: () => {
      if (!(sent as HTMLDetailsElement).open) return;
      const t = host.trace();
      const hints = host.hints();
      pre.textContent = JSON.stringify({ captions: preview('captions', t).input, waits: preview('waits', t, { hints }).input, title: preview('title', t).input }, null, 1);
    } }, h('summary', {}, 'What’s sent to the AI'), pre);
    el.append(sent);
  }

  return { render };
}
