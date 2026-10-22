'use strict';
/**
 * 学生成绩管理系统 —— 后端服务
 *
 * 零依赖：只用 Node.js 内置模块（http / fs / path / crypto / node:sqlite）。
 * 启动：node server.js        默认端口 8080，监听 0.0.0.0（局域网可访问）
 * 环境变量：PORT=8080  ADMIN_PASSWORD=admin123
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- 常量配置
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const DEFAULT_PASSWORD = '123456';          // 新增/注册学生的初始密码
const ADMIN_USERNAME = 'admin';              // 管理员账号
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME = '管理员';

const SUBJECTS = ['chinese', 'math', 'english'];
const SUBJECT_LABELS = { chinese: '语文', math: '数学', english: '英语' };

const SESSION_DAYS = 7;       // 登录状态有效期
const MAX_LOGS = 200;         // 登录记录最多保留条数
const PBKDF2_ITER = 120000;   // 密码哈希迭代次数

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'scores.db');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------------------------------------------------------------- 数据库
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    chinese    REAL NOT NULL DEFAULT 0,
    math       REAL NOT NULL DEFAULT 0,
    english    REAL NOT NULL DEFAULT 0,
    password   TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL,
    name       TEXT NOT NULL,
    student_id TEXT,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    name     TEXT,
    role     TEXT,
    time     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// 管理员密码：首次启动时写入哈希，之后可用环境变量 ADMIN_PASSWORD 重置
(function initAdmin() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
  if (!row) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('admin_password', hashPassword(ADMIN_PASSWORD));
    console.log('已初始化管理员账号：%s（密码取自环境变量或默认值）', ADMIN_USERNAME);
  }
})();

// ---------------------------------------------------------------- 密码哈希
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(plain), salt, PBKDF2_ITER, 32, 'sha256').toString('hex');
  return `pbkdf2$${PBKDF2_ITER}$${salt}$${hash}`;
}

function verifyPassword(plain, stored) {
  try {
    const [scheme, iter, salt, hash] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const calc = crypto.pbkdf2Sync(String(plain), salt, Number(iter), 32, 'sha256').toString('hex');
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 登录限流
// 同一用户名连续失败 5 次，锁定 60 秒（内存计数，重启即清零）
const loginFails = new Map();
const FAIL_LIMIT = 5;
const FAIL_WINDOW_MS = 60 * 1000;

function isLocked(username) {
  const rec = loginFails.get(username);
  if (!rec) return false;
  if (Date.now() - rec.first > FAIL_WINDOW_MS) {
    loginFails.delete(username);
    return false;
  }
  return rec.count >= FAIL_LIMIT;
}

function markFail(username) {
  const rec = loginFails.get(username);
  if (!rec || Date.now() - rec.first > FAIL_WINDOW_MS) {
    loginFails.set(username, { count: 1, first: Date.now() });
  } else {
    rec.count += 1;
  }
}

// ---------------------------------------------------------------- 会话
function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(
    'INSERT INTO sessions (token, username, role, name, student_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(token, user.username, user.role, user.name, user.id || null, now.toISOString(), expires);
  return token;
}

function getSession(req) {
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth.trim());
  if (!m) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(m[1]);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
    return null;
  }
  return {
    token: m[1],
    username: row.username,
    role: row.role,
    name: row.name,
    id: row.student_id || undefined
  };
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

// ---------------------------------------------------------------- 数据校验
function toScore(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label}成绩必须是数字`);
  if (n < 0 || n > 100) throw new HttpError(400, `${label}成绩需在 0~100 之间`);
  return Math.round(n * 10) / 10;
}

function cleanStudentId(id) {
  const s = String(id == null ? '' : id).trim();
  if (!s) throw new HttpError(400, '请输入学号');
  if (s.length < 3) throw new HttpError(400, '学号至少 3 个字符');
  if (s.length > 20) throw new HttpError(400, '学号不能超过 20 个字符');
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]+$/.test(s)) throw new HttpError(400, '学号只能包含字母、数字、下划线或汉字');
  if (s.toLowerCase() === ADMIN_USERNAME) throw new HttpError(400, '该学号为系统保留字，请更换');
  return s;
}

function cleanName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) throw new HttpError(400, '请输入姓名');
  if (s.length > 20) throw new HttpError(400, '姓名不能超过 20 个字符');
  return s;
}

function cleanPassword(pwd, { allowEmpty }) {
  const s = String(pwd == null ? '' : pwd);
  if (allowEmpty && s === '') return null;
  if (s.trim().length < 4) throw new HttpError(400, '登录密码至少 4 位');
  if (s.length > 64) throw new HttpError(400, '登录密码过长');
  return s;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- HTTP 工具
function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new HttpError(413, '请求数据过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, '请求数据格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function requireAdmin(req) {
  const sess = getSession(req);
  if (!sess) throw new HttpError(401, '登录已过期，请重新登录');
  if (sess.role !== 'admin') throw new HttpError(403, '只有管理员可以执行该操作');
  return sess;
}

function requireStudent(req) {
  const sess = getSession(req);
  if (!sess) throw new HttpError(401, '登录已过期，请重新登录');
  if (sess.role !== 'student') throw new HttpError(403, '该操作仅限学生账号');
  return sess;
}

// 学生记录转成前端需要的结构（绝不返回 password 字段）
function publicStudent(row) {
  return {
    id: row.id,
    name: row.name,
    chinese: row.chinese,
    math: row.math,
    english: row.english,
    createdAt: row.created_at
  };
}

// 按总分排名，同分并列（1,1,3 这种）
function rankedStudents() {
  const total = (s) => s.chinese + s.math + s.english;
  const rows = db.prepare('SELECT * FROM students').all().map(publicStudent);
  rows.sort((a, b) => total(b) - total(a) || a.id.localeCompare(b.id));
  let lastTotal = null;
  let lastRank = 0;
  return rows.map((s, i) => {
    const t = Math.round(total(s) * 10) / 10;
    const rank = lastTotal !== null && t === lastTotal ? lastRank : i + 1;
    lastTotal = t;
    lastRank = rank;
    return { ...s, total: t, rank };
  });
}

function addLog(username, name, role) {
  db.prepare('INSERT INTO logs (username, name, role, time) VALUES (?, ?, ?, ?)')
    .run(username, name, role, new Date().toISOString());
  // 只保留最近 MAX_LOGS 条
  db.prepare(
    'DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)'
  ).run(MAX_LOGS);
}

// ---------------------------------------------------------------- 静态文件
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 禁止访问');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 页面不存在');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

// ---------------------------------------------------------------- 路由
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  if (!pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      throw new HttpError(405, '不支持的方法');
    }
    return serveStatic(res, pathname);
  }

  // ---------------- 健康检查
  if (pathname === '/api/health' && method === 'GET') {
    return send(res, 200, { ok: true, time: new Date().toISOString() });
  }

  // ---------------- 登录
  if (pathname === '/api/login' && method === 'POST') {
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    if (!username || !password) throw new HttpError(400, '请输入学号和密码');
    if (isLocked(username)) throw new HttpError(429, '尝试次数过多，请 1 分钟后再试');

    if (username.toLowerCase() === ADMIN_USERNAME) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
      if (!verifyPassword(password, row.value)) {
        markFail(username);
        throw new HttpError(401, '管理员密码错误，请重试');
      }
      loginFails.delete(username);
      const user = { role: 'admin', username: ADMIN_USERNAME, name: ADMIN_NAME };
      const token = createSession(user);
      addLog(ADMIN_USERNAME, ADMIN_NAME, 'admin');
      return send(res, 200, { token, user });
    }

    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(username);
    if (!row || !verifyPassword(password, row.password)) {
      markFail(username);
      throw new HttpError(401, '学号或密码错误，请重试');
    }
    loginFails.delete(username);
    const user = { role: 'student', username: row.id, name: row.name, id: row.id };
    const token = createSession(user);
    addLog(row.id, row.name, 'student');
    return send(res, 200, { token, user });
  }

  // ---------------- 注册（学生自助注册，成绩为 0）
  if (pathname === '/api/register' && method === 'POST') {
    const body = await readJson(req);
    const id = cleanStudentId(body.id);
    const name = cleanName(body.name);
    if (db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) {
      throw new HttpError(409, '该学号已被注册，请直接登录或更换学号');
    }
    db.prepare(
      'INSERT INTO students (id, name, chinese, math, english, password, created_at) VALUES (?, ?, 0, 0, 0, ?, ?)'
    ).run(id, name, hashPassword(DEFAULT_PASSWORD), new Date().toISOString());
    return send(res, 200, { ok: true, student: { id, name } });
  }

  // ---------------- 会话校验（刷新页面时恢复登录）
  if (pathname === '/api/session' && method === 'GET') {
    const sess = getSession(req);
    if (!sess) throw new HttpError(401, '登录已过期，请重新登录');
    return send(res, 200, {
      user: { role: sess.role, username: sess.username, name: sess.name, id: sess.id }
    });
  }

  // ---------------- 退出登录
  if (pathname === '/api/logout' && method === 'POST') {
    const sess = getSession(req);
    if (sess) db.prepare('DELETE FROM sessions WHERE token = ?').run(sess.token);
    return send(res, 200, { ok: true });
  }

  // ---------------- 学生列表（管理员）
  if (pathname === '/api/students' && method === 'GET') {
    requireAdmin(req);
    return send(res, 200, { students: rankedStudents() });
  }

  // ---------------- 新增学生（管理员）
  if (pathname === '/api/students' && method === 'POST') {
    requireAdmin(req);
    const body = await readJson(req);
    const id = cleanStudentId(body.id);
    const name = cleanName(body.name);
    const scores = {};
    for (const k of SUBJECTS) scores[k] = toScore(body[k], SUBJECT_LABELS[k]);
    if (db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) {
      throw new HttpError(409, `学号 ${id} 已存在，请更换`);
    }
    const pwd = cleanPassword(body.password, { allowEmpty: true }) || DEFAULT_PASSWORD;
    db.prepare(
      'INSERT INTO students (id, name, chinese, math, english, password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, scores.chinese, scores.math, scores.english, hashPassword(pwd), new Date().toISOString());
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    return send(res, 200, { student: publicStudent(row), password: pwd });
  }

  // ---------------- 修改 / 删除单个学生（管理员）
  const studentMatch = /^\/api\/students\/([^/]+)$/.exec(pathname);
  if (studentMatch) {
    requireAdmin(req);
    const id = decodeURIComponent(studentMatch[1]);
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, '该学生不存在');

    if (method === 'GET') {
      return send(res, 200, { student: publicStudent(row) });
    }

    if (method === 'PUT') {
      const body = await readJson(req);
      const newId = body.id == null ? id : cleanStudentId(body.id);
      const name = cleanName(body.name);
      const scores = {};
      for (const k of SUBJECTS) scores[k] = toScore(body[k], SUBJECT_LABELS[k]);
      if (newId !== id && db.prepare('SELECT 1 FROM students WHERE id = ?').get(newId)) {
        throw new HttpError(409, `学号 ${newId} 已被占用`);
      }
      const pwd = cleanPassword(body.password, { allowEmpty: true });
      const sql = pwd
        ? 'UPDATE students SET id = ?, name = ?, chinese = ?, math = ?, english = ?, password = ? WHERE id = ?'
        : 'UPDATE students SET id = ?, name = ?, chinese = ?, math = ?, english = ? WHERE id = ?';
      const params = pwd
        ? [newId, name, scores.chinese, scores.math, scores.english, hashPassword(pwd), id]
        : [newId, name, scores.chinese, scores.math, scores.english, id];
      db.prepare(sql).run(...params);
      // 学号变了，旧会话失效
      if (newId !== id) db.prepare('DELETE FROM sessions WHERE student_id = ?').run(id);
      const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(newId);
      return send(res, 200, { student: publicStudent(updated) });
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM students WHERE id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE student_id = ?').run(id);
      return send(res, 200, { ok: true });
    }

    throw new HttpError(405, '不支持的方法');
  }

  // ---------------- 学生查看自己的成绩
  if (pathname === '/api/me' && method === 'GET') {
    const sess = requireStudent(req);
    const all = rankedStudents();
    const me = all.find((s) => s.id === sess.id);
    if (!me) throw new HttpError(404, '账号信息已失效，请重新登录');
    return send(res, 200, { student: me, rank: me.rank, total: all.length });
  }

  // ---------------- 登录记录（管理员）
  if (pathname === '/api/logs' && method === 'GET') {
    requireAdmin(req);
    const logs = db.prepare('SELECT username, name, role, time FROM logs ORDER BY id DESC LIMIT ?').all(MAX_LOGS);
    return send(res, 200, { logs });
  }

  if (pathname === '/api/logs' && method === 'DELETE') {
    requireAdmin(req);
    db.exec('DELETE FROM logs');
    return send(res, 200, { ok: true });
  }

  // ---------------- 修改自己的密码
  if (pathname === '/api/password' && method === 'POST') {
    const sess = getSession(req);
    if (!sess) throw new HttpError(401, '登录已过期，请重新登录');
    const body = await readJson(req);
    const oldPwd = String(body.oldPassword || '');
    const newPwd = cleanPassword(body.newPassword, { allowEmpty: false });
    if (sess.role === 'admin') {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
      if (!verifyPassword(oldPwd, row.value)) throw new HttpError(401, '原密码错误');
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(hashPassword(newPwd), 'admin_password');
    } else {
      const row = db.prepare('SELECT * FROM students WHERE id = ?').get(sess.id);
      if (!row || !verifyPassword(oldPwd, row.password)) throw new HttpError(401, '原密码错误');
      db.prepare('UPDATE students SET password = ? WHERE id = ?').run(hashPassword(newPwd), sess.id);
      db.prepare('DELETE FROM sessions WHERE student_id = ? AND token <> ?').run(sess.id, sess.token);
    }
    return send(res, 200, { ok: true });
  }

  throw new HttpError(404, '接口不存在');
}

// ---------------------------------------------------------------- 启动
const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[错误]', req.method, req.url, err);
    if (!res.headersSent) {
      send(res, status, { error: err.message || '服务器内部错误' });
    } else {
      res.end();
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用。可以换个端口启动：set PORT=3001 && node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  console.log('\n==================================================');
  console.log('  学生成绩管理系统 · 后端已启动');
  console.log('==================================================');
  console.log(`  本机访问：http://localhost:${PORT}/`);
  ips.forEach((ip) => console.log(`  局域网访问：http://${ip}:${PORT}/`));
  console.log(`  数据库文件：${DB_FILE}`);
  console.log(`  管理员账号：${ADMIN_USERNAME}`);
  console.log('  按 Ctrl+C 停止服务');
  console.log('==================================================\n');
  if (ips.length === 0) {
    console.log('提示：没有检测到局域网地址，检查是否已连接网络。\n');
  }
});
