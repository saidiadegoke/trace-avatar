// The wait-fix fixture: a guide recorded when the app said "Saved". Authors may fix it unless ?deny is in
// the address. Saves are kept to check.
window.saved = [];
const q = location.search;
window.guides = TraceAvatarAuto.mount({
  launcher: false,
  perform: true,
  guides: {
    version: 1,
    guides: [{
      id: 'save',
      title: 'Save an invoice',
      modes: ['overlay', 'perform'],
      trace: {
        version: 1,
        meta: { title: 'Save an invoice' },
        steps: [
          { type: 'click', target: { sel: '#save', role: 'button', name: 'Save' }, say: 'Save it.' },
          { type: 'wait', until: { text: 'Saved' }, timeout: 2500, say: 'Saving…' },
          { type: 'note', say: 'All done.' },
        ],
      },
    }],
  },
  record: {
    allowed: () => !q.includes('deny'),
    save: (trace, entry) => { window.saved.push({ trace, entry }); },
  },
});
