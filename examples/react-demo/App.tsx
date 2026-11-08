/**
 * React example. In your app: `npm i trace-avatar`, then
 *   import { TraceAvatar } from 'trace-avatar/react';
 */
import { useState } from 'react';
import { TraceAvatar, useTrace } from '../../src/react/index';
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
