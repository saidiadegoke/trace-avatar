/**
 * trace-avatar/perform — the guide acts on the page: clicks, types, presses keys.
 *
 *   import { createTrace } from 'trace-avatar/perform';
 *   createTrace({ trace, prepare: async (requires) => signedIn() });
 *
 * Kept apart from the main entry, so overlay-only pages don't carry it, and so turning it on is a
 * deliberate import. Use it on sandbox or demo data: a trace can click anything the page allows.
 */

import { createTrace as createOverlayOrPerform } from '../index';
import type { TraceController, TraceOptions } from '../index';
import { createPerformer } from '../shell/perform.dom';

export * from '../index';
export { createPerformer, parseCombo, fieldOf, setNativeValue } from '../shell/perform.dom';

/** createTrace with perform mode on (pass mode: 'overlay' to turn it off) and the performer wired in. */
export function createTrace(opts: TraceOptions): TraceController {
  return createOverlayOrPerform({ ...opts, mode: opts.mode ?? 'perform', performer: opts.performer ?? createPerformer });
}
