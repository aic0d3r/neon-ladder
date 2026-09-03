#!/usr/bin/env python3
"""Neon Overdrive build scorer V2.2: adds nested-movement detector (q8-low class: collision handler runs its own movement loop while called from inside another movement loop). V2.1: adds velocity double-scaling detector (v210-high bug class). V2: for the prompt-multi-v2_9 contract (Laser powerup,
solid obstacle pad, 8% drop rate). V1 (game-score.py, md5 d93f4423d7a7355dc5c5d8348f0cdc89)
is frozen for the stripped prompt-multi.txt contract - scores are NOT comparable
across scorer versions.
Usage: python3 game-score-v2.py <build-dir>
"""
import json, os, re, subprocess, sys

d = sys.argv[1] if len(sys.argv) > 1 else "."
score = []
def check(name, ok, detail=""):
    score.append((name, bool(ok), detail))

req_files = ["index.html", "css/styles.css"] + [f"js/{n}.js" for n in
    ["config", "particles", "bricks", "balls", "powerups", "states", "shop", "main"]]
existing = [f for f in req_files if os.path.isfile(os.path.join(d, f))]
check("all 10 files present", len(existing) == 10, f"{len(existing)}/10")

# node --check on all js
fails = []
for f in req_files[2:]:
    r = subprocess.run(["node", "--check", os.path.join(d, f)], capture_output=True)
    if r.returncode != 0: fails.append(f)
check("node --check clean", not fails, ",".join(fails))

html = open(os.path.join(d, "index.html"), errors="ignore").read() if os.path.isfile(os.path.join(d, "index.html")) else ""
tags = re.findall(r'src="(js/[^"]+)"', html)
missing = [t for t in tags if not os.path.isfile(os.path.join(d, t))]
check("script tags match files", html and not missing, ",".join(missing) or f"{len(tags)} tags")

def read(f):
    p = os.path.join(d, f)
    return open(p, errors="ignore").read() if os.path.isfile(p) else ""

balls, bricks, powerups, shop, main, states = read("js/balls.js"), read("js/bricks.js"), read("js/powerups.js"), read("js/shop.js"), read("js/main.js"), read("js/states.js")
src = balls + bricks + powerups + shop + main + states

# 1. paddle reflection from strike position (not plain inversion)
refl = re.search(r"(hit|strike|rel|relative|contact)[^\n]{0,60}(paddle|center)|Math\.(sin|atan)", src, re.I) and ("paddle" in src)
check("paddle reflection uses strike position", refl)

# 2. armored 3 hits + color progression
armored = ("3" in bricks and re.search(r"red|orange|yellow", bricks, re.I))
check("armored 3-hit color shift", armored)

# 3. volatile neighbor explosion
vol = re.search(r"(col|c|x)\s*[-+]\s*1", bricks) and re.search(r"neighbor|volatile", src, re.I)
check("volatile neighbor explosion", vol)

# 4. tri-ball injects two
tri = re.search(r"push\([^\n]{0,80}\)", balls) and re.search(r"tri", powerups + main, re.I)
check("tri-ball injects balls", tri)

# 5. game over only on last ball
last = re.search(r"(Balls\.(?:all|active)(?:\(\))?|\bballs\b)\s*\.?\s*length\s*(?:={2,3}\s*0|<=?\s*0|<\s*1)", src)
check("game over on last ball only", last)

# 6. dead-ball/particle cleanup
clean = re.search(r"filter\s*\(|splice\s*\(|swap", balls + read("js/particles.js"))
check("dead-entity cleanup", clean)

# 7. serve glue: ball tracks paddle before launch (THE bug class effort level affects)
glue = re.search(r"(serve|ready|attached|glued|stuck|launch)", src, re.I) and \
       re.search(r"ball[^\n]{0,40}paddle\.(x|w)|paddle\.x[^\n]{0,40}ball", balls + main, re.I)
check("serve-mode ball tracks paddle", glue)

# 8. rigid state machine transitions
sm = re.search(r"(menu|start)[^\n]{0,40}(play|game)", states, re.I) and re.search(r"pause", states, re.I)
check("state machine has required states", sm)

# 9. shop persistence
pers = re.search(r"localStorage", shop + main)
check("shop persists (localStorage)", pers)

# 10. procedurally harder levels
proc = re.search(r"level[^\n]{0,50}(harder|speed|difficulty)|Math\.random|mulberry|seed", main + read("js/config.js"), re.I)
check("procedural difficulty scaling", proc)

# 11. no placeholders
ph = re.findall(r"(TODO|FIXME|implement (this|here)|placeholder|coming soon)", src, re.I)
check("zero placeholders", not ph, ",".join(set(ph)) if ph else "")

# 12. 8% drop rate config (v2_9 contract)
drop = re.search(r"(0\.0?8|8\s*%)", src + read("js/config.js"))
check("8% drop rate configured", drop)

# 13. laser powerup: armed paddle, Space fires bolts, cooldown (v2_9 contract)
laser = re.search(r"laser", powerups + main + read("js/config.js"), re.I) and \
        re.search(r"(bolt|fire|shoot)", powerups + main, re.I) and \
        re.search(r"(Space|' '|coold?own|350)", powerups + main, re.I)
check("laser powerup implemented", laser)

# 14a. velocity double-scaling detector: dist=hypot(vx,vy) then vx*dist
# (catches the v210-high class: speed-scaled launch velocity multiplied by speed again)
dbl = re.search(r"(dist|step|len|m)\s*=\s*Math\.hypot\(\s*[a-z]+\.?v?x\s*,\s*[a-z]+\.?v?y\s*\)", balls) and \
     re.search(r"(vx|dy|dx)\s*\*\s*(dist|step|len|m)\b|\b(dist|step|len|m)\s*\*\s*(vx|vy)", balls)
check("no velocity double-scaling", not dbl)

# 14b. nested-movement detector: a collide* function in bricks.js that advances
# the ball itself (position += inside its own loop) - the caller already moves the
# ball, so this multiplies effective speed (q8-low class: 2-3x, compounding/level)
nested = False
# collide fns that run their own sub-step MOVEMENT loop: ceil-derived step count + per-iteration travel.
# (one-time ejection after a hit - as in v29-high - has no ceil-based loop and passes)
for m in re.finditer(r"collide\w*\s*\([^)]*\)\s*\{", bricks):
    body = bricks[m.end():m.end()+3000]
    depth=1; i=0
    while i < len(body) and depth>0:
        if body[i]=='{': depth+=1
        elif body[i]=='}': depth-=1
        i+=1
    body = body[:i]
    if re.search(r"Math\.ceil", body) and re.search(r"(ball|b)\.(x|y)\s*\+=", body) and re.search(r"for\s*\(", body):
        nested = True
check("no nested ball movement in collide fns", not nested)

# 14. obstacle pad: solid, drifting, persists for level (v2_9 contract)
pad = re.search(r"(pad|obstacle)", bricks + read("js/config.js"), re.I) and \
      re.search(r"(drift|sideway|float|persist|solid)", bricks, re.I)
check("obstacle pad present", pad)

ok = sum(1 for _, o, _ in score if o)
print(f"BUILD: {os.path.abspath(d)}")
for name, passed, detail in score:
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))
# total checks: files+syntax+tags = 3, plus 12 feature/quality checks = 15
print(f"STATIC SCORE: {ok}/{len(score)}")
# loc
try:
    loc = sum(sum(1 for _ in open(os.path.join(d, f), errors="ignore")) for f in existing)
    print(f"LOC: {loc}")
except: pass
