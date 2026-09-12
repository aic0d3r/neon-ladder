/* behavior-probe.js - injected into a build's index.html by behavior-probe.sh.
   Real-time scripted playtest: serve gating + brick reflection.
   Results land in window.__bp; read it via wsmin.js. */
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

  async function run() {
    await sleep(600);
    const States = find(['States', 'StateMachine']);
    const state = () => {
      if (!States) return '?';
      try { return States.current || (States.get && States.get()) || States.state || '?'; } catch (e) { return '?'; }
    };
    out.stateBefore = state();
    key('Enter', 'Enter');
    await sleep(1000);
    out.stateAfterEnter = state();
    out.enterStart = out.stateAfterEnter !== out.stateBefore;
    if (!out.enterStart) { key(' ', 'Space'); await sleep(1000); out.stateAfterSpaceStart = state(); }

    const Balls = find(['Balls']);
    let list = [];
    if (Balls) {
      if (Array.isArray(Balls)) list = Balls;
      else {
        for (const k of ['list', 'balls', 'active', 'items', 'all']) {
          const v = Balls[k];
          if (Array.isArray(v)) { list = v; break; }
          if (typeof v === 'function') { try { const r = v(); if (Array.isArray(r)) { list = r; break; } } catch (e) {} }
        }
        if (!list.length) { for (const k of Object.keys(Balls)) { if (Array.isArray(Balls[k])) { list = Balls[k]; break; } } }
        if (!list.length && typeof Balls.firstAlive === 'function') { try { const b = Balls.firstAlive(); if (b) list = [b]; } catch (e) {} }
      }
    }
    let b0 = list[0] || null;
    for (let i = 0; i < 15 && !b0; i++) { await sleep(100); b0 = list[0] || null; }
    out.nBalls = list.length;
    out.stuck = b0 ? !!b0.stuck : 'n/a';
    const p0 = b0 ? { x: b0.x, y: b0.y } : null;
    out.serveTestValid = !!b0 && out.enterStart;
    await sleep(500);
    const b1 = list[0] || null;
    out.ballLostEarly = !!(p0 && !b1);
    out.autoLaunch = !!(p0 && ((b1 && (Math.abs(b1.x - p0.x) > 0.5 || Math.abs(b1.y - p0.y) > 0.5)) || out.ballLostEarly));
    if (b1 && b1.stuck) { key(' ', 'Space'); await sleep(300); }

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
      const ball = list[0];
      if (arr && arr.length && ball) {
        const alive = arr.filter((x) => x && x.alive !== false && typeof x.y === 'number');
        const br = alive.slice().sort((a, b) => b.y - a.y)[0];
        const before = alive.length;
        ball.x = br.x + br.w / 2; ball.y = br.y + br.h + radius + 1; ball.vx = 0; ball.vy = -7;
        const samples = [];
        for (let i = 0; i < 6; i++) {
          await sleep(40);
          const nb = list[0];
          if (!nb) break;
          samples.push({ y: nb.y, vy: nb.vy });
        }
        out.reflect = {
          bounced: samples.some((s) => s.vy > 0),
          vy: samples.length ? +samples[samples.length - 1].vy.toFixed(2) : null,
          passedBrick: samples.some((s) => s.y < br.y),
          destroyed: before - arr.filter((x) => x && x.alive !== false).length
        };
      }
    } catch (e) { out.reflectErr = String(e).slice(0, 100); }
    out.phase = 'done';
  }

  if (document.readyState === 'complete') run().catch((e) => { out.err = String(e).slice(0, 120); out.phase = 'error'; });
  else window.addEventListener('load', () => run().catch((e) => { out.err = String(e).slice(0, 120); out.phase = 'error'; }));
})();
