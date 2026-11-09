/** The GIF worker's entry: built (with gifenc) into a string that "Save as video" starts as a Blob worker. */
import { handler } from './gif-encoder';
import type { ToWorker } from './gif-encoder';

const scope = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };
const handle = handler((m, t) => scope.postMessage(m, t ?? []));
scope.onmessage = (e) => handle(e.data);
