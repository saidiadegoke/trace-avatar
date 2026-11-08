/** A small typed event emitter. A listener that throws is reported and never stops playback. */
export function createEmitter<E extends Record<string, unknown>>(onError: (err: unknown) => void = (e) => console.error('[trace-avatar] listener failed:', e)) {
  const map = new Map<keyof E, Set<(data: any) => void>>();
  return {
    on<K extends keyof E>(ev: K, fn: (data: E[K]) => void): () => void {
      let set = map.get(ev);
      if (!set) { set = new Set(); map.set(ev, set); }
      set.add(fn);
      return () => { set!.delete(fn); };
    },
    emit<K extends keyof E>(ev: K, data: E[K]) {
      const set = map.get(ev);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try { fn(data); } catch (err) { onError(err); }
      }
    },
    count: (ev: keyof E) => map.get(ev)?.size ?? 0,
    clear: () => map.clear(),
  };
}
