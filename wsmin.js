// minimal raw-WS CDP poller: prints every timer tick, frame, ping, close, error.
// usage: node wsmin.js <url> <expr> <total-ms> <poll-ms>
const http=require('http'),crypto=require('crypto'),{spawn}=require('child_process');
const URLP=process.argv[2], EXPR=process.argv[3], TOT=+process.argv[4], POLL=+process.argv[5];
const port=10000+(process.pid%20000);
const chrome=spawn('chromium',['--headless=new','--disable-gpu','--no-sandbox','--user-data-dir=/tmp/wsmin-'+port,'--remote-debugging-port='+port,'about:blank'],{detached:true,stdio:'ignore'});
const get=(p)=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function encodeFrame(s){const p=Buffer.from(s);let h;
  if(p.length<126){h=Buffer.from([0x81,0x80|p.length]);}
  else if(p.length<65536){h=Buffer.from([0x81,0x80|126,p.length>>8,p.length&255]);}
  else {h=Buffer.alloc(10);h[0]=0x81;h[1]=0x80|127;h.writeBigUInt64BE(BigInt(p.length),2);}
  const mask=crypto.randomBytes(4);const m=Buffer.from(p);for(let i=0;i<p.length;i++)m[i]^=mask[i&3];
  return Buffer.concat([h,mask,m]);}
(async()=>{
  let targets; for(let i=0;i<40;i++){try{targets=await get('/json/list');if(targets.length)break;}catch(e){} await sleep(250);}
  const wsUrl=(targets.find(t=>t.type==='page'&&t.url==='about:blank')||targets.find(t=>t.type==='page')).webSocketDebuggerUrl;
  const u=new URL(wsUrl);
  const net=require('net'); const sock=net.connect(+u.port,'127.0.0.1');
  sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await sleep(500); sock.resume(); sock.read();
  let buf=Buffer.alloc(0), nextId=1; const pending={};
  const send=(method,params={})=>{const id=nextId++;pending[id]=(r)=>r;sock.write(encodeFrame(JSON.stringify({id,method,params})));return new Promise(r=>pending[id]=r);};
  sock.on('data',d=>{ buf=Buffer.concat([buf,d]);
    while(true){ if(buf.length<2)break;
      const fin=buf[0]&0x80, opcode=buf[0]&0x0f;
      let len=buf[1]&0x7f, off=2;
      if(len===126){ if(buf.length<4)break; len=buf.readUInt16BE(2); off=4; }
      else if(len===127){ if(buf.length<10)break; len=Number(buf.readBigUInt64BE(2)); off=10; }
      if(buf.length<off+len)break;
      const payload=buf.subarray(off,off+len); buf=buf.subarray(off+len);
      if(opcode===0x9){ console.log('TICK-ping'); sock.write(Buffer.concat([Buffer.from([0x8A,payload.length]),payload])); }
      else if(opcode===0x8){ console.log('TICK-close'); }
      else if(opcode===0x1){ const m=JSON.parse(payload.toString()); if(m.id&&pending[m.id]){pending[m.id](m);delete pending[m.id];} }
    } });
  sock.on('close',()=>console.log('SOCK-CLOSE')); sock.on('error',e=>console.log('SOCK-ERR',e.message));
  await sleep(300);
  await send('Page.enable');
  await send('Page.navigate',{url:URLP});
  for(let i=0;i<60;i++){ await sleep(250); const r=await send('Runtime.evaluate',{expression:'document.readyState',returnByValue:true}); if(r.result.result.value==='complete')break; }
  console.log('READY');
  const t0=Date.now();
  while(Date.now()-t0<TOT){
    await sleep(POLL);
    const el=((Date.now()-t0)/1000).toFixed(0);
    console.log('TICK '+el+'s send');
    const r=await send('Runtime.evaluate',{expression:EXPR,returnByValue:true});
    console.log('POLL '+el+'s '+(r&&r.result&&r.result.result&&r.result.result.value));
  }
  console.log('DONE');
  try{process.kill(-chrome.pid,'SIGKILL');}catch(e){}
  process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);try{chrome.kill();}catch(_){}process.exit(1);});
