// Both pages run the same guide; a full page load happens between its steps.
window.guide = TraceAvatar.createTrace({
  trace: { version: 1, steps: [
    { type: 'click', page: '/tests/e2e/fixtures/multi-a.html', target: { sel: '#to-b' }, t: 300 },
    { type: 'click', page: '/tests/e2e/fixtures/multi-b.html', target: { sel: '#finish' } },
  ] },
  resumeKey: 'multi',
  autoplay: true,
  rate: 2,
});
window.log = [];
window.guide.on('step', (e) => window.log.push(e.index));
