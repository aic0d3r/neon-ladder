#!/usr/bin/env bash
# Scripted playtest probe (real-time CDP, no virtual time): serve gating and
# brick reflection. Complements smoke-gate.sh (120s soak) and game-score.py
# (static) with the two behavior classes static analysis cannot see.
#
# SERVE  PASS = ball stays put until Space (stuck/glued serve mode)
#        FAIL = ball moves before any launch key (auto-launch)
# REFLECTION PASS = ball bounces off a brick (vy flips)
#            FAIL = ball passes through the brick (med-d class)
#
# Usage: behavior-probe.sh <build-dir> [wait-ms]
set -u
B=$(readlink -f "$1"); [ -f "$B/index.html" ] || { echo "BEHAVE-FAIL no index.html"; exit 1; }
WAIT=${2:-8000}
G=$(dirname "$(readlink -f "$0")")
T=$(mktemp -d /tmp/behave.XXXX)
cp -r "$B/." "$T/"
python3 - "$T/index.html" "$G/behavior-probe.js" <<'PYEOF'
import sys
page, probe = sys.argv[1], open(sys.argv[2]).read()
s = open(page).read()
assert '</body>' in s, 'no </body>'
open(page, 'w').write(s.replace('</body>', '<script>\n' + probe + '\n</script>\n</body>'))
PYEOF
SERIES=$(timeout $((WAIT / 1000 + 40)) node "$G/wsmin.js" "file://$T/index.html" 'window.__bp?JSON.stringify(window.__bp):"{}"' "$WAIT" 1000 2>/dev/null | grep '^POLL' | tail -1)
rm -rf "$T"
[ -n "$SERIES" ] || { echo "BEHAVE-FAIL no probe output (page died?)"; exit 1; }
JSON=$(echo "$SERIES" | sed 's/^POLL [0-9]*s //')
python3 - "$JSON" <<'PYEOF'
import json, sys
try:
    d = json.loads(sys.argv[1])
except Exception as e:
    print("BEHAVE-ERROR bad json:", sys.argv[1][:200], e); sys.exit(1)
print("probe:", json.dumps(d))
auto, stuck = d.get("autoLaunch"), d.get("stuck")
if not d.get("serveTestValid"):
    serve = "N/A(no Enter start, state=%s)" % d.get("stateAfterSpaceStart", d.get("stateAfterEnter"))
elif d.get("serveGate") is True and d.get("launchOnSpace") is True:
    serve = "PASS"
elif d.get("serveGate") is True:
    serve = "FAIL(no launch on Space)"
elif d.get("serveGate") is False:
    serve = "FAIL(auto-launch)"
else:
    serve = "N/A(ball=%s)" % d.get("nBalls")
br = d.get("brickReflect")
if br is True:
    reflect = "PASS"
elif br is False:
    bd = d.get("brickDetail") or {}
    reflect = "FAIL(no bounce, passedBrick=%s destroyed=%s)" % (bd.get("passed"), bd.get("destroyed"))
else:
    reflect = "N/A"
rules = d.get("rules") or {}
compact = " ".join("%s=%s" % (k, ("PASS" if (v is True or v in ("gameover", "serve-reentry")) else ("n/a" if v in ("n/a", None) else "FAIL"))) for k, v in rules.items())
print("RULES", d.get("rulesScore", "?"), compact)
print("SERVE", serve)
print("REFLECTION", reflect)
PYEOF
