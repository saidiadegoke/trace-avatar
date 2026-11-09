// The studio fixture app: guides from the loader, recording allowed unless ?deny is in the address.
window.saved = [];
const allowed = !location.search.includes('deny');
window.guides = TraceAvatarAuto.mount({
  guides: { version: 1, guides: [] },
  perform: true,
  record: { allowed: () => allowed, save: (trace, entry) => { window.saved.push({ trace, entry }); } },
});
