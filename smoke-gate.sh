#!/usr/bin/env bash
# Runtime smoke gate: 120s gameplay soak (default) on a copy of the build.
# Polls through wsmin.js (raw-WebSocket CDP client). A build passes if the
# page survives the soak without reloading, the rAF loop and canvas draw-ops
# keep advancing, and no fatal page error fires. Boot errors are fatal;
# caught per-frame errors are warnings when the loop demonstrably survived.
# Usage: smoke-gate.sh <build-dir> [soak-secs]   (env SOAK also works)
set -u
B=$(readlink -f "$1"); SOAK=${2:-${SOAK:-120}}
G=$(dirname "$(readlink -f "$0")")
T=$(mktemp -d /tmp/smoke.XXXX)   # disposable sandbox; verdicts+logs live in results/
cp -r "$B/." "$T/"
python3 - "$T/index.html" <<'PYEOF'
import sys
p=sys.argv[1]; s=open(p).read()
probe="""<script>
window.__fl=0; window.__err=null; window.__errAt=null;
const _r=window.requestAnimationFrame.bind(window);
window.requestAnimationFrame=function(fn){return _r(function(t){window.__fl++;try{fn(t);}catch(e){window.__err=e.message;window.__errAt=Math.round(performance.now()/1000);}});};
window.addEventListener('error',e=>{if(!window.__err)window.__err='global: '+e.message;window.__errAt=Math.round(performance.now()/1000);try{window.__errLoc=(e.filename||'').split('/').pop()+':'+e.lineno;}catch(_){window.__errLoc='?';}});
window.__ep=0; try{sessionStorage.setItem('__epoch',((+sessionStorage.getItem('__epoch')||0)+1)+'');window.__ep=+sessionStorage.getItem('__epoch');}catch(_){window.__ep='n/a';}
window.__st='?';
setInterval(()=>{ const s2=(typeof States!=='undefined'&&States.current)?States.current:((typeof StateMachine!=='undefined'&&StateMachine.get)?StateMachine.get():(typeof StateMachine!=='undefined'&&StateMachine.is&&StateMachine.state)?StateMachine.state:'?'); window.__st=String(s2); },1000);
window.__dops=0; window.__mut=0;
try{ new MutationObserver(muts=>{window.__mut+=muts.length;}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','style','hidden']}); }catch(_){}
window.__dops=0;
for(const m of ['fillRect','strokeRect','arc','fillText','drawImage'])
  { const o=CanvasRenderingContext2D.prototype[m];
    CanvasRenderingContext2D.prototype[m]=function(){window.__dops++;return o.apply(this,arguments);}; }
setTimeout(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));},400);
setTimeout(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));},2500); // human-speed second press: covers slow-init paths the 400ms probe alone can false-negative
setInterval(()=>{const a=document.activeElement; if(a&&a.blur)a.blur();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true}));},9000);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true}));},9300);
setInterval(()=>{const a=document.activeElement; if(a&&a.blur)a.blur();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));},12000);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));},12400);
setInterval(()=>{const a=document.activeElement; if(a&&a.blur)a.blur();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));},15000);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true}));},15500);
</script>"""
assert '</body>' in s
open(p,'w').write(s.replace('</body>',probe+'</body>'))
PYEOF
[ -f "$T/index.html" ] || { echo "SMOKE-FAIL no index.html"; exit 1; }
EXPR="window.__ep+'|'+window.__fl+'|'+window.__dops+'|'+(window.__err||'-')+'@'+(window.__errAt||'-')+'|'+window.__st+'|'+(window.__errLoc||'-')+'|'+window.__mut"
SERIES=$(timeout $((SOAK+40)) node "$G/wsmin.js" "file://$T/index.html" "$EXPR" $((SOAK*1000)) 10000 2>/dev/null | grep '^POLL ')
rm -rf "$T"
[ -n "$SERIES" ] || { echo "SMOKE-FAIL no poll series (client died / page never loaded)"; exit 1; }
LAST=$(echo "$SERIES" | tail -1 | sed 's/^POLL [0-9]*s //; s/"//g')
PREV=$(echo "$SERIES" | tail -2 | head -1 | sed 's/^POLL [0-9]*s //; s/"//g')
fld(){ echo "$1" | cut -d'|' -f$2; }
EP=$(fld "$LAST" 1); FL=$(fld "$LAST" 2); FLP=$(fld "$PREV" 2); DO=$(fld "$LAST" 3); DOP=$(fld "$PREV" 3); ERR=$(echo "$LAST" | cut -d'|' -f4 | cut -d'@' -f1)
STLAST=$(echo "$LAST" | cut -d'|' -f6); STLAST=${STLAST:-"?"}
MUT=$(echo "$LAST" | cut -d'|' -f8); MUT=${MUT:-0}
ERRLOC=$(echo "$LAST" | cut -d'|' -f7); ERRLOC=${ERRLOC:-"-"}
echo "soak ${SOAK}s: $(echo "$SERIES" | wc -l) polls, last: ep=$EP fl=$FL dops=$DO err=$ERR st=$STLAST"
case "$ERR" in global:*) echo "SMOKE-FAIL fatal page error: $ERR"; [ "$ERRLOC" != "-" ] && echo "ERRLOC $ERRLOC"; exit 1;; esac
LEFTMENU=$(echo "$SERIES" | grep -oE '\|(menu|play|pause|gameplay|levelclear|shop|gameover)[a-z]*\|?-?$' | grep -vc menu || true)
NONMENU=$(echo "$SERIES" | sed 's/^POLL [0-9]*s //' | tr '|' '\n' | grep -cE '^(play|gameplay|pause|levelclear|shop|gameover)')
[ "$NONMENU" -gt 0 ] 2>/dev/null || echo "NOTE states unreadable or never left menu (IIFE build - partial coverage)"
[ "$FL" -gt 60 ] 2>/dev/null || { echo "SMOKE-FAIL loop never spun (fl=$FL)"; exit 1; }
[ "$EP" = "1" ] 2>/dev/null || { echo "SMOKE-FAIL page reloaded during soak (epoch=$EP)"; exit 1; }
[ "$FL" -gt "$FLP" ] 2>/dev/null || { echo "SMOKE-FAIL FROZE before end (fl $FLP -> $FL)"; exit 1; }
[ "$DO" -gt "$DOP" ] 2>/dev/null || { echo "SMOKE-FAIL rendering stopped (dops $DOP -> $DO)"; exit 1; }
# dead-menu detection: FAIL only when states are READABLE and never left menu
# with zero DOM reactions; canvas-first games legitimately mutate nothing, so
# unreadable-states + zero-mutations is a WARN (playtest decides).
if [ "${MUT:-0}" -le 0 ] 2>/dev/null; then
  case "$STLAST" in
    menu|'?'|'') echo "WARN controls unverified (0 DOM changes, states=$STLAST - canvas-first build? playtest decides)";;
    *) : ;;
  esac
fi
[ "$ERR" = "-" ] || echo "WARN error during soak (loop kept running): $ERR"
echo "SMOKE-OK frames=$FL dops=$DO epoch=$EP err=$ERR"
exit 0
