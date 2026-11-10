# 羊毛大王（dsh-workbench-intel-center）

DSH Desktop 工作台插件。按关注主题持续收集、核实并结构化呈现最新信息；卡片可筛选、展开、
写备注、标记处理状态，并可一键生成复核提示词交给 AI 会话执行。

## 两个标签页

1. **情报卡片**：本工作台自己的卡片库（下面详述），数据在 `state.json`。
2. **Token 羊毛**：把 <https://aihot.news/free-tokens> 只读嵌进来。源站带
   `X-Frame-Options: SAMEORIGIN`，浏览器不允许直接 iframe，所以由本机服务端取回 HTML、
   注入 `<base>` 后同源转发（`/api/intel-center/wool/page`），前端用
   **不带 `allow-same-origin` 的沙箱 iframe** 呈现——页面在自己的来源隔离里运行，拿不到宿主对象。
   「在新窗口打开」作为兜底；抓取结果缓存 5 分钟，手动刷新带 `force=1` 重新取。

3. **linux.do 羊毛榜**：linux.do 站内「羊毛」「薅」按点赞排序的当日 Top 20。该站搜索需要登录，
   所以数据由 AI 会话抓取后写回 `state.json` 的 `linuxdo` 字段，面板只负责展示与生成抓取指令
   （登录状态由会话里的浏览器维护，插件本身不存任何凭据）。

4. **X 羊毛热帖**：X 上「羊毛」「薅」按点赞排序的 Top 20。抓取走 web-access skill 的 CDP 模式
   （用你 Chrome 的真实登录态），不会在插件里存任何 cookie 或 token；面板负责展示与生成抓取指令。

### 羊毛雷达（四源，全部真实抓取）

| 来源 | 地址 | 取数 |
|---|---|---|
| LINUX DO · 福利羊毛 | https://linux.do/c/welfare/36 | 直连 RSS，被 Cloudflare 拦时后台浏览器补抓 |
| 小众软件 | https://www.appinn.com/feed/ | 官方 RSS |
| NodeSeek · 推广/情报 | https://www.nodeseek.com/categories/promotion | 仅浏览器（Cloudflare） |
| V2EX · 优惠信息 | https://www.v2ex.com/feed/deals.xml | 官方 Atom（不用会 403 的 JSON API） |

- 每 4 小时刷新，只留近 7 天，过期自动下版
- 关键词：免费、白嫖、限免、0 元、低价、优惠、羊毛、薅、送、领
- 标签：限免 / 免费 / 低价（按此优先级排序）
- 去重规则按原帖 URL；标题直达原帖；推广链接原样展示，不补编信息
- 支持标签筛选 + 关键词搜索，窄窗口自动重排
- 直连结果先落库，浏览器源在后台补入（几分钟内可见）

### 旧说明（已并入上表）

- **每 4 小时**自动刷新一次（00/04/08/12/16/20 点），只保留**近 7 天**的帖子
- 自动分为 **免费白嫖 / 限免 / 低价优惠**，通用闲谈不进榜；支持按来源、分类、关键词过滤
- V2EX（公开 API）与小众软件（RSS）由服务端直接抓；linux.do 与 NodeSeek 有登录墙/Cloudflare，
  需要在浏览器里登录后用各自 tab 或 AI 会话抓取
- 视觉采用花叔 skill 的 **Pentagram 编辑风**：奶油白底、近黑字、橙红强调色、细黑边框与精确网格

### X 榜单的刷新节奏

- 每天 **09:00 / 14:00 / 21:00** 各自动刷新一次（本机时区，Harness 需在运行）
- 每次最多保留 **50 条**（按点赞降序）；X 单页能拿到的新帖有限，所以刷新会把新结果与历史**按帖子 id 合并**，
  榜单逐次累积到 50 条
- 面板里的「立即抓 50 条」可随时手动触发；「让 AI 搜」是 CDP 不可用时的兜底（生成指令交给会话）
- 抓取走 web-access 的 CDP 代理（http://localhost:3456），用你 Chrome 的登录态，插件不存任何 cookie

## 它解决什么

散落在各处的"哪个平台还免费""额度多少""要不要绑卡""会不会休眠"这类问题，通常靠记忆和零散搜索，
过一阵就过期。这个工作台把它变成可维护的卡片库：

- **今日重点**：高优先级、评分高、已核实的排在最前，打开就能看到当前最值得动的几项。
- **多维筛选**：分类、核实状态（已确认／待验证）、处理标记（待试用／持续关注／已采用／已排除）、最低评分，
  外加全文搜索（标题、要点、额度、坑点、来源都能搜）。
- **卡片详情**：核心要点、带数字的数据与规格、优缺点与坑点、适用场景评分与理由、核实日期与来源、
  注册条件、下一步建议。
- **我自己的部分**：备注与处理标记直接写在卡片里，自动保存。
- **一键复核**：生成一段结构化复核指令并复制到剪贴板，Agent 在会话里联网核实后把结果写回数据文件，
  回到面板点「刷新」即生效。

## 界面与宿主的关系

- 使用 `customFrame: true`：整页是业务内容，首次进入不依赖会话，也不自动创建会话。
- 需要 AI 协助时点「打开 AI 对话」，通过宿主 `service.ensureSession()` 创建或恢复本工作台会话，
  并把宿主传入的 `conversation` 节点放进右侧抽屉——不自行实现聊天界面。
- 不遮挡宿主左侧会话栏、模式切换器与「工作台管理」入口。

## 数据放在哪里

`cordis.patch.yml` 把 `root` 指向 `dshHomePath('intel-center')`，即 DSH 数据目录下的 `intel-center/`，
里面只有 `state.json`。卸载工作台不会删除这个目录。

首次读取时若 `state.json` 不存在，会用 `src/shared/seed.js` 的种子数据初始化。

## 本机接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/intel-center/meta` | 返回数据目录与文件路径（面板生成复核提示词时要用真实路径） |
| GET | `/api/intel-center/state` | 读取全部卡片 |
| POST | `/api/intel-center/state` | 整份覆盖写入（先过 `dsh/model.js` 校验与截断） |

## 开发

```bash
node scripts/build-client.mjs            # 生成 lib/client.js（单文件客户端模块）
node --test test/model.test.js test/core.test.js test/store.test.js
node scripts/check-workbench-package.mjs
node scripts/check-workbench-package.mjs --tarball intel-center-1.0.0.tgz
pnpm pack                                # 打本地安装包
```

`src/shared/core.js` 是筛选、排序与提示词生成的纯逻辑：客户端构建时内联，测试与服务端直接导入，
避免界面改动与测试脱节。

## 结构

```text
package.json            npm 与 DSH 插件声明
cordis.patch.yml        把服务端入口插入插件树
dsh/server.js           服务端入口：插件声明 + Config
dsh/routes.js           本机接口实现（不依赖宿主，可单独测试）
dsh/store.js            数据文件读写（临时文件 + rename）
dsh/model.js            数据校验与字段截断
src/shared/core.js      筛选 / 今日重点 / 复核提示词
src/shared/seed.js      首次初始化的种子数据
src/client/main.js      业务面板源码
lib/client.js           构建产物（Desktop 只加载这个）
scripts/                构建与包校验
test/                   模型、纯逻辑、存储、路由测试
```

## 安装

本仓库就是安装来源：`package.json` 与客户端 `register()` 的 `repository` 都指回本仓库，
工作台身份为 `ttttstc/dsh-workbench-intel-center`。

1. 在 [Releases](https://github.com/ttttstc/dsh-workbench-intel-center/releases) 下载
   `dsh-workbench-intel-center.tgz`（也可由 Agent 调用
   `install_local_workbench({ path: "<本机 .tgz 绝对路径>" })` 安装）。
2. 按提示重启 Harness。
3. 展开左侧栏，在「工作台」右侧的切换区域选择「羊毛大王」。

本机开发阶段省略 `repository` 时，宿主按 npm 包名派生 `local:dsh-workbench-intel-center` 身份；
声明真实仓库后使用 `owner/repo` 身份，本地旧会话不会自动迁移。
