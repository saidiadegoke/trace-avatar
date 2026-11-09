// Adds the loader's script tag with attributes from the page's query (?launcher=off&perform=false),
// exactly as an app would write it by hand.
(() => {
  const q = new URLSearchParams(location.search);
  const s = document.createElement('script');
  s.src = '/dist/trace-auto.min.js';
  s.setAttribute('data-guides', '/tests/e2e/fixtures/guides/index.json');
  if (q.has('launcher')) s.setAttribute('data-launcher', q.get('launcher'));
  s.setAttribute('data-perform', q.get('perform') ?? 'true');
  document.head.appendChild(s);
})();
