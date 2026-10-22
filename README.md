# 学生成绩管理系统

HTML5 课程作品，同一套界面有两个版本：

| 版本 | 位置 | 数据存哪 | 适合场景 |
| --- | --- | --- | --- |
| 在线演示版 | 仓库根目录 `index.html` | 浏览器 localStorage | 打开就能看效果，数据跟着每台设备各存各的 |
| 后端版 | [`server/`](server/) | 服务器上的 SQLite | 老师电脑跑服务，全班多台设备共享同一份成绩 |

## 在线预览（静态版）

**https://gyj060122.github.io/xscjgl/**

> GitHub Pages 只能托管静态文件，跑不了 Node 服务，所以线上这份是 localStorage 版。
> 后端版需要在本地或自己的服务器上启动，见 [`server/README.md`](server/README.md)。

## 功能

- 登录 / 注册，管理员与学生两种角色
- 成绩录入、修改、删除、按学号或姓名搜索
- 排名（同分并列）、各科平均分、最高总分统计
- 学生端只看自己的成绩、排名与等级
- 登录记录审计（最多保留 200 条）

## 后端版快速开始

需要 Node.js 18+（推荐 22/24，内置 SQLite）。

```bat
cd server
双击 启动服务器.bat
```

启动后控制台会打印两个地址：

```
本机访问：http://localhost:8080/
局域网访问：http://172.20.10.11:8080/
```

同学连同一个 WiFi 或热点，访问「局域网访问」那个地址即可。默认账号：

- 管理员 `admin` / `admin123`
- 学生 `学号` / `123456`

## 目录结构

```
.
├─ index.html              静态版页面（GitHub Pages 入口）
├─ 学生成绩管理系.html        课程作业占位文件
├─ server/                 后端版
│  ├─ server.js            Node 服务，零第三方依赖
│  ├─ public/              前端页面（复用同一套 HTML/CSS）
│  ├─ data/scores.db       SQLite 数据库（自动生成，已 gitignore）
│  ├─ tools/               构建与测试脚本
│  ├─ 启动服务器.bat
│  └─ 开放防火墙端口.bat
└─ 261022/                 课堂练习页面
```

## 测试

后端带了两套自动化测试：

```bat
cd server
node tools\test-api.js     :: 接口测试，33 项
node tools\e2e.js          :: 浏览器端到端测试，18 项（需 Edge 调试端口）
```
