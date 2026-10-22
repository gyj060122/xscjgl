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

const out = head + '<script src="./app.js"></script>\r\n</body>\r\n</html>\r\n';
fs.writeFileSync(OUT, out, 'utf8');

console.log('WROTE bytes:', Buffer.byteLength(out));
console.log('TAIL:', JSON.stringify(out.slice(-80)));
