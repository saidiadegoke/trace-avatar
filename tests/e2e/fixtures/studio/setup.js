// The studio fixture app: guides from the loader, recording allowed unless ?deny is in the address.
window.saved = [];
const allowed = !location.search.includes('deny');
window.guides = TraceAvatarAuto.mount({
  // One saved guide, listed on another page (so this page's launcher stays empty), for ?trace-edit=saved-one.
  guides: { version: 1, guides: [{ id: 'saved-one', title: 'Start an invoice', modes: ['overlay'], pages: ['/elsewhere'], trace: {
    version: 1, meta: { title: 'Start an invoice' },
    steps: [{ type: 'click', target: { sel: '#new', role: 'button', name: 'New invoice' }, say: 'Start here.' }],
  } }] },
  perform: true,
  record: {
    allowed: () => allowed,
    save: (trace, entry, info) => { window.saved.push({ trace, entry, info }); },
    // ?ai: a stand-in model that answers from what it is sent (and keeps every call to check what was sent).
    ...(location.search.includes('ai') ? { ai: async (task, input) => {
      (window.aiCalls ||= []).push({ task, input });
      if (task === 'waits') return { waits: input.appeared.flatMap((a) => a.appeared.filter((t) => t === 'Saved').map((text) => ({ after: a.after, text, why: 'saving takes a moment' }))) };
      if (task === 'captions') return { steps: input.steps.map((st) => ({ n: st.n, say: `Step ${st.n}: ${st.type}` })) };
      return { title: 'Make an invoice' };
    } } : {}),
  },
});
