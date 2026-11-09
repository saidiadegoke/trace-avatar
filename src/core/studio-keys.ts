/**
 * Where the studio keeps its work in sessionStorage, so the loader can tell (cheaply, without loading
 * the studio) that a recording or a review was going on when the last page unloaded. PURE.
 */

/** The studio's recorder persistKey (the recording itself is under `trace-avatar:rec:studio`). */
export const STUDIO_PERSIST = 'studio';
export const STUDIO_REC_KEY = `trace-avatar:rec:${STUDIO_PERSIST}`;
/** The guide being reviewed (and a test play going on). */
export const STUDIO_REVIEW_KEY = 'trace-avatar:studio:review';

/** Whether the studio has work to carry on with. */
export function studioWaiting(get: (k: string) => string | null): boolean {
  try { return !!(get(STUDIO_REC_KEY) || get(STUDIO_REVIEW_KEY)); } catch { return false; }
}
