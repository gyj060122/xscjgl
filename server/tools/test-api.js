// 后端接口自测：node tools/test-api.js
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' -> ' + JSON.stringify(extra) : ''}`); }
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

(async () => {
  console.log('== 静态页面 ==');
  const page = await call('GET', '/');
  check('GET / 返回 200', page.status === 200);
  check('页面包含标题', String(page.data).includes('学生成绩管理系统'));
  const js = await call('GET', '/app.js');
  check('GET /app.js 返回 200', js.status === 200);
  const trav = await call('GET', '/../server.js');
  check('路径穿越被拦截', trav.status === 403 || trav.status === 404, trav.status);

  console.log('\n== 鉴权 ==');
  const bad = await call('POST', '/api/login', { body: { username: 'admin', password: 'wrong' } });
  check('管理员错误密码被拒', bad.status === 401, bad);
  const noAuth = await call('GET', '/api/students');
  check('未登录访问名单被拒', noAuth.status === 401, noAuth.status);

  const login = await call('POST', '/api/login', { body: { username: 'admin', password: 'admin123' } });
  check('管理员登录成功', login.status === 200 && !!login.data.token, login);
  const adminToken = login.data.token;
  check('返回角色为 admin', login.data.user.role === 'admin');

  // 清掉历史登录记录，让后面的日志断言是确定值
  await call('DELETE', '/api/logs', { token: login.data.token });

  console.log('\n== 增删改查 ==');
  const created = await call('POST', '/api/students', {
    token: adminToken,
    body: { id: '2024001', name: '张三', chinese: 90, math: 85.5, english: 88 }
  });
  check('新增学生成功', created.status === 200, created);
  check('返回初始密码', created.data.password === '123456', created.data);

  const dup = await call('POST', '/api/students', {
    token: adminToken,
    body: { id: '2024001', name: '重复', chinese: 1, math: 1, english: 1 }
  });
  check('重复学号被拒 409', dup.status === 409, dup.status);

  const badScore = await call('POST', '/api/students', {
    token: adminToken,
    body: { id: '2024099', name: '越界', chinese: 101, math: 1, english: 1 }
  });
  check('成绩越界被拒 400', badScore.status === 400, badScore.status);

  await call('POST', '/api/students', {
    token: adminToken,
    body: { id: '2024002', name: '李四', chinese: 70, math: 75, english: 80 }
  });

  const list = await call('GET', '/api/students', { token: adminToken });
  check('名单返回 2 条', list.data.students.length === 2, list.data.students.length);
  check('张三排名第 1', list.data.students[0].name === '张三' && list.data.students[0].rank === 1, list.data.students[0]);
  check('列表不含密码字段', !('password' in list.data.students[0]), Object.keys(list.data.students[0]));

  const upd = await call('PUT', '/api/students/2024002', {
    token: adminToken,
    body: { id: '2024002', name: '李四四', chinese: 99, math: 99, english: 99 }
  });
  check('修改学生成功', upd.status === 200 && upd.data.student.name === '李四四', upd);

  const afterUpd = await call('GET', '/api/students', { token: adminToken });
  check('改分后排名变化', afterUpd.data.students[0].name === '李四四', afterUpd.data.students[0].name);

  console.log('\n== 导出成绩表 ==');
  const csvRes = await fetch(BASE + '/api/export', { headers: { Authorization: 'Bearer ' + adminToken } });
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  const csvText = csvBuf.toString('utf8');   // .text() 会自动去掉 BOM，所以这里读字节
  check('管理员可导出 CSV', csvRes.status === 200, csvRes.status);
  check('Content-Type 为 text/csv', String(csvRes.headers.get('content-type')).includes('text/csv'), csvRes.headers.get('content-type'));
  check('带 UTF-8 BOM（Excel 不乱码）',
    csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF,
    [...csvBuf.subarray(0, 3)]);
  check('表头正确', csvText.includes('排名,学号,姓名,语文,数学,英语,总分,平均分'));
  check('包含学生数据', csvText.includes('张三') && csvText.includes('2024001'));
  check('行数 = 表头 + 2 名学生', csvText.trim().split(/\r?\n/).length === 3, csvText.trim().split(/\r?\n/).length);
  check('响应是附件下载', String(csvRes.headers.get('content-disposition')).includes('attachment'));
  check('文件名带日期', /成绩表_\d{8}\.csv/.test(decodeURIComponent(csvRes.headers.get('content-disposition'))));

  console.log('\n== 学生账号 ==');
  const reg = await call('POST', '/api/register', { body: { id: '2024003', name: '王五' } });
  check('学生注册成功', reg.status === 200, reg);
  const regDup = await call('POST', '/api/register', { body: { id: '2024003', name: '王五' } });
  check('重复注册被拒 409', regDup.status === 409, regDup.status);
  const reserved = await call('POST', '/api/register', { body: { id: 'admin', name: '冒充' } });
  check('保留字学号被拒', reserved.status === 400, reserved.status);

  const sLogin = await call('POST', '/api/login', { body: { username: '2024003', password: '123456' } });
  check('学生用初始密码登录', sLogin.status === 200, sLogin);
  const stuToken = sLogin.data.token;

  const me = await call('GET', '/api/me', { token: stuToken });
  check('学生查到自己的成绩', me.status === 200 && me.data.student.id === '2024003', me);
  check('学生看到全班人数', me.data.total === 3, me.data.total);

  const forbidden = await call('GET', '/api/students', { token: stuToken });
  check('学生访问管理员接口被拒 403', forbidden.status === 403, forbidden.status);

  const selfUpgrade = await call('POST', '/api/students', {
    token: stuToken, body: { id: '2024099', name: '黑客', chinese: 100, math: 100, english: 100 }
  });
  check('学生无法自己加学生', selfUpgrade.status === 403, selfUpgrade.status);

  const csvStudent = await fetch(BASE + '/api/export', { headers: { Authorization: 'Bearer ' + stuToken } });
  check('学生不能导出全班成绩', csvStudent.status === 403, csvStudent.status);

  console.log('\n== 会话与日志 ==');
  const sess = await call('GET', '/api/session', { token: stuToken });
  check('会话校验通过', sess.status === 200 && sess.data.user.id === '2024003', sess);

  const logs = await call('GET', '/api/logs', { token: adminToken });
  check('登录记录已写入（开始清空过，只剩学生这一条）', logs.data.logs.length === 1, logs.data.logs.length);
  check('日志不含密码', JSON.stringify(logs.data.logs).indexOf('123456') === -1);

  console.log('\n== 删除与退出 ==');
  const del = await call('DELETE', '/api/students/2024003', { token: adminToken });
  check('删除学生成功', del.status === 200, del);
  const meGone = await call('GET', '/api/me', { token: stuToken });
  check('被删学生会话失效', meGone.status === 401 || meGone.status === 404, meGone.status);

  const out = await call('POST', '/api/logout', { token: adminToken });
  check('退出登录成功', out.status === 200, out);
  const afterOut = await call('GET', '/api/students', { token: adminToken });
  check('退出后令牌失效', afterOut.status === 401, afterOut.status);

  console.log('\n== 清理 ==');
  // 前面的退出登录已让 adminToken 失效，这里重新登录拿一个新令牌
  const relogin = await call('POST', '/api/login', { body: { username: 'admin', password: 'admin123' } });
  const cleanToken = relogin.data.token;
  for (const id of ['2024001', '2024002']) {
    await call('DELETE', '/api/students/' + id, { token: cleanToken });
  }
  const left = await call('GET', '/api/students', { token: cleanToken });
  check('测试数据已清空', left.data.students.length === 0, left.data.students.length);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
