// Dynamic resolution safety net (docs/api/perf.md). Lowers the renderer's pixel ratio one step when the frame interval
// stays over budget, and raises it again after a long quiet spell. Anti-pumping: every time a raise is followed by a
// drop within a few seconds, the wait before the next raise doubles (8 s -> 16 -> 32 -> 64 s); long stable play halves
// it again. Hitches (> 90 ms: streaming, loading, a tab switch) never count: only sustained load moves the resolution.
//   createDynRes(G, { steps, onResize(ratio, index), stepRule? }) -> { update(rdtSeconds), index, ratio, enabled, limit, stats() }
// steps[0] is the tier's own pixel ratio (already capped by devicePixelRatio); each later step is a lower ratio. On a
// phone / tablet (core/boot.js) the first steps keep the ratio and shed scene cost ('perf:lite'), the last ones lower the
// rendered lines. stepRule(i) -> { over: ms, hold: windows } makes the drop INTO step i stricter (default: budget x OVER
// for HOLD_DOWN windows). limit = the deepest step allowed (a lower limit moves there at once).
// The frame budget follows the frame pacer (createPacer below, G.pace): 16.7 ms, or 33.3 ms under a 30 fps cap; while
// the pacer is still trying 60 fps (its trial) the resolution holds still.

const WIN = 1.0;          // s per evaluation window
const OVER = 1.14;        // x budget: a window whose mean interval is over this is "over budget" (60 Hz: 19 ms)
const UNDER = 1.044;      // x budget: a window whose mean interval is under this is "at the target rate" (60 Hz: 17.4 ms)
const HOLD_DOWN = 2;      // consecutive over-budget windows before a drop
const HOLD_AFTER = 3;     // s after any change before the next drop may happen (the new size must settle first)

export function createDynRes(G, { steps, onResize, stepRule = null }) {
  const st = {
    enabled: true, index: 0, steps, limit: Infinity,
    winT: 0, winN: 0, winSum: 0,
    overRun: 0, goodT: 0, sinceChange: 99,
    upWait: 8, lastUpAt: -1e9, clock: 0, changes: 0,
  };
  function apply(i) {
    if (i === st.index) return;
    st.index = i; st.sinceChange = 0; st.changes++;
    try { onResize(steps[i], i); } catch (e) { G.reportError?.('dynres', e); }
  }
  return {
    get index() { return st.index; },
    get ratio() { return steps[st.index]; },
    get enabled() { return st.enabled; },
    set enabled(v) { st.enabled = !!v; if (!st.enabled) apply(0); },
    /** Force a step (tests / photo mode); also resets the anti-pumping wait. */
    set(i) { apply(Math.max(0, Math.min(steps.length - 1, i | 0))); },
    get limit() { return st.limit; },
    set limit(n) { st.limit = Math.max(0, n); if (st.index > st.limit) apply(Math.min(steps.length - 1, st.limit)); },
    stats() { return { index: st.index, ratio: steps[st.index], steps, changes: st.changes, upWait: st.upWait, limit: st.limit }; },
    update(rdt) {
      if (!st.enabled || steps.length < 2) return;
      const ms = rdt * 1000;
      st.clock += rdt; st.sinceChange += rdt;
      const budget = G.pace?.budget || 1000 / 60;
      if (ms <= 0 || ms > Math.max(90, budget * 2.7) || G.paused || G.mode !== 'play' || G.pace?.trial || (typeof document !== 'undefined' && document.hidden)) return;
      st.winT += rdt; st.winN++; st.winSum += ms;
      if (st.winT < WIN) return;
      const mean = st.winSum / st.winN;
      st.winT = 0; st.winN = 0; st.winSum = 0;
      const top = Math.min(steps.length - 1, st.limit);
      const rule = st.index < top ? stepRule?.(st.index + 1) : null;
      const overMs = rule?.over ?? budget * OVER, hold = rule?.hold ?? HOLD_DOWN;
      // over budget: no quiet time; it counts toward a drop only past the next step's own threshold
      if (mean > budget * OVER) { st.goodT = 0; st.overRun = mean > overMs ? st.overRun + 1 : 0; }
      else { st.overRun = 0; if (mean < budget * UNDER) st.goodT += WIN; else st.goodT = 0; }
      if (st.overRun >= hold && st.sinceChange >= HOLD_AFTER && st.index < top) {
        // dropped soon after a raise: that raise was too optimistic -> wait longer before the next one
        if (st.clock - st.lastUpAt < 6) st.upWait = Math.min(64, st.upWait * 2);
        st.overRun = 0; st.goodT = 0;
        apply(st.index + 1);
        return;
      }
      if (st.index > 0 && st.goodT >= st.upWait && st.sinceChange >= st.upWait) {
        st.goodT = 0; st.lastUpAt = st.clock;
        apply(st.index - 1);
        return;
      }
      // a long stable spell at the top step forgives earlier pumping
      if (st.index === 0 && st.goodT >= 60) { st.upWait = Math.max(8, st.upWait / 2); st.goodT = 0; }
    },
  };
}

// Frame pacing (mobile round 2, docs/api/perf.md "Phones"): a frame limiter for the main loop. A phone that cannot hold
// 60 fps alternates 16 / 33 ms frames (judder); a steady 30 reads smoother and keeps the handset cooler.
//   createPacer(G, { cap: 0 | 30 | 60, auto }) -> { gate(now), update(rdt), cap, budget, trial, set(cap), stats() }
// gate(now) runs first in every requestAnimationFrame callback: false = skip this display refresh (nothing updates or
// draws). auto (the 'mobile' tier): once play has run TRIAL_WAIT seconds (streaming and the warm-up frame settle), the next
// TRIAL seconds run capped at 60; a device that clearly holds it (mean interval <= 17.4 ms and at most 10 % of the frames
// over 20 ms) keeps 60, anything else is capped at 30 for the session. At 60, two over-budget seconds in a row (a phone
// that heats up) also drop it to 30. Hitches (> 90 ms) never count. ?fps=30|60|0 forces a cap (0 = the display rate).
const TRIAL_WAIT = 3, TRIAL = 5;
export function createPacer(G, { cap = 0, auto = false } = {}) {
  const st = { cap: auto ? 60 : cap, auto, trial: auto, wait: TRIAL_WAIT, tT: 0, tN: 0, tSum: 0, tBad: 0, last: -1e9,
    winT: 0, winN: 0, winSum: 0, overRun: 0, decided: null, skipped: 0 };
  const set = (c) => { st.cap = c === 30 || c === 60 ? c : 0; };
  return {
    get cap() { return st.cap; },
    /** target frame interval in ms (dynres measures against it) */
    get budget() { return st.cap === 30 ? 1000 / 30 : 1000 / 60; },
    get trial() { return st.trial; },
    set(c) { st.trial = false; st.auto = false; set(c); },
    stats() { return { cap: st.cap, trial: st.trial, auto: st.auto, decided: st.decided, skipped: st.skipped }; },
    gate(now) {
      if (!st.cap) return true;
      // a refresh comes every 16.7 / 11.1 / 8.3 ms; draw on the first one at least (interval - slack) after the last draw
      if (now - st.last < 1000 / st.cap - (st.cap === 30 ? 4 : 2)) { st.skipped++; return false; }
      st.last = now;
      return true;
    },
    update(rdt) {
      if (!st.auto) return;
      const ms = rdt * 1000;
      if (ms <= 0 || ms > 90 || G.paused || G.mode !== 'play' || (typeof document !== 'undefined' && document.hidden)) return;
      if (st.trial) {
        if (st.wait > 0) { st.wait -= rdt; return; }
        st.tT += rdt; st.tN++; st.tSum += ms; if (ms > 20) st.tBad++;
        if (st.tT < TRIAL) return;
        const mean = st.tSum / st.tN, hold = mean <= 17.4 && st.tBad <= st.tN * 0.1;
        st.trial = false; st.decided = { fps: hold ? 60 : 30, mean: Math.round(mean * 10) / 10, slow: st.tBad, frames: st.tN };
        set(hold ? 60 : 30);
        return;
      }
      if (st.cap !== 60) return;
      st.winT += rdt; st.winN++; st.winSum += ms;
      if (st.winT < 1) return;
      const mean = st.winSum / st.winN;
      st.winT = 0; st.winN = 0; st.winSum = 0;
      st.overRun = mean > 19 ? st.overRun + 1 : 0;
      if (st.overRun >= 2) { set(30); st.decided = { ...(st.decided || {}), fps: 30, late: true }; }
    },
  };
}
