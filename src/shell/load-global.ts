/** Load a script once and resolve to the global it defines (the CDN builds load their chunks this way). */
export function loadGlobal<T>(src: string, name: string, has: (g: unknown) => boolean, doc: Document = document): Promise<T> {
  const w = doc.defaultView as unknown as Record<string, unknown>;
  if (has(w[name])) return Promise.resolve(w[name] as T);
  return new Promise<T>((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => (has(w[name]) ? resolve(w[name] as T) : reject(new Error(`${src} did not define ${name}`)));
    s.onerror = () => reject(new Error(`could not load ${src}`));
    (doc.head ?? doc.documentElement).appendChild(s);
  });
}

/** The folder a script was loaded from (where its sibling chunks sit). */
export const baseOf = (el: HTMLScriptElement | null): string => (el?.src ? el.src.replace(/[^/]*([?#].*)?$/, '') : '');

/** The perform build (plays both modes). trace.min.js also defines TraceAvatar, without the hands. */
export const hasPerformer = (g: unknown): boolean => !!g && typeof (g as { createPerformer?: unknown }).createPerformer === 'function';
