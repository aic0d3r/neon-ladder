// minimal CDP client: load page, wait, eval expression, print result
const http=require('http'),crypto=require('crypto'),{spawn}=require('child_process');
const URL=process.argv[2], EXPR=process.argv[3], WAIT=parseInt(process.argv[4]||'5000');
const port=10000+(process.pid%20000);
const prof=require('fs').mkdtempSync(require('os').tmpdir()+'/cdp-');
const chrome=spawn('chromium',['--headless=new','--disable-gpu','--no-sandbox','--user-data-dir='+prof,'--disable-extensions','--no-first-run','--no-default-browser-check','--allow-file-access-from-files','--remote-debugging-port='+port,'about:blank'],{detached:true,stdio:'ignore'});
const get=(p)=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let targets; for(let i=0;i<40;i++){try{targets=await get('/json/list');if(targets.length)break;}catch(e){} await sleep(250);}
  const wsUrl=(targets.find(t=>t.type==='page'&&t.url==='about:blank')||targets.find(t=>t.type==='page')).webSocketDebuggerUrl;
  const key=crypto.randomBytes(16).toString('base64');
  const net=require('net'); const u=require('url').parse(wsUrl);
  const sock=net.connect(parseInt(u.port),'127.0.0.1');
  sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await sleep(500); sock.resume(); sock.read(); // consume handshake
  let buf=Buffer.alloc(0), nextId=1; const pending={};
  const send=(method,params={})=>{const id=nextId++;pending[id]=(r)=>r; sock.write(encodeFrame(JSON.stringify({id,method,params}))); return new Promise((res,rej)=>{ pending[id]=(r)=>res(r); if(SOCK_DEAD) rej(new Error('SOCK-DEAD')); const iv=setInterval(()=>{ if(SOCK_DEAD){clearInterval(iv);rej(new Error('SOCK-DEAD'));} },250); const o=pending[id]; pending[id]=(r)=>{clearInterval(iv);o(r);}; });};
  function encodeFrame(s){const p=Buffer.from(s);let h; if(p.length<126){h=Buffer.from([0x81,0x80|p.length]);} else {h=Buffer.from([0x81,0x80|126,p.length>>8,p.length&255]);}
    const mask=crypto.randomBytes(4); const masked=Buffer.from(p); for(let i=0;i<p.length;i++)masked[i]^=mask[i&3];
    const out=Buffer.concat([h,mask,masked]); return out;}
  function decodeFrames(){ while(buf.length>=2){ let len=buf[1]&0x7f,off=2; if(len===126){len=buf.readUInt16BE(2);off=4;} else if(len===127){len=Number(buf.readBigUInt64BE(2));off=10;}
    if(buf.length<off+len)break; const payload=buf.subarray(off,off+len).toString(); buf=buf.subarray(off+len);
    try{const m=JSON.parse(payload); if(m.id&&pending[m.id]){pending[m.id](m);delete pending[m.id];} }catch(e){} } }
  let frag=Buffer.alloc(0); let SOCK_DEAD=false;
  sock.on('data',d=>{ buf=Buffer.concat([buf,d]);
    while(true){ if(buf.length<2)break;
      const fin=buf[0]&0x80, opcode=buf[0]&0x0f, masked=buf[1]&0x80;
      let len=buf[1]&0x7f, off=2;
      if(len===126){ if(buf.length<4)break; len=buf.readUInt16BE(2); off=4; }
      else if(len===127){ if(buf.length<10)break; len=Number(buf.readBigUInt64BE(2)); off=10; }
      if(masked){ off+=4; }
      if(buf.length<off+len)break;
      const payload=buf.subarray(off,off+len); buf=buf.subarray(off+len);
      if(opcode===0x0){ frag=Buffer.concat([frag,payload]); if(fin){handleMsg(frag.toString());frag=Buffer.alloc(0);} }
      else if(opcode===0x1){ if(fin){handleMsg(payload.toString());} else {frag=payload;} }
      else if(opcode===0x9){ const hdr=Buffer.from([0x8A,payload.length]);
        sock.write(Buffer.concat([hdr,payload])); }
      else if(opcode===0x8){ SOCK_DEAD=true; }
    } });
  sock.on('close',()=>{ SOCK_DEAD=true; });
  sock.on('error',()=>{ SOCK_DEAD=true; });
  function handleMsg(txt){ try{ const m=JSON.parse(txt); if(m.id&&pending[m.id]){pending[m.id](m);delete pending[m.id];} }catch(e){} }
await sleep(300);
  await send('Page.enable');
  await send('Page.navigate',{url:URL});
  for(let i=0;i<60;i++){ await sleep(250); const r=await send('Runtime.evaluate',{expression:'document.readyState',returnByValue:true}); const v=r&&r.result&&r.result.result&&r.result.result.value; if(v==='complete') break; }
  await sleep(WAIT);
  const probe1=await send('Runtime.evaluate',{expression:'document.readyState+" | "+location.href',returnByValue:true}); console.error('PRE-EVAL:',JSON.stringify(probe1.result));
  const POLL=parseInt(process.argv[5]||'0');
  if(POLL>0){
    const t0=Date.now();
    for(let i=0;;i++){
      await sleep(POLL);
      const el=(Date.now()-t0)/1000;
      let line;
      try{
        const pr=await Promise.race([
          send('Runtime.evaluate',{expression:EXPR,returnByValue:true}),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error('EVAL-TIMEOUT')),5000))
        ]);
        const v=pr&&pr.result&&pr.result.result&&pr.result.result.value;
        line=(v!==undefined?v:JSON.stringify(pr&&pr.result));
      }catch(e){ line='DEAD('+e.message+')'; }
      console.log('POLL '+el.toFixed(0)+'s '+line);
      if(String(line).startsWith('DEAD')) break;
      if(Date.now()-t0 > (WAIT-POLL)) break;
    }
    try{process.kill(-chrome.pid,'SIGKILL')}catch(e){} try{chrome.kill('SIGKILL')}catch(e){}
    process.exit(0);
  }
  const r=await send('Runtime.evaluate',{expression:EXPR,returnByValue:true}); console.error('EXPR-RAW:',JSON.stringify(r).slice(0,400));
  console.log(JSON.stringify(r&&r.result&&r.result.result&&r.result.result.value!==undefined?r.result.result.value:(r&&r.result&&r.result.exceptionDetails?{ex:r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description}:null)));
  try{process.kill(-chrome.pid,'SIGKILL')}catch(e){} try{chrome.kill('SIGKILL')}catch(e){}
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);try{chrome.kill()}catch(_){}process.exit(1);});
