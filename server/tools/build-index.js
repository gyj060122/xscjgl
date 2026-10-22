const fs = require('fs');

const SRC = 'E:/HTML5课程/xscjgl.html';
const OUT = 'E:/HTML5课程/xscjgl-server/public/index.html';

const src = fs.readFileSync(SRC, 'utf8');
const i = src.indexOf('<script>');
if (i < 0) throw new Error('未找到 <script> 标签');

let head = src.slice(0, i);
const from = '支持录入、修改、删除、查询与统计分析 · 数据自动保存在浏览器本地';
if (!head.includes(from)) throw new Error('未找到 header-tip 文案');
head = head.replace(from, '支持录入、修改、删除、查询与统计分析 · 数据保存在服务器，多台设备同步');

// 在「学生名单」工具栏里加一个导出按钮（后端版独有）
const toolbarAnchor = '<span class="hint">点击表格中的「编辑」按钮可修改该学生</span>';
if (!head.includes(toolbarAnchor)) throw new Error('未找到名单工具栏');
head = head.replace(
  toolbarAnchor,
  toolbarAnchor + '\n        <button class="btn-ghost" id="btn-export" style="padding:6px 14px;font-size:13px">⬇️ 导出成绩表</button>'
);

const out = head + '<script src="./app.js"></script>\r\n</body>\r\n</html>\r\n';
fs.writeFileSync(OUT, out, 'utf8');

console.log('WROTE bytes:', Buffer.byteLength(out));
console.log('TAIL:', JSON.stringify(out.slice(-80)));
