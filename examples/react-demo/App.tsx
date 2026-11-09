/**
 * React example. In your app: `npm i trace-avatar`, then
 *   import { TraceAvatar } from 'trace-avatar/react';
 *   import { createPerformer } from 'trace-avatar/perform';   // only for "Do it for me"
 */
import { useState } from 'react';
import { TraceAvatar, useTrace } from '../../src/react/index';
import { createPerformer } from '../../src/perform/index';
import type { Trace } from '../../src/index';

const tour: Trace = {
  version: 1,
  avatar: { name: 'Sarah · Sales' },
  steps: [
    { type: 'click', target: { role: 'button', name: 'New invoice' }, say: 'Start from New invoice.' },
    { type: 'type', target: { role: 'textbox', name: 'Customer' }, text: 'Ada Stores' },
    { type: 'click', target: { role: 'button', name: 'Send invoice' }, say: 'Send it.' },
  ],
};

/** Declarative: drop it in and it plays. */
export function Declarative() {
  return <TraceAvatar trace={tour} autoplay controls onEnd={() => console.log('tour finished')} />;
}

/** Imperative: start it from your own button. */
export function WithButton() {
  const [on, setOn] = useState(false);
  const trace = useTrace({ trace: tour, enabled: on, controls: true });
  return (
    <button type="button" onClick={() => { setOn(true); trace?.play(); }}>
      Show me how
    </button>
  );
}

/** Do it for me: the same trace, but the guide really clicks and types (sandbox or demo data). */
export function DoItForMe({ goTo, resetDemo }: { goTo: (path: string) => void; resetDemo: () => Promise<void> }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOn(true)}>Do it for me</button>
      {on && (
        <TraceAvatar
          trace={tour}
          mode="perform"
          performer={createPerformer}
          autoplay
          controls
          navigate={goTo}
          onReset={resetDemo}
          onHandoff={({ step }) => console.log('your turn: type in', step.target?.name)}
          onEnd={() => setOn(false)}
        />
      )}
    </>
  );
}

/** Show me or Do it for me: one trace, the viewer picks. */
export function ShowOrDo() {
  const [mode, setMode] = useState<'overlay' | 'perform' | null>(null);
  return (
    <>
      <button type="button" onClick={() => setMode('overlay')}>Show me</button>
      <button type="button" onClick={() => setMode('perform')}>Do it for me</button>
      {mode && <TraceAvatar key={mode} trace={tour} mode={mode} performer={createPerformer} autoplay controls onEnd={() => setMode(null)} />}
    </>
  );
}
