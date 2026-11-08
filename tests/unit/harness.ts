import { parse } from '../../src/core/format';
import type { NormalisedTrace, Trace } from '../../src/core/format';
import { initial, update, view } from '../../src/core/player';
import type { Config, Effect, Look, Msg, PlayerState, View } from '../../src/core/player';

export const CFG: Config = { reducedMotion: false, loop: false, mac: true, resumeHint: true };

export function trace(raw: Omit<Trace, 'version'> & { version?: 1 }): NormalisedTrace {
  const r = parse({ version: 1, ...raw });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.trace;
}

export const box = (x: number, y: number, w = 100, h = 40, extra: Partial<Look> = {}): Look => ({ x, y, w, h, by: 'sel', inView: true, ...extra });

/** Drives the pure player with a manual clock and a table of element boxes. */
export class Sim {
  s: PlayerState;
  now = 1000;
  fx: Effect[] = [];
  looks: Record<number, Look | null>;
  /** The viewer's page; undefined = unknown (every page matches). */
  at: string | undefined = undefined;
  vp = { w: 1280, h: 800 };
  lookCalls = 0;

  constructor(public tr: NormalisedTrace, looks: Record<number, Look | null> = {}, public cfg: Config = CFG) {
    this.s = initial();
    this.looks = looks;
  }

  look = (i: number): Look | null => { this.lookCalls += 1; return this.looks[i] ?? null; };

  send(m: Msg): Effect[] {
    const [s, fx] = update(this.s, m, this.tr, this.cfg);
    this.s = s;
    this.fx.push(...fx);
    return fx;
  }

  frame(dt = 16): Effect[] {
    this.now += dt;
    return this.send({ kind: 'frame', now: this.now, look: this.look, vp: this.vp, ...(this.at !== undefined ? { at: this.at } : {}) });
  }

  /** Run frames until `ms` of wall time has passed. */
  run(ms: number, dt = 16): Effect[] {
    const out: Effect[] = [];
    for (let left = ms; left > 0; left -= dt) out.push(...this.frame(Math.min(dt, left)));
    return out;
  }

  /** Run frames until trace time reaches t (playing). */
  until(t: number, dt = 16, max = 100_000): Effect[] {
    const out: Effect[] = [];
    for (let k = 0; k < max && this.s.clock.elapsed < t && this.s.phase === 'playing'; k += 1) out.push(...this.frame(dt));
    return out;
  }

  play(): this { this.send({ kind: 'play' }); this.frame(); return this; }

  get t() { return this.s.clock.elapsed; }
  get view(): View { return view(this.s, this.tr, this.look, this.cfg, this.at); }
  kinds(fx: Effect[] = this.fx) { return fx.map((f) => f.fx); }
}
