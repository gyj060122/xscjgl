// 浏览器端到端测试：需要先启动 Edge 无头模式（--remote-debugging-port=9222）
// node tools/e2e.js
const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8080/';
const SHOT_DIR = path.join(__dirname, '..', 'docs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(CDP + '/json/list')).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('找不到可用的浏览器页面');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const waiting = new Map();
  const consoleErrors = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    }
  };

  function send(method, params) {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    return new Promise((resolve, reject) => waiting.set(mid, { resolve, reject }));
  }

  async function evalJs(expression) {
    const r = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async function waitFor(expression, timeoutMs = 6000, label = expression) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await evalJs(expression)) return true; } catch (e) { /* 页面可能正在跳转 */ }
      await sleep(120);
    }
    throw new Error('等待超时：' + label);
  }

  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, name);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`  shot  ${file}`);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('== 打开页面 ==');
  await send('Page.navigate', { url: APP });
  await waitFor('document.readyState === "complete" && typeof window.__editStudent === "function"', 10000, '页面脚本就绪');
  check('页面加载并执行 app.js', true);
  check('未登录时显示登录页', await evalJs('getComputedStyle(document.getElementById("loginPage")).display !== "none"'));
  await shot('01-login.png');

  console.log('\n== 管理员登录 ==');
  await evalJs(`(function(){
    document.getElementById('login-user').value = 'admin';
    document.getElementById('login-pass').value = 'admin123';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
  await waitFor('document.getElementById("appPage").style.display === "block"', 8000, '进入主界面');
  check('登录后进入主界面', true);
  check('显示管理员身份', (await evalJs('document.getElementById("user-role").textContent')) === '管理员');

  console.log('\n== 录入学生 ==');
  await evalJs(`(function(){
    document.getElementById('inp-id').value = '2024999';
    document.getElementById('inp-name').value = '测试生';
    document.getElementById('inp-chinese').value = '88';
    document.getElementById('inp-math').value = '92';
    document.getElementById('inp-english').value = '76';
    document.getElementById('btn-add').click();
    return true;
  })()`);
  await waitFor('document.getElementById("tbody").textContent.includes("测试生")', 8000, '表格出现新学生');
  const rowText = await evalJs('document.getElementById("tbody").textContent.replace(/\\s+/g," ").trim()');
  check('表格显示新学生', rowText.includes('测试生') && rowText.includes('2024999'), rowText);
  check('总分计算正确 (88+92+76=256)', rowText.includes('256'), rowText);
  check('统计卡片已渲染', (await evalJs('document.getElementById("stats").children.length')) > 0);

  const rank = await evalJs('document.querySelector("#tbody tr .rank").textContent.trim()');
  check('排名显示为第 1', rank === '1', rank);
  await shot('02-admin.png');

  console.log('\n== 学生查看自己的成绩 ==');
  await evalJs('window.confirm = () => true; true');
  await evalJs('document.getElementById("btnLogout").click(); true');
  await waitFor('getComputedStyle(document.getElementById("loginPage")).display !== "none"', 5000, '回到登录页');

  await evalJs(`(function(){
    document.getElementById('login-user').value = '2024999';
    document.getElementById('login-pass').value = '123456';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
  await waitFor('document.getElementById("appPage").style.display === "block"', 8000, '学生进入主界面');
  check('学生登录成功', true);
  check('学生看到「我的成绩」面板', await evalJs('getComputedStyle(document.getElementById("myScorePanel")).display !== "none"'));
  check('管理员面板对学生隐藏', await evalJs('getComputedStyle(document.getElementById("entryPanel")).display === "none"'));
  const meta = await evalJs('document.getElementById("my-meta").textContent');
  check('显示学号与班级排名', meta.includes('2024999') && meta.includes('全班第 1 名'), meta);
  const subjects = await evalJs('document.getElementById("my-subjects").textContent.replace(/\\s+/g," ").trim()');
  check('三科成绩正确', subjects.includes('88') && subjects.includes('92') && subjects.includes('76'), subjects);
  await shot('03-student.png');

  console.log('\n== 刷新后保持登录（会话恢复）==');
  await send('Page.navigate', { url: APP });
  await waitFor('document.readyState === "complete" && typeof window.__editStudent === "function"', 10000, '重新加载');
  await waitFor('document.getElementById("appPage").style.display === "block"', 8000, '恢复会话');
  check('刷新后仍保持登录', true);
  check('恢复后仍是学生视图', await evalJs('getComputedStyle(document.getElementById("myScorePanel")).display !== "none"'));

  console.log('\n== 错密码提示 ==');
  await evalJs('window.confirm = () => true; true');
  await evalJs('document.getElementById("btnLogout").click(); true');
  await waitFor('getComputedStyle(document.getElementById("loginPage")).display !== "none"', 5000, '回到登录页');
  await evalJs(`(function(){
    document.getElementById('login-user').value = '2024999';
    document.getElementById('login-pass').value = '999999';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
  await waitFor('document.getElementById("login-error").textContent.length > 0', 8000, '显示错误提示');
  const err = await evalJs('document.getElementById("login-error").textContent');
  check('错误密码有提示', err.includes('错误') || err.includes('过多'), err);

  console.log('\n== 清理测试数据 ==');
  const token = await evalJs('localStorage.getItem("xscjgl_token_v1")');
  const adminLogin = await (await fetch('http://127.0.0.1:8080/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })).json();
  const del = await fetch('http://127.0.0.1:8080/api/students/2024999', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + adminLogin.token }
  });
  check('删除测试学生', del.status === 200, del.status);
  void token;

  check('页面运行期间无 JS 报错', consoleErrors.length === 0, consoleErrors);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  ws.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nE2E 失败：', e.message);
  process.exit(1);
});
