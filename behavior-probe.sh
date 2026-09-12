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
elif auto:
    serve = "FAIL(auto-launch)"
elif stuck is True:
    serve = "PASS"
else:
    serve = "N/A(stuck=%s)" % stuck
refl = d.get("reflect") or {}
if refl:
    reflect = "PASS" if refl.get("bounced") else "FAIL(no bounce, passedBrick=%s destroyed=%s)" % (refl.get("passedBrick"), refl.get("destroyed"))
elif d.get("reflectErr"):
    reflect = "ERROR " + str(d["reflectErr"])
else:
    reflect = "N/A"
print("SERVE", serve)
print("REFLECTION", reflect)
PYEOF
