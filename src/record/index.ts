/**
 * trace-avatar/record — capture a session into a trace.json.
 *
 *   import { createRecorder } from 'trace-avatar/record';
 *   const rec = createRecorder({ title: 'Create an invoice' });
 *   rec.start();  … use the page …  const trace = rec.stop();
 */

export { createRecorder, comboOf, factsOf } from '../shell/recorder.dom';
export type { Recorder, RecorderOptions, RecorderEvents } from '../shell/recorder.dom';
export type { RecorderState } from '../core/recorder-state';
export { build, coalesce } from '../core/build';
export type { Draft, DraftKind } from '../core/build';
export { shouldMask, isSecret, maskText } from '../core/mask';
export { buildTarget, bestSelector, candidates, pathSelector, looksGenerated, roleOf, meaningful } from '../shell/selector.dom';
