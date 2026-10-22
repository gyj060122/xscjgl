(function () {
  'use strict';

  // ================= 配置 =================
  const API_BASE = '';                    // 与页面同源，部署到别的域名时改成完整地址
  const TOKEN_KEY = 'xscjgl_token_v1';
  const DEFAULT_PASSWORD = '123456';
  const SUBJECTS = ['chinese', 'math', 'english'];
  const SUBJECT_LABELS = { chinese: '语文', math: '数学', english: '英语' };

  // ================= 状态 =================
  let students = [];        // 管理员：全班名单（服务端带 rank / total）
  let loginLogs = [];       // 管理员：登录记录
  let myInfo = null;        // 学生：自己的成绩 + 排名
  let editingId = null;
  let currentUser = null;
  let token = null;

  const $ = (id) => document.getElementById(id);
  const inputs = {
    id: $('inp-id'), name: $('inp-name'),
    chinese: $('inp-chinese'), math: $('inp-math'), english: $('inp-english'),
    password: $('inp-password')
  };
  const tbody = $('tbody');
  const logTbody = $('log-tbody');
  const statsBox = $('stats');
  const toastEl = $('toast');
  const btnUpdate = $('btn-update');

  // ================= 工具函数 =================
  let toastTimer = null;
  function toast(msg, type) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2400);
  }

  const fmtScore = (n) => {
    const v = Math.round(n * 10) / 10;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  const totalOf = (s) => SUBJECTS.reduce((sum, k) => sum + s[k], 0);
  const avgOf   = (s) => totalOf(s) / SUBJECTS.length;

  function scoreClass(v) {
    if (v >= 85) return 'score-high';
    if (v >= 60) return 'score-mid';
    return 'score-low';
  }
  function levelOf(v) {
    if (v >= 90) return '优秀';
    if (v >= 80) return '良好';
    if (v >= 70) return '中等';
    if (v >= 60) return '及格';
    return '不及格';
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // ================= 接口调用 =================
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      });
    } catch (e) {
      throw new ApiError('无法连接服务器，请确认后端已启动', 0);
    }

    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ } }

    if (!res.ok) {
      throw new ApiError((data && data.error) || `请求失败（HTTP ${res.status}）`, res.status);
    }
    return data;
  }

  // 统一处理：401 说明登录态失效
  function handleAuthError(err) {
    if (err && err.status === 401) {
      toastWhere('登录已过期，请重新登录', 'error');
      forceLogout();
      return true;
    }
    return false;
  }

  // ================= 登录状态 =================
  function saveToken(t) {
    token = t;
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
  }
  function clearToken() {
    token = null;
    currentUser = null;
    students = [];
    loginLogs = [];
    myInfo = null;
    editingId = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  async function restoreSession() {
    try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
    if (!token) return null;
    try {
      const data = await api('/api/session');
      return data.user;
    } catch (e) {
      clearToken();
      return null;
    }
  }

  function forceLogout() {
    clearToken();
    $('appPage').style.display = 'none';
    $('loginPage').style.display = 'flex';
    showLoginCard();
    $('login-user').value = '';
    $('login-pass').value = '';
    $('login-error').textContent = '';
    resetForm();
    $('login-user').focus();
  }

  function logout() {
    const t = token;
    api('/api/logout', { method: 'POST' }).catch(() => {});
    clearToken();
    // 即使请求失败也要清掉本地状态，令其失效
    void t;
    $('appPage').style.display = 'none';
    $('loginPage').style.display = 'flex';
    showLoginCard();
    $('login-user').value = '';
    $('login-pass').value = '';
    $('login-error').textContent = '';
    resetForm();
    $('login-user').focus();
  }

  // ================= 数据加载 =================
  async function refreshStudents() {
    const data = await api('/api/students');
    students = data.students || [];
  }
  async function refreshLogs() {
    const data = await api('/api/logs');
    loginLogs = data.logs || [];
  }
  async function refreshMyInfo() {
    const data = await api('/api/me');
    myInfo = { student: data.student, rank: data.rank, total: data.total };
    students = [data.student];   // 学生只能看到自己
  }

  async function loadAllData() {
    if (!currentUser) return;
    if (currentUser.role === 'admin') {
      await refreshStudents();
      await refreshLogs();
    } else {
      await refreshMyInfo();
    }
  }

  // ================= 界面切换 =================
  function applyRoleUI() {
    const isAdmin = currentUser.role === 'admin';
    $('entryPanel').style.display = isAdmin ? '' : 'none';
    $('listPanel').style.display = isAdmin ? '' : 'none';
    $('logPanel').style.display = isAdmin ? '' : 'none';
    $('myScorePanel').style.display = isAdmin ? 'none' : '';

    $('user-name').textContent = currentUser.name;
    $('user-avatar').textContent = (currentUser.name || '?').charAt(0);
    $('user-role').textContent = isAdmin ? '管理员' : '学生';
    $('header-tip').textContent = isAdmin
      ? '支持录入、修改、删除、查询与统计分析 · 数据保存在服务器，多台设备同步'
      : '这里仅显示你自己的成绩信息，如需修改请联系老师';
  }

  async function enterApp() {
    $('loginPage').style.display = 'none';
    $('appPage').style.display = 'block';
    applyRoleUI();
    try {
      await loadAllData();
      renderAll();
    } catch (err) {
      if (handleAuthError(err)) return;
      toast(err.message || '数据加载失败', 'error');
      renderAll();
    }
  }

  function showLoginCard() {
    $('loginForm').style.display = '';
    $('registerForm').style.display = 'none';
    $('login-error').textContent = '';
    $('reg-error').textContent = '';
  }
  function showRegisterCard() {
    $('loginForm').style.display = 'none';
    $('registerForm').style.display = '';
    $('reg-error').textContent = '';
    $('reg-id').value = '';
    $('reg-name').value = '';
    $('reg-id').focus();
  }

  // ================= 表单 =================
  function readForm() {
    const id = inputs.id.value.trim();
    const name = inputs.name.value.trim();

    if (!id) { toast('请输入学号', 'error'); inputs.id.focus(); return null; }
    if (!name) { toast('请输入姓名', 'error'); inputs.name.focus(); return null; }
    if (id.toLowerCase() === 'admin') {
      toast('该学号为系统保留字，请更换', 'error'); inputs.id.focus(); return null;
    }

    const rec = { id, name };
    for (const key of SUBJECTS) {
      const raw = inputs[key].value.trim();
      if (raw === '') { toast(`请输入${SUBJECT_LABELS[key]}成绩`, 'error'); inputs[key].focus(); return null; }
      const val = Number(raw);
      if (!Number.isFinite(val)) { toast(`${SUBJECT_LABELS[key]}成绩必须是数字`, 'error'); inputs[key].focus(); return null; }
      if (val < 0 || val > 100) { toast(`${SUBJECT_LABELS[key]}成绩需在 0~100 之间`, 'error'); inputs[key].focus(); return null; }
      rec[key] = Math.round(val * 10) / 10;
    }

    const pwd = inputs.password.value.trim();
    if (pwd && pwd.length < 4) { toast('登录密码至少 4 位', 'error'); inputs.password.focus(); return null; }
    if (pwd) rec.password = pwd;
    return rec;
  }

  function fillForm(s) {
    inputs.id.value = s.id;
    inputs.name.value = s.name;
    SUBJECTS.forEach(k => { inputs[k].value = s[k]; });
    inputs.password.value = '';
    inputs.password.placeholder = '留空则保留原密码';
    editingId = s.id;
    $('form-title').textContent = `编辑学生：${s.name}（${s.id}）`;
    btnUpdate.disabled = false;
    inputs.id.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    Object.values(inputs).forEach(el => { el.value = ''; });
    inputs.password.placeholder = '留空默认 123456';
    editingId = null;
    $('form-title').textContent = '录入学生成绩';
    btnUpdate.disabled = true;
  }

  async function addStudent() {
    const rec = readForm();
    if (!rec) return;
    try {
      const data = await api('/api/students', { method: 'POST', body: rec });
      resetForm();
      await refreshStudents();
      renderAll();
      toast(`已添加：${rec.name}（初始密码 ${data.password}）`, 'success');
    } catch (err) {
      if (handleAuthError(err)) return;
      toast(err.message, 'error');
    }
  }

  async function updateStudent() {
    if (editingId === null) return;
    const rec = readForm();
    if (!rec) return;
    try {
      await api('/api/students/' + encodeURIComponent(editingId), { method: 'PUT', body: rec });
      resetForm();
      await refreshStudents();
      renderAll();
      toast('修改已保存', 'success');
    } catch (err) {
      if (handleAuthError(err)) return;
      toast(err.message, 'error');
    }
  }

  async function removeStudent(id) {
    const s = students.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`确定删除「${s.name}（${s.id}）」的成绩记录吗？`)) return;
    try {
      await api('/api/students/' + encodeURIComponent(id), { method: 'DELETE' });
      if (editingId === id) resetForm();
      await refreshStudents();
      renderAll();
      toast('已删除', 'success');
    } catch (err) {
      if (handleAuthError(err)) return;
      toast(err.message, 'error');
    }
  }

  async function clearLogs() {
    if (loginLogs.length === 0) { toast('暂无登录记录', 'error'); return; }
    if (!confirm('确定清空所有登录记录吗？此操作不可恢复。')) return;
    try {
      await api('/api/logs', { method: 'DELETE' });
      loginLogs = [];
      renderLogs();
      toast('登录记录已清空', 'success');
    } catch (err) {
      if (handleAuthError(err)) return;
      toast(err.message, 'error');
    }
  }

  // ================= 渲染 =================
  function renderAll() {
    if (!currentUser) return;
    if (currentUser.role === 'admin') {
      renderAdminTable();
      renderLogs();
    } else {
      renderMyScores();
    }
  }

  function renderAdminTable() {
    const keyword = $('inp-search').value.trim().toLowerCase();
    const list = students.filter(s =>
      !keyword || s.id.toLowerCase().includes(keyword) || s.name.toLowerCase().includes(keyword)
    );

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">
        ${students.length === 0 ? '暂无学生记录，请在上方录入' : '没有找到匹配的学生'}
      </td></tr>`;
    } else {
      tbody.innerHTML = list.map(s => {
        const rank = s.rank;
        const rankCls = rank <= 3 ? ` rank-${rank}` : '';
        return `<tr>
          <td><span class="rank${rankCls}">${rank}</span></td>
          <td>${escapeHtml(s.id)}</td>
          <td>${escapeHtml(s.name)}</td>
          ${SUBJECTS.map(k => `<td class="${scoreClass(s[k])}">${fmtScore(s[k])}</td>`).join('')}
          <td><strong>${fmtScore(totalOf(s))}</strong></td>
          <td>${fmtScore(avgOf(s))}</td>
          <td>
            <button class="btn-ghost" style="padding:5px 12px;font-size:13px"
              onclick="window.__editStudent('${escapeAttr(s.id)}')">编辑</button>
            <button class="btn-danger" style="padding:5px 12px;font-size:13px"
              onclick="window.__removeStudent('${escapeAttr(s.id)}')">删除</button>
          </td>
        </tr>`;
      }).join('');
    }
    renderStats(list);
  }

  function renderStats(list) {
    if (list.length === 0) { statsBox.innerHTML = ''; return; }
    const n = list.length;
    const cards = [`<div class="stat"><div class="label">当前显示人数</div><div class="value">${n}<small> 人</small></div></div>`];
    SUBJECTS.forEach(k => {
      const avg = list.reduce((sum, s) => sum + s[k], 0) / n;
      cards.push(`<div class="stat"><div class="label">${SUBJECT_LABELS[k]}平均分</div><div class="value">${fmtScore(avg)}</div></div>`);
    });
    const overall = list.reduce((sum, s) => sum + avgOf(s), 0) / n;
    cards.push(`<div class="stat"><div class="label">总平均分</div><div class="value">${fmtScore(overall)}</div></div>`);
    const best = list.reduce((a, b) => (totalOf(b) > totalOf(a) ? b : a));
    cards.push(`<div class="stat"><div class="label">最高总分</div><div class="value">${fmtScore(totalOf(best))}<small> ${escapeHtml(best.name)}</small></div></div>`);
    statsBox.innerHTML = cards.join('');
  }

  function renderLogs() {
    $('log-count').textContent = loginLogs.length === 0
      ? '暂无登录记录'
      : `共 ${loginLogs.length} 条登录记录（最多保留 200 条）`;

    if (loginLogs.length === 0) {
      logTbody.innerHTML = `<tr><td colspan="4" class="empty">还没有用户登录过</td></tr>`;
      return;
    }

    logTbody.innerHTML = loginLogs.map(l => {
      const isAdmin = l.role === 'admin';
      return `<tr>
        <td>${escapeHtml(fmtTime(l.time))}</td>
        <td>${escapeHtml(l.username || '-')}</td>
        <td>${escapeHtml(l.name || '-')}</td>
        <td><span class="badge ${isAdmin ? 'badge-admin' : 'badge-student'}">
          ${isAdmin ? '管理员' : '学生'}
        </span></td>
      </tr>`;
    }).join('');
  }

  function renderMyScores() {
    if (!myInfo) {
      $('my-notice').innerHTML = `<div class="notice">成绩加载失败，请刷新页面重试。</div>`;
      return;
    }
    const s = myInfo.student;
    const rank = myInfo.rank;
    const total = myInfo.total;
    const noScores = SUBJECTS.every(k => !s[k]);

    $('my-notice').innerHTML = noScores
      ? `<div class="notice">你的成绩尚未录入，请等待老师添加后再查看。</div>`
      : '';

    $('my-avatar').textContent = s.name.charAt(0) || '?';
    $('my-name').textContent = s.name;
    $('my-meta').textContent = `学号 ${s.id} · 全班第 ${rank} 名 / 共 ${total} 人`;

    $('my-subjects').innerHTML = SUBJECTS.map(k => {
      const v = s[k];
      return `<div class="subject-card">
        <div class="subject-name">${SUBJECT_LABELS[k]}</div>
        <div class="subject-score ${scoreClass(v)}">${fmtScore(v)}</div>
        <div class="subject-level">${levelOf(v)}</div>
      </div>`;
    }).join('');

    $('my-summary').innerHTML = `
      <div class="stat"><div class="label">总分</div><div class="value">${fmtScore(totalOf(s))}<small> / 300</small></div></div>
      <div class="stat"><div class="label">平均分</div><div class="value">${fmtScore(avgOf(s))}</div></div>
      <div class="stat"><div class="label">综合等级</div><div class="value">${levelOf(avgOf(s))}</div></div>
      <div class="stat"><div class="label">班级排名</div><div class="value">${rank}<small> / ${total}</small></div></div>
    `;
  }

  // ================= 事件绑定 =================
  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = $('login-user').value.trim();
    const password = $('login-pass').value.trim();
    if (!username || !password) {
      $('login-error').textContent = '请输入学号和密码';
      return;
    }
    const btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const data = await api('/api/login', { method: 'POST', body: { username, password } });
      saveToken(data.token);
      currentUser = data.user;
      $('login-error').textContent = '';
      toast(`欢迎回来，${currentUser.name}`, 'success');
      await enterApp();
    } catch (err) {
      $('login-error').textContent = err.message;
      const card = $('loginForm');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    } finally {
      btn.disabled = false;
    }
  });

  $('registerForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = $('reg-id').value.trim();
    const name = $('reg-name').value.trim();
    const btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/register', { method: 'POST', body: { id, name } });
      $('reg-error').textContent = '';
      toast(`注册成功！请用密码 ${DEFAULT_PASSWORD} 登录`, 'success');
      showLoginCard();
      $('login-user').value = id;
      $('login-pass').value = '';
      $('login-pass').focus();
    } catch (err) {
      $('reg-error').textContent = err.message;
      const card = $('registerForm');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    } finally {
      btn.disabled = false;
    }
  });

  $('to-register').addEventListener('click', function (e) { e.preventDefault(); showRegisterCard(); });
  $('to-login').addEventListener('click', function (e) { e.preventDefault(); showLoginCard(); $('login-user').focus(); });

  $('btnLogout').addEventListener('click', function () {
    if (confirm('确定要退出登录吗？')) logout();
  });

  $('btn-add').addEventListener('click', addStudent);
  btnUpdate.addEventListener('click', updateStudent);
  $('btn-reset').addEventListener('click', resetForm);
  $('inp-search').addEventListener('input', renderAdminTable);
  $('btn-clear-logs').addEventListener('click', clearLogs);

  Object.values(inputs).forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') editingId === null ? addStudent() : updateStudent();
    });
  });

  window.__editStudent = function (id) {
    const s = students.find(x => x.id === id);
    if (s) fillForm(s);
  };
  window.__removeStudent = function (id) { removeStudent(id); };

  // ================= 启动 =================
  (async function start() {
    const user = await restoreSession();
    if (user) {
      currentUser = user;
      await enterApp();
    } else {
      $('loginPage').style.display = 'flex';
      showLoginCard();
      $('login-user').focus();
    }
  })();

  // 供 handleAuthError 使用（避免在定义前调用）
  function toastWhere(msg, type) { toast(msg, type); }
})();
