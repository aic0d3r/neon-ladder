/* behavior-probe.js v2.1 - injected into a build's index.html by behavior-probe.sh.
   Contract-checklist playtest: menu start, serve gate, launch-on-Space, pad
   reflection, ball-loss handling, brick reflection. Results in window.__bp.
   v2.1: guarded property access (dead-ball entries broke v2.0), pad test via
   Bricks.getObstacle/getObstacle/pad accessors, loss->serve/gameover outcome,
   per-rule verdict map in out.rules. */
(function () {
  const out = window.__bp = { phase: 'boot' };
  function find(names) {
    for (const n of names) { try { const v = eval(n); if (v && typeof v === 'object') return v; } catch (e) {} }
    return null;
  }
  function key(k, code) {
    for (const t of [document, window]) t.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: code, bubbles: true }));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

  async function run() {
    await sleep(600);
    const States = find(['States', 'StateMachine']);
    const state = () => {
      if (!States) return '?';
      try { return States.current || (States.get && States.get()) || States.state || '?'; } catch (e) { return '?'; }
    };
    const domText = () => { try { return (document.body && document.body.innerText || '').toLowerCase(); } catch (e) { return ''; } };
    const Balls = find(['Balls']);
    const getBall = () => {
      try {
        if (!Balls) return null;
        if (Array.isArray(Balls)) return Balls.find((b) => b && num(b.x) !== null) || null;
        if (typeof Balls.firstAlive === 'function') { const b = Balls.firstAlive(); if (b && num(b.x) !== null) return b; }
        for (const k of ['list', 'balls', 'active', 'items', 'all']) {
          const v = Balls[k];
          const arr = typeof v === 'function' ? (function () { try { return v(); } catch (e) { return null; } })() : v;
          if (Array.isArray(arr)) { const b = arr.find((x) => x && num(x.x) !== null); if (b) return b; }
        }
        for (const gk of ['game', 'Game', 'G', 'world']) {
          try { const g = eval(gk); if (g && typeof g === 'object') { for (const k of ['balls', 'ballList', 'activeBalls']) { const arr = g[k]; if (Array.isArray(arr)) { const b = arr.find((x) => x && num(x.x) !== null); if (b) return b; } } } } catch (e) {}
        }
        for (const wk of Object.keys(window)) {
          try {
            const v = window[wk];
            if (Array.isArray(v) && v.length && v[0] && num(v[0].x) !== null && ('vx' in v[0] || 'vy' in v[0])) { const b = v.find((x) => x && num(x.x) !== null); if (b) return b; }
          } catch (e) {}
        }
      } catch (e) {}
      return null;
    };
    out.stateBefore = state();
    const ballBefore = getBall();
    const t0 = Date.now();
    key('Enter', 'Enter');
    let after = state();
    for (let i = 0; i < 10 && after === out.stateBefore; i++) { await sleep(100); after = state(); }
    out.enterMs = Date.now() - t0;
    out.stateAfterEnter = after;
    const StatesUnreadable = out.stateBefore === '?' && after === '?';
    let bEarly = null;
    for (let i = 0; i < 20 && !bEarly; i++) { await sleep(100); bEarly = getBall(); }
    out.menuStart = StatesUnreadable
      ? (!ballBefore && !!bEarly)
      : (after !== out.stateBefore && after !== '?') || (!ballBefore && !!bEarly);
    out.autoStarted = !!ballBefore;
    out.stateAfterEnter = after;
    out.serveTestValid = out.menuStart && !!bEarly;

    let b0 = bEarly;
    out.nBalls = b0 ? 1 : 0;

    // RULE serve gate: no key input; ball must not launch for 2.5s.
    if (b0) {
      const p0 = { x: num(b0.x), y: num(b0.y), vy: num(b0.vy) };
      let moved = 0, vyNonZero = false;
      for (let i = 0; i < 10; i++) {
        await sleep(250);
        const b = getBall();
        if (!b) { out.ballLostEarly = true; break; }
        const x = num(b.x), y = num(b.y), vy = num(b.vy);
        if (x !== null && p0.x !== null) moved = Math.max(moved, Math.abs(x - p0.x));
        if (y !== null && p0.y !== null) moved = Math.max(moved, Math.abs(y - p0.y));
        if (vy !== null && vy !== 0) vyNonZero = true;
      }
      out.serveGate = !out.ballLostEarly && moved <= 2 && !vyNonZero;
      out.autoLaunch = !out.serveGate;
      // RULE launch on Space
      if (out.serveGate) {
        key(' ', 'Space');
        let launched = false;
        for (let i = 0; i < 12; i++) {
          await sleep(50);
          const b = getBall();
          if (!b) break;
          const vy = num(b.vy), y = num(b.y);
          if ((vy !== null && vy < 0) || (y !== null && p0.y !== null && p0.y - y > 3)) { launched = true; break; }
        }
        out.launchOnSpace = launched;
      } else out.launchOnSpace = 'n/a';
    } else { out.serveGate = 'n/a'; out.launchOnSpace = 'n/a'; }

    // RULE brick reflection (existing test, guarded)
    out.brickReflect = 'n/a';
    try {
      const Bricks = find(['Bricks', 'BrickManager']);
      let arr = Bricks ? (Bricks.list || Bricks.bricks || Bricks.grid) : null;
      if (arr && !Array.isArray(arr)) arr = Object.values(arr);
      if (arr) arr = arr.flat(3);
      if ((!arr || !arr.length) && Bricks) {
        for (const k of ['all', 'list', 'bricks', 'getAll']) {
          if (typeof Bricks[k] === 'function') { try { const r = Bricks[k](); if (Array.isArray(r) && r.length) { arr = r; break; } } catch (e) {} }
        }
      }
      if ((!arr || !arr.length) && Bricks && typeof Bricks.queryRect === 'function') {
        try { const r = Bricks.queryRect(0, 0, 4000, 4000); if (Array.isArray(r) && r.length) arr = r; } catch (e) {}
      }
      const Cfg = find(['CONFIG', 'CFG']) || {};
      const radius = (Cfg.BALL && Cfg.BALL.RADIUS) || Cfg.BALL_RADIUS || Cfg.BALL_R || 7;
      const ball = getBall();
      if (arr && arr.length && ball) {
        const alive = arr.filter((x) => x && x.alive !== false && typeof x.y === 'number');
        const br = alive.slice().sort((a, b) => b.y - a.y)[0];
        if (br) {
          const before = alive.length;
          ball.x = br.x + br.w / 2; ball.y = br.y + br.h + radius + 1; ball.vx = 0; ball.vy = -7;
          const samples = [];
          for (let i = 0; i < 6; i++) {
            await sleep(40);
            const nb = getBall();
            if (!nb) break;
            samples.push({ y: num(nb.y), vy: num(nb.vy) });
          }
          out.brickReflect = samples.some((s2) => s2.vy !== null && s2.vy > 0);
          out.brickDetail = { passed: samples.some((s2) => s2.y !== null && s2.y < br.y), destroyed: before - arr.filter((x) => x && x.alive !== false).length };
        }
      }
    } catch (e) { out.brickErr = String(e).slice(0, 100); }

    // RULE pad reflection: teleport ball just above the pad, falling.
    out.padReflect = 'n/a';
    try {
      const Bricks = find(['Bricks', 'BrickManager']);
      let pad = null;
      if (Bricks) {
        for (const k of ['getObstacle', 'obstacle', 'pad', 'getPad']) {
          const v = Bricks[k];
          if (typeof v === 'function') { try { const r = v(); if (r && num(r.x) !== null && num(r.w) !== null) { pad = r; break; } } catch (e) {} }
          if (v && typeof v === 'object' && num(v.x) !== null && num(v.w) !== null) { pad = v; break; }
        }
      }
      const Cfg = find(['CONFIG', 'CFG']) || {};
      const radius = (Cfg.BALL && Cfg.BALL.RADIUS) || Cfg.BALL_RADIUS || Cfg.BALL_R || 7;
      const ball = getBall();
      if (pad && ball) {
        ball.x = num(pad.x) + num(pad.w) / 2; ball.y = num(pad.y) - radius - 1; ball.vx = 0; ball.vy = 7;
        let bounced = false, passed = false;
        for (let i = 0; i < 8; i++) {
          await sleep(40);
          const b = getBall(); if (!b) break;
          const vy = num(b.vy), y = num(b.y);
          if (vy !== null && vy < 0) bounced = true;
          if (y !== null && y > num(pad.y) + num(pad.h) + 12) passed = true;
        }
        out.padReflect = bounced && !passed;
        out.padDetail = { bounced, passed };
      }
    } catch (e) { out.padErr = String(e).slice(0, 100); }

    // RULE ball-loss handling: force the (last) ball off-screen.
    out.lossHandled = 'n/a';
    try {
      const ball = getBall();
      if (ball) {
        ball.y = 4000; ball.vy = 20;
        let outcome = null;
        for (let i = 0; i < 25; i++) {
          await sleep(100);
          const st = String(state());
          if (st.includes('over') || /game\s*over/.test(domText())) { outcome = 'gameover'; break; }
          const nb = getBall();
          if (nb && num(nb.y) !== null && num(nb.y) < 2000) { outcome = 'serve-reentry'; break; }
        }
        out.lossHandled = outcome || 'broken';
        out.lossState = state();
      }
    } catch (e) { out.lossErr = String(e).slice(0, 100); }

    const rules = { menuStart: out.menuStart, serveGate: out.serveGate, launchOnSpace: out.launchOnSpace, padReflect: out.padReflect, lossHandled: out.lossHandled, brickReflect: out.brickReflect };
    let pass = 0, tested = 0;
    for (const k of Object.keys(rules)) {
      const v = rules[k];
      if (v === 'n/a' || v === undefined) continue;
      tested++;
      const ok = v === true || v === 'gameover' || v === 'serve-reentry';
      if (ok) pass++;
    }
    out.rules = rules;
    out.rulesScore = `${pass}/${tested}`;
    out.phase = 'done';
  }

  if (document.readyState === 'complete') run().catch((e) => { out.err = String(e).slice(0, 120); out.phase = 'error'; });
  else window.addEventListener('load', () => run().catch((e) => { out.err = String(e).slice(0, 120); out.phase = 'error'; }));
})();
