// A real React form with controlled inputs: the hard case for perform mode (React only sees a value
// that is set through the native setter and followed by an input event). Bundled by scripts/fixtures.mjs.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('free');
  const [notes, setNotes] = useState('');
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [clicks, setClicks] = useState(0);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setTimeout(() => setSaved(`Saved: ${name} / ${plan} / ${notes} / ${password.length} chars`), 600); }}
      style={{ display: 'grid', gap: 12, maxWidth: 420, margin: 40, font: '15px system-ui' }}
    >
      <label>Customer <input name="customer" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Plan <select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="free">Free</option><option value="pro">Pro</option></select></label>
      <label>Notes <textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button type="button" onClick={() => setClicks((c) => c + 1)}>Count {clicks}</button>
      <button type="submit">Save</button>
      <p id="out">{saved ?? 'Not saved'}</p>
    </form>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
