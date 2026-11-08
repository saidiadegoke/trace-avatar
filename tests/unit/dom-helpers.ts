/** happy-dom has no layout: give elements boxes by hand. */
export function setRect(el: Element, x: number, y: number, w = 100, h = 40) {
  (el as Element & { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({
    x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}),
  } as DOMRect);
}

/** Give every element under root a default box so it counts as visible. */
export function layoutAll(root: ParentNode, w = 100, h = 40) {
  let k = 0;
  root.querySelectorAll('*').forEach((el) => { setRect(el, 10 + (k % 10) * 110, 10 + Math.floor(k / 10) * 50, w, h); k += 1; });
}

export function html(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  layoutAll(document.body);
  return document.body;
}
