/* behavior-probe.js v2.1 - injected into a build's index.html by behavior-probe.sh.
   Contract-checklist playtest: menu start, serve gate, launch-on-Space, pad
   reflection, ball-loss handling, brick reflection. Results in window.__bp.
   v2.1: guarded property access (dead-ball entries broke v2.0), pad test via
   Bricks.getObstacle/getObstacle/pad accessors, loss->serve/gameover outcome,
   per-rule verdict map in out.rules. */
(function () {
  const out = window.__bp = { phase: 'boot' };
  // v2.2 shop-persistence boot branch: sessionStorage flag set before a reload.
  try {
    if (sessionStorage.getItem('__bp2') === '1') {
      sessionStorage.removeItem('__bp2');
      let found = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/credit|coin|money|cash/i.test(k)) { found = { key: k, value: localStorage.getItem(k) }; break; }
      }
      out.shopPersist = found ? (Number(found.value) === 777 ? 'pass' : 'changed:' + found.value) : 'no-key';
      out.phase = 'done-shop';
      return;
    }
  } catch (e) {}
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

    const getBallCount = () => { try { const B = Balls; if (!B) return 0; if (Array.isArray(B)) return B.filter((b) => b && num(b.x) !== null).length; if (typeof B.count === 'function') return B.count(); for (const k of ['list','balls','active','items','all']) { const v = B[k]; const arr = typeof v === 'function' ? (function(){ try { return v(); } catch (e) { return null; } })() : v; if (Array.isArray(arr)) return arr.filter((x) => x && num(x.x) !== null).length; } } catch (e) {} return getBall() ? 1 : 0; };
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


    // RULE pacing: launched ball should run ~420 px/s (BALL_BASE_SPEED 7 at 60fps).
    out.pacing = 'n/a';
    try {
      const ball = getBall();
      if (ball) {
        key(' ', 'Space');
        let launchedAt = null, y0 = null;
        for (let i = 0; i < 20; i++) { await sleep(50); const b = getBall(); if (b && num(b.vy) !== 0) { launchedAt = Date.now(); y0 = num(b.y); break; } }
        if (launchedAt !== null) {
          await sleep(400);
          const b = getBall();
          if (b && num(b.y) !== null && y0 !== null) {
            const v = Math.abs(num(b.y) - y0) / ((Date.now() - launchedAt - 400) / 1000 + 0.4);
            out.pacing = (v > 300 && v < 560) ? 'pass' : 'off:' + Math.round(v);
            out.pacingPx = Math.round(v);
          }
        }
      }
    } catch (e) { out.pacingErr = String(e).slice(0, 80); }

    // RULE tri-ball -> game over only on LAST ball (needs a spawnable powerup).
    out.lastBall = 'n/a';
    try {
      const Powerups = find(['Powerups', 'powerups', 'PowerUp', 'Powerup']);
      let spawnFn = null;
      if (Powerups) for (const k of ['spawn', 'add', 'drop', 'spawnRandom', 'spawnAt']) { if (typeof Powerups[k] === 'function') { spawnFn = Powerups[k].bind(Powerups); break; } }
      const Cfg2 = find(['CONFIG', 'CFG']) || {};
      const H = (Cfg2.CANVAS && Cfg2.CANVAS.HEIGHT) || Cfg2.HEIGHT || 720;
      if (spawnFn) {
        const paddle = find(['Paddle', 'paddle']) || null;
        const px = paddle ? (num(paddle.x) || 0) + (num(paddle.w) || 80) / 2 : 400;
        let spawned = false;
        try { spawnFn('triball', px, H * 0.35); spawned = true; } catch (e) { try { spawnFn(px, H * 0.35); spawned = true; } catch (e2) {} }
        if (spawned) {
          for (let i = 0; i < 25; i++) { await sleep(100); if ((getBallCount()) >= 3) break; }
          const c = getBallCount();
          if (c >= 3) {
            let losses = 0;
            for (let r = 0; r < 6; r++) {
              const b = getBall(); if (!b) break;
              b.y = 4000; b.vy = 20;
              let over = false, re = false;
              for (let i = 0; i < 25; i++) {
                await sleep(100);
                const st = String(state());
                if (st.includes('over') || /game\s*over/.test(domText())) { over = true; break; }
                if (getBallCount() >= 1 && r < 5) { re = true; break; }
              }
              losses++;
              if (over) break;
            }
            out.lastBall = (getBallCount() === 0 && String(state()).toLowerCase().includes('over')) || /game\s*over/.test(domText()) ? 'pass-after-' + losses : 'broken';
          }
        }
      }
    } catch (e) { out.lastBallErr = String(e).slice(0, 80); }

    // RULE laser: arm then fire (needs a spawnable powerup).
    out.laser = 'n/a';
    try {
      const Powerups = find(['Powerups', 'powerups', 'PowerUp', 'Powerup']);
      const Paddle = find(['Paddle', 'paddle']);
      let spawnFn = null;
      if (Powerups) for (const k of ['spawn', 'add', 'drop']) { if (typeof Powerups[k] === 'function') { spawnFn = Powerups[k].bind(Powerups); break; } }
      const Cfg3 = find(['CONFIG', 'CFG']) || {};
      const H3 = (Cfg3.CANVAS && Cfg3.CANVAS.HEIGHT) || Cfg3.HEIGHT || 720;
      if (spawnFn && Paddle) {
        const px = (num(Paddle.x) || 0) + (num(Paddle.w) || 80) / 2;
        try { spawnFn('laser', px, H3 * 0.4); } catch (e) { try { spawnFn(px, H3 * 0.4); } catch (e2) {} }
        for (let i = 0; i < 25; i++) { await sleep(100); if (num(Paddle.y) !== null) { const py = num(Paddle.y), cap = null; break; } }
        key('ArrowLeft', 'ArrowLeft');
        await sleep(600);
        key(' ', 'Space');
        await sleep(300);
        const txt = domText();
        const armed = /laser/i.test(txt);
        out.laser = armed ? 'pass-armed' : 'fired-unverifiable';
      }
    } catch (e) { out.laserErr = String(e).slice(0, 80); }

    // RULE shop persistence: set a credit key, reload; the boot branch verifies.
    out.shopPersist = 'n/a';
    try {
      let ck = null;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/credit|coin|money|cash/i.test(k)) { ck = k; break; } }
      if (ck) { localStorage.setItem(ck, '777'); sessionStorage.setItem('__bp2', '1'); setTimeout(() => location.reload(), 50); return; }
    } catch (e) { out.shopErr = String(e).slice(0, 80); }

    const rules = { menuStart: out.menuStart, serveGate: out.serveGate, launchOnSpace: out.launchOnSpace, padReflect: out.padReflect, lossHandled: out.lossHandled, brickReflect: out.brickReflect, pacing: out.pacing === 'pass' ? true : out.pacing, lastBall: out.lastBall, shopPersist: out.shopPersist };
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
