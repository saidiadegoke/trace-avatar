/**
 * DOM storage for the happy-dom tests, whatever the Node version.
 *
 * From Node 25, Node has its own `localStorage` and `sessionStorage` globals (Web Storage, on by default).
 * They take the place of happy-dom's: `localStorage` is undefined without --localstorage-file, and
 * `sessionStorage` is one in-memory store for the whole process. Each test file gets the storage of a
 * happy-dom window instead, as it did before Node 25. Node-environment tests are left alone.
 */
import { Window } from 'happy-dom';

if (typeof document !== 'undefined') {
  const spare = new Window();
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, { value: spare[name], configurable: true, writable: true, enumerable: true });
  }
}
