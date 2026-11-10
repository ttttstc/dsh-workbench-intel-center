# 羊毛大王（dsh-workbench-intel-center）

DSH Desktop 工作台插件。按关注主题持续收集、核实并结构化呈现最新信息；卡片可筛选、展开、
写备注、标记处理状态，并可一键生成复核提示词交给 AI 会话执行。

## 四个标签页

1. **羊毛雷达**：四个来源的实时羊毛帖（见下表），带羊毛分、核实结论、时间筛选与排序切换，数据在 `state.json` 的 `radar`。
2. **VPS 羊毛**：本工作台自己的卡片库（本文件后半详述），数据在 `state.json` 的 `cards`。
3. **X 羊毛**：X 上「羊毛」「薅」的最新 **200 条**（按发布时间从近到远），抓取走 web-access skill 的 CDP 模式
   （用你 Chrome 的真实登录态），不会在插件里存任何 cookie 或 token。
4. **Token 羊毛**：把 <https://aihot.news/free-tokens> 嵌入展示。源站带
   `X-Frame-Options: SAMEORIGIN`，浏览器不允许直接 iframe，所以由本机服务端取回 HTML、
   注入 `<base>` 后同源转发（`/api/intel-center/wool/page`），前端用
   **不带 `allow-same-origin` 的沙箱 iframe** 呈现——页面在自己的来源隔离里运行，拿不到宿主对象。
   「在新窗口打开」作为兜底；抓取结果缓存 5 分钟，手动刷新带 `force=1` 重新取。

> linux.do 的内容已经在**羊毛雷达**里（LINUX DO 是一个来源，可按「LINUX DO」来源筛选），
> 所以不再单独占用一个标签页。

### 羊毛雷达（四源，全部真实抓取）

| 来源 | 地址 | 取数 |
|---|---|---|
| LINUX DO · 福利羊毛 | https://linux.do/c/welfare/36 | 直连 RSS，被 Cloudflare 拦时改用浏览器取 |
| 小众软件 | https://www.appinn.com/feed/ | 官方 RSS |
| NodeSeek · 推广/情报 | https://www.nodeseek.com/categories/promotion | 仅浏览器（Cloudflare） |
| V2EX · 优惠信息 | https://www.v2ex.com/feed/deals.xml | 官方 Atom（不用会 403 的 JSON API） |

- 每天 **08:00 / 12:00 / 16:00 / 20:00**（本机时区）自动刷新，只留近 **7 天**，在库上限 **500** 条
- **默认按羊毛分从高到低排**（同分再看时间）；可切到「最新发布」纯时间倒序
- 关键词：免费、白嫖、限免、0 元、低价、优惠、羊毛、薅、送、领
- 标签：限免 / 免费 / 低价 / 一般（前三类按此优先级排序）
- 去重按原帖 URL；标题直达原帖；推广链接原样展示，不补编信息
- 支持来源分段 + 标签 + 重点词 + 关键词搜索 + 「今日新增」筛选
- 直连源与浏览器源在同一次刷新里跑完，任一来源失败只记录错误、不影响其他来源

### X 榜单的刷新节奏

- 与雷达共用同一个调度器：每天 **08:00 / 12:00 / 16:00 / 20:00**（本机时区，Harness 需在运行）
- 保留最新 **200 条**，按发布时间从近到远排列；点赞、转发、回复仍然显示，但**不参与排序**
- X 单页每次只能拿到一部分，所以刷新会把新结果与历史**按帖子 id 合并**，再按时间截取最新 200 条
- 面板里的「立即抓 200 条」可随时手动触发；「让 AI 搜」是 CDP 不可用时的兜底（生成指令交给会话）
- 抓取走 web-access 的 CDP 代理（<http://localhost:3456>），用你 Chrome 的登录态，插件不存任何 cookie

### 抓取任务的状态与反馈

抓取一次要几十秒到一两分钟，所以 `POST .../refresh` **立刻返回 202**，任务在后台跑，
进度与结果从 `/radar/status`、`/x/status` 的 `job` 字段读：

```json
{ "job": { "status": "succeeded", "running": false, "startedAt": "...", "finishedAt": "...",
           "durationMs": 20069, "reason": "manual",
           "result": { "count": 117, "fresh": 1032, "bySource": { "linuxdo": 69, "nodeseek": 43 },
                       "errors": ["LINUX DO 福利羊毛：返回 403"] },
           "error": "", "runs": 12 } }
```

`status` 是 `idle | running | succeeded | failed` 四态；正在跑时再点刷新返回 `skipped`，不排队也不叠加。

界面上的三处反馈，解决「点了不知道有没有开始」：

- 按钮点下去立刻变成 **「抓取中 12s…」**，秒数每秒走一格（服务端自己发起的定时任务也一样显示）
- 顶部提示条写明「已启动」，结束后给出**用时 + 本轮条数 + 各来源条数 + 在库总数**
- 「上次刷新」下方常驻一行结果（例如 `上次抓到 1032 条 · 用时 20s（LINUX DO 69 / NodeSeek 43）`），
  失败则常驻失败原因——提示条会消失，这一行不会

### 版本握手（换版本后请重启 Harness）

客户端产物打开即生效，服务端插件要等 Harness 重启才会用上新代码。两边的协议版本对不上时，
面板顶部会直接显示「服务端还是旧版本」的横幅——以前这种情况只会表现成「按钮点了没反应」。


## 它解决什么

散落在各处的"哪个平台还免费""额度多少""要不要绑卡""会不会休眠"这类问题，通常靠记忆和零散搜索，
过一阵就过期。这个工作台把它变成可维护的卡片库：

- **今日重点**：高优先级、评分高、已核实的排在最前，打开就能看到当前最值得动的几项。
- **多维筛选**：分类、核实状态（已确认／待验证）、处理标记（未标记／待试用／持续关注／已采用／已排除）、
  最低评分，外加全文搜索（标题、要点、额度、坑点、来源都能搜）。
- **卡片详情**：核心要点、带数字的数据与规格、优缺点与坑点、适用场景评分与理由、核实日期与来源、
  注册条件、下一步建议。
- **我自己的部分**：备注与处理标记直接写在卡片里，自动保存（失败会提示并自动重试，关页面前还会补最后一次）。
- **一键复核**：生成一段结构化复核指令并复制到剪贴板，Agent 在会话里联网核实后把结果写回数据文件，
  回到面板点「刷新」即生效。

## 界面与宿主的关系

- 使用 `customFrame: true`：整页是业务内容，首次进入不依赖会话，也不自动创建会话。
- 需要 AI 协助时点「打开 AI 对话」，通过宿主 `service.newWorkspaceSession()` / `currentSession()`
  创建或恢复本工作台会话，并把宿主传入的 `conversation` 节点放进右侧抽屉——不自行实现聊天界面。
- 不遮挡宿主左侧会话栏、模式切换器与「工作台管理」入口。

## 数据放在哪里

`cordis.patch.yml` 把 `root` 指向 `dshHomePath('intel-center')`，即 DSH 数据目录下的 `intel-center/`，
里面只有 `state.json`。卸载工作台不会删除这个目录。

首次读取时若 `state.json` 不存在，会用 `src/shared/seed.js` 的种子数据初始化。
磁盘上的个别卡片如果坏了（缺标题、id 重复），读取时会跳过它们并在日志里报告数量，不会让整份数据打不开。

### 谁可以改哪些字段

| 字段 | 归谁写 | 规则 |
|---|---|---|
| `cards` / `topics` / `lastReviewedAt` | 用户（界面）与 Agent | 以最新一次写入为准；`POST /state` 带 `baseUpdatedAt` 时，若文件在这期间被别处改过，按卡片 id 合并并回 `conflict: true` |
| `linuxdo` / `x` / `radar` | 抓取任务与 Agent | 只接受 `updatedAt` 更新的来件；界面整份保存时带着旧榜单也不会覆盖新抓的条目 |
| `version` | 工作台 | 固定写 1；读到更高版本会告警并按 v1 处理 |

## 本机接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/intel-center/meta` | 返回数据目录与文件路径（面板生成复核提示词时要用真实路径），以及 `apiVersion`（版本握手用） |
| GET | `/api/intel-center/state` | 读取全部状态 |
| POST | `/api/intel-center/state` | 写入卡片与主题（按上文所有权规则合并，先经过 `dsh/model.js` 校验与截断） |
| GET | `/api/intel-center/radar/status` | 雷达任务状态、下次运行时间、小时表、来源表、条目上限 |
| POST | `/api/intel-center/radar/refresh` | 启动一次雷达抓取，返回 `202`（正在跑时返回 `200` + `skipped`） |
| GET | `/api/intel-center/x/status` | X 榜单任务状态（同上） |
| POST | `/api/intel-center/x/refresh` | 启动一次 X 抓取，返回 `202` |
| GET | `/api/intel-center/wool` | 抓取元信息（源站、抓取时间、是否命中缓存、字节数） |
| GET | `/api/intel-center/wool/page` | 同源转发的可嵌入 HTML（注入 `<base>`、去掉拦嵌入的 CSP） |

## 开发

```bash
node scripts/build-client.mjs            # 生成 lib/client.js（单文件客户端模块，必须重新生成）
node --test test/*.test.js               # 全部测试（模型 / 纯逻辑 / 存储 / 路由 / 任务 / 抓取）
node scripts/check-workbench-package.mjs # 包校验
pnpm pack                                # 打本地安装包
```

改动后请跑 `pnpm run verify`：重建客户端 → 跑全部测试 → 包校验，一条命令覆盖交付前的三条底线。

`src/shared/core.js` 是筛选、排序与提示词生成的纯逻辑：客户端构建时内联，测试与服务端直接导入，
避免界面改动与测试脱节。抓取任务的状态机在 `dsh/jobs.js`（可脱离网络测试）。

隐式状态机的完整清单、失效方式与本次决策见 [`docs/state-machines.md`](docs/state-machines.md)。

## 结构

```text
package.json            npm 与 DSH 插件声明
cordis.patch.yml        把服务端入口插入插件树
dsh/server.js           服务端入口：插件声明 + Config
dsh/routes.js           本机接口实现（不依赖宿主，可单独测试）
dsh/jobs.js             抓取任务状态机（idle → running → succeeded | failed）
dsh/schedule.js         定时刷新（08/12/16/20，本机时区）
dsh/store.js            数据文件读写（临时文件 + rename，读时容错）
dsh/model.js            数据校验、字段截断、写入合并、稳定 id
dsh/crawler.js          CDP 抓取（X 搜索页、linux.do / NodeSeek 页面内 fetch）
dsh/sources.js          直连源、解析、关键词/分类、羊毛评分、雷达合并
dsh/wool.js             Token 羊毛页面代理与缓存
src/shared/core.js      筛选 / 今日重点 / 提示词生成
src/shared/seed.js      首次初始化的种子数据
src/client/main.js      业务面板源码
lib/client.js           构建产物（Desktop 只加载这个）
scripts/                构建与包校验
test/                   模型、纯逻辑、存储、路由、任务、抓取测试
docs/                   截图与状态机文档
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
