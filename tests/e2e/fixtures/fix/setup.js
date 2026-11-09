// The fix fixture: a guide recorded before "Save invoice" became "Store invoice". Authors may fix it
// unless ?deny is in the address; ?nosave leaves save out (a download). Saves are kept to check.
window.saved = [];
const q = location.search;
window.guides = TraceAvatarAuto.mount({
  launcher: false,
  perform: true,
  guides: {
    version: 1,
    guides: [{
      id: 'invoice',
      title: 'Make an invoice',
      modes: ['overlay', 'perform'],
      trace: {
        version: 1,
        meta: { title: 'Make an invoice' },
        steps: [
          { type: 'click', target: { sel: '#new', role: 'button', name: 'New invoice' }, say: 'Start a new one.' },
          { type: 'click', target: { role: 'button', name: 'Save invoice', text: 'Save invoice' }, say: 'Save it.', timeout: 1200 },
          { type: 'note', say: 'All done.' },
        ],
      },
    }],
  },
  record: {
    allowed: () => !q.includes('deny'),
    ...(q.includes('nosave') ? {} : { save: (trace, entry) => { window.saved.push({ trace, entry }); } }),
  },
});
