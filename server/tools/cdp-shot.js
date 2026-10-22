// 通过 CDP 给指定端口上的页面截图：node tools/cdp-shot.js <port> <outfile>
const fs = require('fs');

const port = process.argv[2] || '9223';
const out = process.argv[3] || 'shot.png';

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params) => {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    return new Promise((resolve, reject) => waiting.set(mid, { resolve, reject }));
  };

  await send('Page.enable');
  const info = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({url: location.href, title: document.title, text: document.body.innerText.slice(0, 400)})',
    returnByValue: true
  });
  console.log('PAGE', info.result.value);

  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  console.log('saved', out);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
