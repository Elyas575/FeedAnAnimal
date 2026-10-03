const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///C:/Users/dream4net/Desktop/FeedTheAnimalsMap/index.html';

const proc = spawn(CHROME, [
  '--headless=old', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1280,860', '--remote-debugging-port=9223',
  '--user-data-dir=' + path.join(os.tmpdir(), 'fta-cdp2'), PAGE
], { stdio: 'ignore' });

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9223, path: p }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  let targets = [];
  for (let i = 0; i < 60; i++) {
    try { targets = await getJson('/json'); if (targets.find((t) => t.url.indexOf('index.html') !== -1)) break; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  const page = targets.find((t) => t.url.indexOf('index.html') !== -1);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = {};
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
  await new Promise((r) => { ws.onopen = r; });
  function send(method, params) { return new Promise((res) => { const mid = ++id; pending[mid] = res; ws.send(JSON.stringify({ id: mid, method, params })); }); }
  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 5000));
  const expr = `(function(){
    function r(sel){var e=document.querySelector(sel);if(!e)return sel+': MISSING';var b=e.getBoundingClientRect();return sel+': x='+Math.round(b.left)+' y='+Math.round(b.top)+' w='+Math.round(b.width)+' h='+Math.round(b.height);}
    return [r('#zoom-in'),r('#zoom-out'),r('#layer-btn'),r('#park-center-btn'),r('#reset-demo-btn'),r('.fta-bn-pill'),'vh='+window.innerHeight].join('\\n');
  })()`;
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  fs.writeFileSync(path.join(os.tmpdir(), 'probe2.txt'), (res.result && res.result.result && res.result.result.value) || JSON.stringify(res));
  ws.close(); proc.kill();
  process.exit(0);
})();