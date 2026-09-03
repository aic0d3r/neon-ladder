#!/usr/bin/env bash
# 2-min gameplay soak probe (diagnostic). Usage: soak-probe.sh <build-dir> [secs]
set -u
B=$(readlink -f "$1"); SECS=${2:-120}
G=$(dirname "$(readlink -f "$0")")
T=$(mktemp -d /tmp/smoke.XXXX)   # gate copies are disposable; verdicts+logs go to results/
cp -r "$B/." "$T/"
python3 - "$T/index.html" "$SECS" <<'PYEOF'
import sys
p=sys.argv[1]; secs=int(sys.argv[2]); s=open(p).read()
probe="""<script>
window.__fl=0; window.__err=null; window.__errAt=null;
const _r=window.requestAnimationFrame.bind(window);
window.requestAnimationFrame=function(fn){return _r(function(t){window.__fl++;try{fn(t);}catch(e){window.__err=e.message+' @ '+(e.stack||'').split('\\n')[1];window.__errAt=Math.round(performance.now()/1000);}});};
window.addEventListener('error',e=>{if(!window.__err)window.__err='global: '+e.message;window.__errAt=Math.round(performance.now()/1000);});
window.__hist=[]; window.__st='?'; window.__dops=0;
for(const m of ['fillRect','strokeRect','arc','fillText','drawImage'])
  { const o=CanvasRenderingContext2D.prototype[m];
    CanvasRenderingContext2D.prototype[m]=function(){window.__dops++;return o.apply(this,arguments);}; }
setInterval(()=>{ window.__hist.push(Math.round(performance.now()/1000)+':'+window.__fl+':'+window.__dops+':'+window.__st+':'+((performance&&performance.memory&&performance.memory.usedJSHeapSize/1048576)||0).toFixed(0)); },5000);
setInterval(()=>{ const st=(typeof States!=='undefined')?States.current:((typeof StateMachine!=='undefined'&&StateMachine.get)?StateMachine.get():window.__st);
  window.__st=String(st); },1000);
setTimeout(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));},400);
// keep playing: paddle jiggles + occasional Space (laser/launch)
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true}));},9000);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',code:'ArrowLeft',bubbles:true}));},9300);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));},12000);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));},12400);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));},15000);
setInterval(()=>{document.dispatchEvent(new KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true}));},15500);
</script>"""
assert '</body>' in s
open(p,'w').write(s.replace('</body>',probe+'</body>'))
PYEOF
VERDICT=$(timeout $((SECS+40)) node "$G/cdp.js" "file://$T/index.html" \
  "window.__hist.join(';')+'||'+(window.__err||'-')+'@'+(window.__errAt||'-')" $((SECS+5000)) 2>/dev/null | tail -1)
rm -rf "$T"
echo "$VERDICT" | tr ';' '\n'
echo "ERR: $(echo "$VERDICT" | cut -d'|' -f3-)"
