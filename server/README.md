# 学生成绩管理系统 · 后端版

把你原来的 [xscjgl.html](../xscjgl.html) 从「数据存在浏览器」改成了「数据存在服务器」。
现在一台电脑跑服务，同一局域网里的所有设备看到的是**同一份数据**：老师录一次，学生用手机就能查到。

原来的 `xscjgl.html` 没有改动，仍然保留（它已发布在 GitHub Pages 上，走 localStorage 版本）。

---

## 一、怎么启动

双击 **`启动服务器.bat`**。

窗口里会打印出两个地址，例如：

```
  本机访问：http://localhost:8080/
  局域网访问：http://172.20.10.11:8080/
```

- 老师自己在这台电脑上用「本机访问」
- 学生连**同一个 WiFi / 同一台手机热点**，用「局域网访问」那个地址
- **窗口不能关**，关掉就等于停止服务

## 二、账号

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 管理员 | `admin` | `admin123` |
| 学生 | 学号 | 初始 `123456`（老师录入时可指定） |

- 学生可以在登录页自助注册，注册后成绩为 0，等老师录入
- 管理员密码可用环境变量改：`set ADMIN_PASSWORD=你的新密码` 后再启动（只在首次初始化时生效，之后改密码请调 `/api/password` 接口）

## 三、同学打不开怎么办

Windows 防火墙默认会拦住外部访问。如果学生浏览器显示「无法访问此网站」：

1. 右键 **`开放防火墙端口.bat`** →「以管理员身份运行」
2. 或者手动执行（管理员 CMD）：
   ```
   netsh advfirewall firewall add rule name="xscjgl-server-8080" dir=in action=allow protocol=TCP localport=8080
   ```

还有一种常见情况：电脑连的是手机热点，IP 会变。重新看启动窗口里打印的局域网地址即可；
或者用 `ipconfig` 查当前 IP。

## 四、数据存在哪

- 数据库文件：`data/scores.db`（SQLite，单个文件）
- **备份**：直接复制这个文件即可，停止服务后复制最稳妥
- **迁移**：把整个 `xscjgl-server` 文件夹拷走就能换机器用
- 想清空重来：停掉服务，删除 `data` 里的 `scores.db*` 三个文件，重新启动

## 五、结构

```
xscjgl-server/
├─ server.js              后端主程序（零第三方依赖）
├─ public/
│  ├─ index.html          页面（复用原页面的 HTML + CSS）
│  └─ app.js              前端逻辑，改成调用后端接口
├─ data/scores.db         数据库（自动创建）
├─ tools/
│  ├─ build-index.js      从 ../xscjgl.html 重新生成 public/index.html
│  ├─ test-api.js         接口测试，33 项
│  └─ e2e.js              浏览器端到端测试，18 项
├─ docs/                  测试时截的图
├─ 启动服务器.bat
└─ 开放防火墙端口.bat
```

## 六、接口一览

所有写操作都要带 `Authorization: Bearer <token>`，token 由登录接口返回。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/login` | 公开 | 登录，返回 token |
| POST | `/api/register` | 公开 | 学生自助注册 |
| GET | `/api/session` | 登录 | 校验 token、恢复登录态 |
| POST | `/api/logout` | 登录 | 退出并作废 token |
| GET | `/api/students` | 管理员 | 全班名单（带排名） |
| GET | `/api/export` | 管理员 | 导出成绩表 CSV |
| POST | `/api/students` | 管理员 | 新增学生 |
| PUT | `/api/students/:id` | 管理员 | 修改学生 |
| DELETE | `/api/students/:id` | 管理员 | 删除学生 |
| GET | `/api/me` | 学生 | 自己的成绩 + 班级排名 |
| GET | `/api/logs` | 管理员 | 登录记录 |
| DELETE | `/api/logs` | 管理员 | 清空登录记录 |
| POST | `/api/password` | 登录 | 修改自己的密码 |

## 七、安全设计

这是课堂局域网环境，做了该做的，但也别把端口映射到公网：

- 密码用 **PBKDF2-SHA256（12 万次迭代 + 随机盐）** 存哈希，数据库里没有明文密码
- 登录态是 32 字节随机 token，存服务端，默认 7 天过期，退出即作废
- 同一账号连续输错 5 次密码，锁定 60 秒
- 接口按角色鉴权：学生调不了管理员接口（测试里有验证）
- 返回给前端的学生数据**不含密码字段**
- 校验：学号 3~20 位、成绩 0~100、密码至少 4 位、防路径穿越

局限（局域网教学环境可接受）：HTTP 明文传输、没有 CSRF 防护、没有 HTTPS 证书。
真要放到公网，请套一层 Nginx + HTTPS，并把默认管理员密码换掉。

## 八、导出成绩表

管理员登录后，在「学生名单」工具栏点 **⬇️ 导出成绩表**，浏览器会直接下载
`成绩表_YYYYMMDD.csv`。

- 文件开头带 UTF-8 BOM，Excel / WPS 双击打开中文不会乱码
- 列：排名、学号、姓名、语文、数学、英语、总分、平均分
- 导出的永远是全部学生，不受搜索框筛选影响
- 也可以直接调接口：`GET /api/export`（需带上管理员令牌）

## 九、跑测试

```bat
:: 先启动服务，然后另开一个窗口
node tools\test-api.js
```

端到端测试需要 Edge 的调试端口，一般不用跑：

```bat
start msedge --headless=new --remote-debugging-port=9222 --user-data-dir=%TEMP%\edge-e2e about:blank
node tools\e2e.js
```
