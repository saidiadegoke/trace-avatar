// The React example (examples/react-demo/App.tsx) mounted next to a small controlled invoice form,
// so the browser tests run the example exactly as written. Bundled by scripts/fixtures.mjs.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppGuides, DoItForMe, ShowOrDo } from '../../../examples/react-demo/App';

function Invoice() {
  const [customer, setCustomer] = useState('');
  const [sent, setSent] = useState('');
  return (
    <main style={{ display: 'grid', gap: 12, maxWidth: 420, margin: 40, font: '15px system-ui' }}>
      <button type="button">New invoice</button>
      <label>Customer <input value={customer} onChange={(e) => setCustomer(e.target.value)} /></label>
      <button type="button" onClick={() => setSent(`Sent to ${customer}`)}>Send invoice</button>
      <p id="sent">{sent}</p>
    </main>
  );
}

const w = window as unknown as { resets: number; paths: string[] };
w.resets = 0;
w.paths = [];
const which = new URLSearchParams(location.search).get('example');
createRoot(document.getElementById('root')!).render(
  <>
    <Invoice />
    <nav data-trace-ignore>
      {which === 'do' ? <DoItForMe goTo={(p) => w.paths.push(p)} resetDemo={async () => { w.resets += 1; }} /> : which === 'guides' ? <AppGuides goTo={(p) => w.paths.push(p)} /> : <ShowOrDo />}
    </nav>
  </>,
);
