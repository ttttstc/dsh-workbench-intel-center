// 本文件由 scripts/build-client.mjs 从 src/client/main.js 生成，请勿直接修改。
window.__ModuleLoader__.load({
  id: "dsh-workbench-intel-center",
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    ;(function (module, exports, require) {
    const { STATUS_LABEL, FLAGS, FLAG_LABEL, todayISO, formatWhen, filterCards, highlightCards, buildReviewPrompt, buildClaimPrompt, buildXPrompt, RADAR_CATEGORIES, RADAR_CATEGORY_LABEL, splitRadarItems, X_TOP_LIMIT, API_VERSION, sortRadarItems, filterRadar, relativeTime } = (function () {
      /**
       * 情报中心的纯逻辑：状态文案、筛选、今日重点排序、复核提示词。
       *
       * 放在 shared 里有两层原因：客户端构建时会内联这份代码，服务端与 node --test 也直接导入，
       * 一套逻辑不会因为界面改动而与测试脱节。
       */

      const STATUS_LABEL = { confirmed: '已确认', pending: '待验证' }

      const FLAGS = [
        ['none', '未标记'],
        ['shortlist', '待试用'],
        ['watch', '持续关注'],
        ['used', '已采用'],
        ['dropped', '已排除']
      ]

      const FLAG_LABEL = Object.fromEntries(FLAGS)

      /** 本地日期（YYYY-MM-DD），复核提示词里的「今天」用它。 */
      function todayISO(now = new Date()) {
        const pad = (n) => String(n).padStart(2, '0')
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      }

      function formatWhen(value) {
        if (!value) return '未记录'
        const parsed = new Date(value)
        if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 40)
        const pad = (n) => String(n).padStart(2, '0')
        return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
      }

      const norm = (value) => String(value ?? '').trim().toLowerCase()

      /** 搜索 + 多维筛选（分类、核实状态、处理标记、最低评分）。 */
      function filterCards(cards, filters = {}) {
        const q = norm(filters.q)
        const category = filters.category || ''
        const status = filters.status || ''
        const minScore = Number(filters.minScore || 0)
        const flag = filters.flag || ''
        return (cards || []).filter((card) => {
          if (category && card.category !== category) return false
          if (status && card.status !== status) return false
          if (flag && (card.flag || 'none') !== flag) return false
          if (minScore && Number(card.score || 0) < minScore) return false
          if (!q) return true
          const haystack = [
            card.title,
            card.category,
            (card.tags || []).join(' '),
            (card.summary || []).join(' '),
            (card.facts || []).map((fact) => `${fact.label} ${fact.value}`).join(' '),
            (card.pros || []).join(' '),
            (card.cons || []).join(' '),
            card.scoreReason,
            card.note,
            card.nextAction,
            card.signup,
            (card.sources || []).map((source) => `${source.title} ${source.url}`).join(' ')
          ].join(' ')
          return norm(haystack).includes(q)
        })
      }

      /** 今日重点：高优先级优先，其次看评分、核实状态与处理标记。 */
      function highlightCards(cards, limit = 3) {
        const rank = (card) => {
          let value = 0
          if (card.priority === 'high') value += 100
          if (card.status === 'confirmed') value += 20
          value += Number(card.score || 0) * 3
          if ((card.flag || 'none') === 'used') value += 6
          if ((card.flag || 'none') === 'dropped') value -= 60
          return value
        }
        return [...(cards || [])].sort((a, b) => rank(b) - rank(a)).slice(0, limit)
      }

      /** 生成给 Agent 的复核提示词：主题、现有卡片 id、数据文件真实路径。 */
      function buildReviewPrompt({ topics, cards, dataFile, today }) {
        const topicText = (topics || [])
          .map((topic) => `- ${topic.title}${topic.note ? `（${topic.note}）` : ''}`)
          .join('\n') || '- 未设置主题，请按现有卡片推断'
        const cardText = (cards || [])
          .map((card) => `- ${card.id}｜${card.title}｜核实：${card.verifiedAt || '无'}｜状态：${STATUS_LABEL[card.status] || card.status}`)
          .join('\n') || '- 目前还没有卡片，请按主题新建'
        return [
          '你是「智能信息情报中心」的复核员，请实际联网核实下面的主题，并把结果写回卡片数据文件。',
          '',
          '## 关注主题',
          topicText,
          '',
          '## 现有卡片（按 id 更新，不要改 id）',
          cardText,
          '',
          '## 今天日期',
          today || todayISO(),
          '',
          '## 复核规则',
          '1. 只抓官方或权威来源的页面，逐条实际读取，不要凭记忆或推测。',
          '2. 每个数字（额度、规格、价格、期限）都必须能对应到你这次抓到的页面。',
          '3. 抓不到的项写「未获取到」，把该卡片 status 标为 pending；不要编造。',
          '4. 优先收录高实用性、可操作的内容，并写清避坑点（绑卡、休眠、冷启动、限速、超额计费）。',
          '5. 核实时间写进 verifiedAt（YYYY-MM-DD）；已确认的 status 为 confirmed，未证实为 pending。',
          '',
          ...WRITE_RULES,
          '',
          '## 写回位置（固定路径，直接编辑这个文件）',
          dataFile ? `\`${dataFile}\`` : '（读取工作台数据目录后填写）',
          '',
          '## 文件结构（保持字段名与结构不变）',
          '{',
          '  "version": 1,',
          '  "cards": [',
          '    {',
          '      "id": "card-xxx",',
          '      "title": "平台/方案名称",',
          '      "category": "容器PaaS | 免费VPS | Serverless | 边缘函数 | 其他",',
          '      "tags": ["关键词"],',
          '      "priority": "high | normal",',
          '      "summary": ["3-5 条核心要点"],',
          '      "facts": [{ "label": "额度/规格/价格", "value": "带具体数字" }],',
          '      "pros": ["优点"],',
          '      "cons": ["坑点与限制"],',
          '      "score": 1,',
          '      "scoreReason": "打分理由",',
          '      "status": "confirmed | pending",',
          '      "verifiedAt": "YYYY-MM-DD",',
          '      "sources": [{ "title": "来源标题", "url": "https://..." }],',
          '      "signup": "是否要绑卡/实名",',
          '      "nextAction": "下一步建议",',
          '      "note": "",',
          '      "flag": "none | watch | shortlist | used | dropped"',
          '    }',
          '  ],',
          '  "topics": [ ... 保持不变 ... ],',
          '  "lastReviewedAt": "复核完成时间（ISO 8601）",',
          '  "updatedAt": "写入时间（ISO 8601）"',
          '}',
          '',
          '## 完成后',
          '写回文件后，用一句话说明：新增了几张卡片、更新了几张、哪些仍是待验证，以及需要我优先处理的项。不要删除用户已写的 note。'
        ].join('\n')
      }

      /**
       * 生成「搜 X 上羊毛热帖」的指令。抓取必须走 web-access skill（用户 Chrome 的真实登录态 + CDP）。
       */
      function buildXPrompt({ date, keywords = ['羊毛', '薅'], dataFile, existing = [] }) {
        const day = date || todayISO()
        const kws = (keywords && keywords.length ? keywords : ['羊毛', '薅']).map((k) => `「${k}」`).join('、')
        const prev = (existing || []).length
          ? `上一次抓到 ${existing.length} 条，本次请覆盖成今天的新榜。`
          : '目前还没有抓取记录。'
        return [
          '请用 web-access skill 抓取 X（Twitter）上关于' + kws + '的热帖，并写回工作台数据文件。',
          '',
          '## 目标',
          '- 站点：https://x.com',
          '- 关键词：' + kws,
          '- 排序：按点赞数（likes）从高到低，取前 ' + X_TOP_LIMIT + ' 条',
          '- 时间范围：优先今天（' + day + '），不足 50 条可放宽到最近 7 天',
          prev,
          '',
          '## 做法',
          '1. 加载 web-access skill，按其指引用 CDP 操作用户 Chrome（天然带登录态），自建后台 tab，结束后关闭。',
          '2. 搜索页用 https://x.com/search?q=<关键词>&f=top ；关键词可补充「薅羊毛」「羊毛 免费」提高召回。',
          '3. 抽取每条帖子的：正文（超长截断）、作者名、@handle、点赞、转发、回复、发布时间、帖子链接。',
          '4. 按帖子 id 去重，按点赞降序保留前 ' + X_TOP_LIMIT + '，过滤纯广告与无关内容。',
          '5. 计数可能是「1.2万」这类中文缩写，统一换算成整数；抓不到的字段留 0，不要编造。',
          '',
          ...WRITE_RULES,
          '',
          '## 写回位置',
          dataFile ? '`' + dataFile + '`' : '（读取工作台数据目录后填写）',
          '',
          '## 文件结构（只改 x 字段，其他字段原样保留）',
          '{',
          '  "version": 1,',
          '  "cards": [ ... 保持不变 ... ],',
          '  "topics": [ ... 保持不变 ... ],',
          '  "linuxdo": { ... 保持不变 ... },',
          '  "x": {',
          '    "updatedAt": "抓取完成时间（ISO 8601）",',
          '    "date": "' + day + '",',
          '    "keywords": ' + JSON.stringify(keywords && keywords.length ? keywords : ['羊毛', '薅']) + ',',
          '    "items": [',
          '      {',
          '        "id": "帖子 id",',
          '        "rank": 1,',
          '        "title": "正文（截断到 400 字内）",',
          '        "url": "https://x.com/<handle>/status/<id>",',
          '        "author": "显示名",',
          '        "handle": "@handle",',
          '        "likes": 0,',
          '        "reposts": 0,',
          '        "replies": 0,',
          '        "createdAt": "2026-01-01T00:00:00Z",',
          '        "excerpt": "一句话摘要"',
          '      }',
          '    ]',
          '  },',
          '  "lastReviewedAt": "...",',
          '  "updatedAt": "写入时间（ISO 8601）"',
          '}',
          '',
          '## 完成后',
          '写回后一句话说明：抓到几条、最高点赞哪条、是否遇到登录墙或被限流的搜索。'
        ].join('\n')
      }

      /**
       * 生成「让 AI 帮我把这条羊毛领掉」的指令（只针对非游戏条目；游戏仍由用户自己点）。
       *
       * 设计要点：
       * - 先读原帖再动手：很多领取方式只写在帖子里，不在标题里
       * - 以页面为准：帖子可能过期，落地页变了就以页面为准并说明
       * - 边界写死：不碰凭据、不付款、不实名、遇验证码停下交还给人
       */
      function buildClaimPrompt({ item, today } = {}) {
        const title = String(item?.title || '').trim()
        const url = String(item?.url || '').trim()
        const source = String(item?.source || '').trim()
        const deadline = String(item?.expiresAt || '').trim()
        const excerpt = String(item?.excerpt || '').trim()
        const score = Number(item?.score) || 0
        const verdictText = {
          free: '真实免费',
          conditional: '有条件免费（可能需要绑卡/实名）',
          discount: '只是优惠，不是免费',
          unknown: '看不出是否真免费'
        }[item?.verdict] || '未判断'

        return [
          '请帮我把下面这条羊毛领掉。先核实再动手，做不到就如实告诉我卡在哪。',
          '',
          '## 目标条目',
          `- 标题：${title || '（无标题）'}`,
          `- 链接：${url || '（没有链接）'}`,
          source ? `- 来源：${source}` : null,
          deadline ? `- 截止：${deadline}` : null,
          score ? `- 羊毛分：${score}/100` : null,
          `- 程序判断：${verdictText}`,
          excerpt ? `- 摘要：${excerpt}` : null,
          `- 今天：${today || todayISO()}`,
          '',
          '## 步骤',
          '1. 先打开原帖读清楚领取方式与条件——额度、地区、是否需要新用户，很多要点只写在帖子里。',
          '2. 再打开领取页/落地页，确认活动仍在、价格与额度与帖子一致；不一致就以页面为准并告诉我差在哪。',
          '3. 页面明确要求注册就注册，要求点「领取/开通/试用」就点，只做页面要求的动作，不额外操作。',
          '4. 遇到填手机号、实名、绑卡等环节，先停下问我，不要自己填。',
          '',
          '## 边界（必须遵守）',
          '- 不输入、不索要、不保存任何密码、验证码、银行卡或支付信息。',
          '- 需要登录或人机校验时，把窗口留给我，等我处理完再继续。',
          '- 不接受任何付费项：不付费、不押金、不首充、不开通会自动续费的试用。',
          '- 出现「确认购买 / 订阅 / 自动续费 / 开通会员」时一律停下问我。',
          '- 不替我实名、不绑定支付方式、不改账号安全设置。',
          '',
          '## 完成后告诉我',
          '- 结果：已领取 / 已开通 / 需要我做一步什么 / 无法领取（原因）',
          '- 实际拿到的额度与限制：可用多久、什么地区、要不要绑卡、有没有隐藏门槛',
          '- 如果页面和帖子说法不一致，指出差异'
        ].filter((line) => line !== null && line !== undefined).join('\n')
      }

      /**
       * 羊毛雷达的分类 = 价格维度（限免 / 免费 / 低价 / 一般）。
       * 「游戏」不是价格维度，它是内容类型、且有独立截止时间，所以放在单独的「游戏限免」页，
       * 不混进这一排筛选里。
       */
      const RADAR_CATEGORIES = [
        { id: 'limited', name: '限免' },
        { id: 'free', name: '免费' },
        { id: 'cheap', name: '低价' },
        { id: 'general', name: '一般' }
      ]

      /**
       * 把雷达条目按「价格类 / 游戏类」拆开。
       * 游戏按**截止时间最近的在最前**排（能领到比什么都重要），同截止时间再按新近。
       */
      function splitRadarItems(items) {
        const games = []
        const offers = []
        for (const item of items || []) {
          if (item?.category === 'game') games.push(item)
          else offers.push(item)
        }
        const deadline = (item) => {
          const time = Date.parse(item?.expiresAt)
          return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
        }
        games.sort((a, b) => {
          const byDeadline = deadline(a) - deadline(b)
          if (byDeadline !== 0) return byDeadline
          return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
        })
        return { games, offers }
      }

      /** X 榜单保留条数：抓取、合并、状态接口与界面文案共用这一个数字。 */
      const X_TOP_LIMIT = 200

      /**
       * 客户端与服务端之间的协议版本。
       *
       * 客户端产物与插件服务端是两条加载路径：换版本后服务端要等 Harness 重启才用上新代码，
       * 而客户端 bundle 打开即生效。没有这个握手，界面只会表现为「刷新没反应」。
       */
      const API_VERSION = 4

      /**
       * 写回规则：把「谁能改哪些字段」写给 Agent 看。
       * 界面每次保存都会整份写回，抓取任务也在写同一个文件；Agent 改动前必须知道边界。
       */
      const WRITE_RULES = [
        '## 写回规则（重要）',
        '- 只改 cards 与 topics（以及 lastReviewedAt）；不要动 linuxdo / x / radar——这三份榜单由工作台自己抓取，覆盖会丢数据。',
        '- 卡片没有 id 时，工作台会按「标题 + 分类」生成稳定 id；有 id 的卡片保持原 id 不变。',
        '- 用户写在卡片里的 note 与 flag 是用户数据：更新卡片时原样保留，不要清空。',
        '- 如果能发 HTTP 请求，`POST /api/intel-center/state` 会先校验再合并（榜单按 updatedAt 取新），比手改文件更安全；改文件时要自己保证 JSON 完整。'
      ]

      const RADAR_CATEGORY_LABEL = Object.fromEntries(RADAR_CATEGORIES.map((c) => [c.id, c.name]))

      /**
       * 雷达排序。
       * - score：按羊毛分从高到低（同分再看时间），默认口径——先看最值得薅的
       * - time：纯时间倒序，看「今天有什么新的」
       */
      function sortRadarItems(items, order = 'score') {
        const list = [...(items || [])]
        if (order === 'time') {
          return list.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
        }
        return list.sort((a, b) => {
          const byScore = (b.score || 0) - (a.score || 0)
          if (byScore !== 0) return byScore
          return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
        })
      }

      /** 按来源、分类、关键词过滤雷达条目。 */
      function filterRadar(items, { source = '', category = '', q = '' } = {}) {
        const needle = String(q || '').trim().toLowerCase()
        return (items || []).filter((item) => {
          if (source && item.source !== source) return false
          if (category && item.category !== category) return false
          if (!needle) return true
          const haystack = [item.title, item.excerpt, item.author, item.handle, item.url].join(' ').toLowerCase()
          return haystack.includes(needle)
        })
      }

      /** 相对时间：刚刚 / 3 小时前 / 2 天前。 */
      function relativeTime(iso, now = Date.now()) {
        const time = Date.parse(iso)
        if (Number.isNaN(time)) return ''
        const diff = Math.max(0, now - time)
        const minutes = Math.floor(diff / 60000)
        if (minutes < 1) return '刚刚'
        if (minutes < 60) return minutes + ' 分钟前'
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return hours + ' 小时前'
        const days = Math.floor(hours / 24)
        return days + ' 天前'
      }

      return { STATUS_LABEL, FLAGS, FLAG_LABEL, todayISO, formatWhen, filterCards, highlightCards, buildReviewPrompt, buildClaimPrompt, buildXPrompt, RADAR_CATEGORIES, RADAR_CATEGORY_LABEL, splitRadarItems, X_TOP_LIMIT, API_VERSION, sortRadarItems, filterRadar, relativeTime }
    })()
      /**
       * 羊毛大王 · 业务面板（customFrame：整页业务，按需再打开 AI 对话）
       *
       * 主任务全部在业务页完成：看今日重点、搜索筛选、展开卡片、写备注、标记状态。
       * 需要 AI 协助时才调用宿主 service.ensureSession() 创建/恢复本工作台会话，并把宿主传入的
       * conversation 节点放进右侧抽屉——不自己造聊天界面，也不在首次进入时自动建会话。
       */
      const React = require('react')
      const { useCallback, useEffect, useMemo, useRef, useState } = React
      const h = React.createElement

      const API = '/api/intel-center'
      const STYLE_ID = 'intel-center-style'

      const CSS = `
      .intel{container-type:inline-size;container-name:intel;position:relative;display:flex;flex-direction:row;height:100%;min-height:0;width:100%;font-size:13px;line-height:1.55;color:inherit;box-sizing:border-box;overflow:hidden}
      .intel *{box-sizing:border-box}
      .intel-main{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}
      .intel-head{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:flex-end;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid rgba(127,127,127,.18)}
      .intel-title{display:flex;flex-direction:column;gap:2px;min-width:0}
      .intel-title h1{margin:0;font-size:17px;font-weight:650;letter-spacing:.2px}
      .intel-sub{font-size:12px;opacity:.66}
      .intel-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .intel-btn{appearance:none;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.06);color:inherit;border-radius:7px;padding:6px 11px;font-size:12.5px;line-height:1.2;cursor:pointer;white-space:nowrap}
      .intel-btn:hover:not(:disabled){background:rgba(127,127,127,.14)}
      .intel-btn:disabled{opacity:.5;cursor:default}
      .intel-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#2f6fed);color:#fff;font-weight:600}
      .intel-btn-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-brand-primary,#2f6fed)}
      .intel-btn-ghost{border-color:transparent;background:transparent;padding:5px 8px}
      .intel-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px 8px;scrollbar-gutter:stable}
      .intel-panel{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
      .intel-empty{margin:6px 0 0;padding:22px;border:1px dashed rgba(127,127,127,.32);border-radius:10px;text-align:center;font-size:13px;opacity:.85}
      .intel-empty strong{display:block;font-size:14px;margin-bottom:6px;opacity:1}
      .intel-section{margin:0 0 16px}
      .intel-section h2{margin:0 0 8px;font-size:13px;font-weight:650;letter-spacing:.4px;opacity:.85;display:flex;align-items:center;gap:6px}
      .intel-count{font-weight:400;opacity:.6}
      .intel-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
      .intel-topcard{border:1px solid rgba(127,127,127,.2);border-left:3px solid var(--dsw-alias-brand-primary,#2f6fed);border-radius:9px;padding:10px 12px;background:rgba(127,127,127,.05);min-width:0;cursor:pointer}
      .intel-topcard:hover{background:rgba(127,127,127,.1)}
      .intel-topcard .t{font-weight:600;margin-bottom:4px;overflow-wrap:anywhere}
      .intel-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border:1px solid rgba(127,127,127,.18);border-radius:10px;margin:0 0 14px;background:rgba(127,127,127,.04)}
      .intel-search{flex:1 1 200px;min-width:150px;display:flex;align-items:center;gap:6px;border:1px solid rgba(127,127,127,.26);border-radius:7px;padding:5px 9px;background:rgba(127,127,127,.05)}
      .intel-search input{flex:1 1 auto;min-width:0;border:0;background:transparent;color:inherit;font-size:12.5px;outline:none}
      .intel-chip{border:1px solid rgba(127,127,127,.26);background:transparent;color:inherit;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
      .intel-chip[data-on='1']{background:var(--dsw-alias-brand-primary,#2f6fed);border-color:transparent;color:#fff;font-weight:600}
      .intel-select{border:1px solid rgba(127,127,127,.26);background:rgba(127,127,127,.05);color:inherit;border-radius:7px;padding:5px 8px;font-size:12.5px}
      .intel-tagset{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
      .intel-muted{opacity:.6}
      .intel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;align-items:start}
      .intel-card{border:1px solid rgba(127,127,127,.22);border-radius:11px;padding:12px 13px;background:rgba(127,127,127,.035);display:flex;flex-direction:column;gap:8px;min-width:0}
      .intel-card[data-flag='shortlist']{border-color:rgba(47,111,237,.5)}
      .intel-card[data-flag='used']{border-color:rgba(38,160,94,.55)}
      .intel-card[data-flag='dropped']{opacity:.62}
      .intel-card-head{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;min-width:0}
      .intel-card-title{margin:0;font-size:14px;font-weight:640;overflow-wrap:anywhere;min-width:0}
      .intel-score{flex:0 0 auto;display:inline-flex;align-items:baseline;gap:2px;font-variant-numeric:tabular-nums;border:1px solid rgba(127,127,127,.3);border-radius:7px;padding:2px 7px;font-size:12px;white-space:nowrap}
      .intel-score b{font-size:14px;font-weight:700}
      .intel-badges{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px}
      .intel-badge{border-radius:999px;padding:1px 8px;border:1px solid rgba(127,127,127,.28);white-space:nowrap}
      .intel-badge[data-tone='ok']{border-color:rgba(38,160,94,.5);color:rgba(28,120,70,.95)}
      .intel-badge[data-tone='warn']{border-color:rgba(214,146,26,.55);color:rgba(158,105,10,.95)}
      .intel-badge[data-tone='cat']{background:rgba(127,127,127,.1)}
      .intel-ul{margin:0;padding-left:17px;display:flex;flex-direction:column;gap:2px}
      .intel-ul li{overflow-wrap:anywhere}
      .intel-facts{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
      .intel-facts th,.intel-facts td{text-align:left;vertical-align:top;padding:3px 6px 3px 0;border-bottom:1px dashed rgba(127,127,127,.22);overflow-wrap:anywhere}
      .intel-facts th{width:38%;font-weight:600;opacity:.75}
      .intel-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .intel-two h4{margin:0 0 3px;font-size:12px;font-weight:650;opacity:.8}
      .intel-note{width:100%;min-height:54px;resize:vertical;border:1px solid rgba(127,127,127,.26);border-radius:8px;background:rgba(127,127,127,.04);color:inherit;font:inherit;font-size:12.5px;padding:6px 8px}
      .intel-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .intel-link{color:var(--dsw-alias-brand-primary,#2f6fed);text-decoration:none;overflow-wrap:anywhere}
      .intel-link:hover{text-decoration:underline}
      .intel-foot{border-top:1px solid rgba(127,127,127,.18);padding:10px 20px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;background:rgba(127,127,127,.04)}
      .intel-foot .meta{font-size:12px;opacity:.72;overflow-wrap:anywhere;min-width:0}
      .intel-drawer{flex:0 0 clamp(320px,38%,520px);min-width:280px;max-width:56%;display:flex;flex-direction:column;border-left:1px solid rgba(127,127,127,.22);min-height:0;background:rgba(127,127,127,.03)}
      .intel-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(127,127,127,.18);font-size:12.5px;font-weight:600}
      .intel-conv{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      .intel-conv-note{padding:12px;font-size:12.5px;opacity:.75}
      .intel-modal{position:absolute;inset:0;background:rgba(15,18,24,.42);display:flex;align-items:center;justify-content:center;padding:18px;z-index:5}
      .intel-modal-box{background:var(--dsw-alias-bg-l1,#fff);color:var(--dsw-alias-label-primary,#1f2328);border-radius:12px;max-width:720px;width:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.28)}
      .intel-modal-box header{padding:12px 16px;border-bottom:1px solid rgba(127,127,127,.2);font-weight:650;font-size:13.5px}
      .intel-modal-box .body{padding:12px 16px;overflow:auto;font-size:12.5px}
      .intel-modal-box footer{padding:10px 16px;border-top:1px solid rgba(127,127,127,.2);display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
      .intel-pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;line-height:1.6;background:rgba(127,127,127,.08);border-radius:8px;padding:10px;max-height:46vh;overflow:auto}
      .intel-err{color:#c0392b;font-size:12px;margin:6px 0 0}
      .intel-strip{display:flex;flex-direction:column;gap:6px;padding:10px 20px 0;flex:0 0 auto}
      .intel-notice{display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid rgba(214,146,26,.45);background:rgba(214,146,26,.12);border-radius:9px;padding:7px 10px;margin:0 0 12px;font-size:12.5px}
      .intel-tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid rgba(127,127,127,.18);flex:0 0 auto}
      .intel-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;font:inherit;font-size:12.5px;line-height:1.4;padding:8px 10px;cursor:pointer;opacity:.66;white-space:nowrap}
      .intel-tab:hover{opacity:.9}
      .intel-tab[data-on='1']{opacity:1;font-weight:650;border-bottom-color:var(--dsw-alias-brand-primary,#2f6fed)}
      .intel-body-fill{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;padding-bottom:10px}
      .intel-wool-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;flex:0 0 auto}
      .intel-wool-note{font-size:12.5px;min-width:0;overflow-wrap:anywhere}
      .intel-wool-frame{flex:1 1 auto;width:100%;min-height:300px;border:1px solid rgba(127,127,127,.22);border-radius:10px;background:#fff}
      .intel-wool-loading{font-size:12px;opacity:.7;flex:0 0 auto}
      .intel-list{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
      .intel-list-row{display:flex;gap:10px;align-items:flex-start;border:1px solid rgba(127,127,127,.18);border-radius:9px;padding:8px 10px;background:rgba(127,127,127,.03);min-width:0}
      .intel-rank{flex:0 0 26px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;opacity:.6}
      .intel-list-main{min-width:0;display:flex;flex-direction:column;gap:3px;flex:1 1 auto}
      .intel-list-title{color:inherit;font-weight:600;text-decoration:none;overflow-wrap:anywhere}
      .intel-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin:10px 0 0}
      .intel-tile{display:flex;flex-direction:column;gap:6px;border:1.5px solid var(--il-line);border-radius:3px;background:#fff;padding:10px 12px;text-decoration:none;color:inherit;min-width:0;transition:background .12s ease}
      .intel-tile:hover{background:var(--il-soft)}
      .intel-tile-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px}
      .intel-tile-title{font-weight:650;font-size:13px;line-height:1.45;overflow-wrap:anywhere}
      .intel-tile-desc{font-size:12px;color:var(--il-mute);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      /* ---- 雷达：参考图版式 ---- */
      .intel-radar{padding-top:0}
      .intel-stats{display:grid;grid-template-columns:1.1fr .9fr 1.1fr auto;gap:0;border-bottom:2px solid var(--il-line);align-items:stretch}
      .intel-stat{padding:12px 16px;border-right:1px solid rgba(127,127,127,.28);min-width:0}
      .intel-stat-label{font-size:12.5px;color:var(--il-mute)}
      .intel-stat-value{font-size:26px;font-weight:800;line-height:1.15;letter-spacing:-.5px}
      .intel-stat-cap{font-size:12.5px;font-weight:600;color:var(--il-mute)}
      .intel-stat-accent{color:#C0261A}
      .intel-stat-time{font-size:20px}
      .intel-stat-foot{font-size:11.5px;color:var(--il-mute);margin-top:2px}
      .intel-stat-actions{display:flex;align-items:center;padding:0 16px}
      .intel-segbar{display:flex;align-items:stretch;border-bottom:2px solid var(--il-line);overflow-x:auto}
      .intel-seg{appearance:none;border:0;border-right:1px solid rgba(127,127,127,.28);background:transparent;color:var(--il-ink);font:inherit;font-size:13px;font-weight:600;padding:10px 16px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px}
      .intel-seg:hover{background:var(--il-soft)}
      .intel-seg[data-on='1']{background:var(--il-ink);color:var(--il-bg)}
      .intel-seg-strong{font-weight:800}
      .intel-cat-strong{font-weight:800;border-width:2px}
      .intel-seg-count{font-size:11.5px;opacity:.6;font-weight:600}
      .intel-catrow{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(127,127,127,.28);flex-wrap:wrap}
      .intel-catrow-label{font-size:12.5px;color:var(--il-mute);min-width:32px}
      .intel-cat{appearance:none;border:1.5px solid var(--il-line);background:transparent;color:inherit;font:inherit;font-size:12.5px;font-weight:600;padding:5px 12px;cursor:pointer}
      .intel-cat[data-on='1']{background:var(--il-ink);color:var(--il-bg);border-color:var(--il-ink)}
      .intel-tagrow{display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid rgba(127,127,127,.28);flex-wrap:wrap}
      .intel-taglist{display:flex;align-items:center;gap:18px;flex:1 1 auto;overflow-x:auto}
      .intel-tag{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--il-mute);font:inherit;font-size:15px;font-weight:700;padding:4px 2px;cursor:pointer;white-space:nowrap}
      .intel-tag[data-on='1']{color:#C0261A;border-bottom-color:#C0261A}
      .intel-tagsearch{flex:0 0 auto;width:180px;border:1px solid rgba(127,127,127,.5);background:transparent;color:inherit;font:inherit;font-size:12.5px;padding:5px 8px}
      .intel-kwrow{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid rgba(127,127,127,.28);flex-wrap:wrap}
      .intel-kwlabel{font-size:12.5px;color:var(--il-mute);min-width:32px}
      .intel-kw{appearance:none;border:1.5px solid var(--il-line);background:transparent;color:inherit;font:inherit;font-size:12.5px;font-weight:600;padding:3px 10px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
      .intel-kw[data-on='1']{background:var(--il-ink);color:var(--il-bg)}
      .intel-kw-strong{font-weight:800}
      .intel-kw-count{font-size:11px;opacity:.6}
      .intel-band{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--il-ink);color:var(--il-bg);font-size:14px;font-weight:800;letter-spacing:.4px;padding:9px 16px;margin:14px 0 0}
      .intel-band-sub{font-size:12px;font-weight:600;opacity:.75}
      .intel-feed{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px;margin-top:12px}
      .intel-post{display:flex;flex-direction:column;gap:5px;padding:11px 12px;border:1.5px solid var(--il-line);border-radius:3px;background:#fff;text-decoration:none;color:inherit;min-width:0}
      .intel-post:hover{background:var(--il-soft)}
      .intel-post-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11.5px;color:var(--il-mute);margin:0}
      .intel-post-src{font-weight:800;color:var(--il-ink);opacity:.9}
      .intel-chip-tag{border:1.5px solid var(--il-line);padding:0 7px;font-size:11.5px;font-weight:700}
      .intel-chip-tag[data-tag='free']{color:#1F7A45;border-color:#1F7A45}
      .intel-chip-tag[data-tag='limited']{color:#B5460F;border-color:#B5460F}
      .intel-chip-tag[data-tag='cheap']{color:#1F5AA8;border-color:#1F5AA8}
      .intel-post-time{margin-left:auto}
      .intel-woolscore{border:1px solid currentColor;padding:0 6px;font-weight:800;font-size:11px;letter-spacing:.2px}
      .intel-woolscore[data-tier='hot']{color:#C0261A;background:rgba(192,38,26,.10)}
      .intel-woolscore[data-tier='warm']{color:#B5460F}
      .intel-woolscore[data-tier='cool']{color:#6B6B6B}
      .intel-verify{font-size:10.5px;padding:0 5px;border:1px dashed currentColor;opacity:.9;white-space:nowrap}
      .intel-verify[data-verdict='free']{color:#1F7A45;border-style:solid;border-color:#1F7A45}
      .intel-verify[data-verdict='conditional']{color:#B5460F;border-color:#B5460F}
      .intel-verify[data-verdict='discount']{color:#1F5AA8;border-color:#1F5AA8}
      .intel-verify[data-verdict='unknown']{color:#777;opacity:.7}
      .intel-deadline{font-size:11px;font-weight:700;padding:0 6px;border:1px solid currentColor;white-space:nowrap}
      .intel-deadline[data-urgent='1']{color:#C0261A;background:rgba(192,38,26,.08)}
      .intel-post-title{margin:0;font-size:15px;line-height:1.45;font-weight:700;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .intel-post-desc{margin:0;font-size:12px;line-height:1.55;color:var(--il-mute);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .intel-post-by{font-size:12.5px;color:var(--il-mute)}
      a.intel-post-title{color:inherit;text-decoration:none}
      a.intel-post-title:hover{text-decoration:underline}
      .intel-post-actions{display:flex;align-items:center;gap:10px;margin-top:2px;font-size:12px}
      .intel-post-actions .intel-btn{padding:2px 8px;font-size:11.5px}
      .intel-post-actions .intel-link{font-size:12px}
      /* ---- 外层：分段式 tab（与参考图一致）---- */
      .intel .intel-tabs{display:flex;align-items:stretch;border-bottom:2px solid var(--il-line);padding:0;overflow-x:auto;background:transparent}
      .intel .intel-tab{appearance:none;border:0;border-right:1px solid rgba(127,127,127,.28);background:transparent;color:var(--il-ink);font:inherit;font-size:13.5px;font-weight:700;padding:11px 18px;cursor:pointer;white-space:nowrap;display:flex;gap:7px;align-items:center;opacity:1}
      .intel .intel-tab:hover{background:var(--il-soft)}
      .intel .intel-tab[data-on='1']{background:var(--il-ink);color:var(--il-bg);border-bottom-color:var(--il-ink)}
      .intel .intel-tab-count{font-size:11.5px;opacity:.62;font-weight:600}
      .intel .intel-tab-sep{display:flex;align-items:center;padding:0 6px;color:rgba(127,127,127,.45);font-size:12px}
      .intel .intel-tab-src{font-weight:600;font-size:12.5px;padding:11px 13px;opacity:.85}
      .intel .intel-tab-src[data-on='1']{background:#C0261A;color:#FFFDF7;opacity:1}
      .intel-list-title:hover{text-decoration:underline;color:var(--dsw-alias-brand-primary,#2f6fed)}
      @container intel (max-width: 760px){
        .intel{flex-direction:column}
        .intel-drawer{flex:0 0 auto;max-width:none;width:100%;max-height:56%;border-left:0;border-top:1px solid rgba(127,127,127,.22)}
        .intel-grid{grid-template-columns:1fr}
        .intel-two{grid-template-columns:1fr}
        .intel-head,.intel-body,.intel-foot,.intel-strip{padding-left:12px;padding-right:12px}
        .intel-list-row{flex-wrap:wrap}
        .intel-rank{flex:0 0 20px}
        .intel-badges{gap:4px}
        .intel-tab{padding:8px 8px;font-size:12px}
        .intel-title h1{font-size:16px}
      }
      /* ---- 视觉：Pentagram 编辑风（花叔 skill 的 Professional/Editorial 预设）---- */
      .intel{--il-bg:#FFFDF7;--il-ink:#1A1A1A;--il-line:rgba(26,26,26,.82);--il-soft:rgba(26,26,26,.06);--il-accent:#D4480B;--il-mute:rgba(26,26,26,.56);background:var(--il-bg);color:var(--il-ink)}
      .intel .intel-head{border-bottom:2px solid var(--il-line);gap:8px 16px}
      .intel .intel-title h1{font-size:19px;letter-spacing:-.2px;font-weight:700}
      .intel .intel-sub{opacity:1;color:var(--il-mute)}
      .intel .intel-tabs{border-bottom:2px solid var(--il-line);padding:0 20px}
      .intel .intel-tab{opacity:1;color:var(--il-mute);font-size:12.5px;letter-spacing:.2px;padding:9px 12px}
      .intel .intel-tab[data-on='1']{color:var(--il-accent);border-bottom-color:var(--il-accent);font-weight:700}
      .intel .intel-btn{border:1.5px solid var(--il-line);background:transparent;border-radius:2px;font-weight:600}
      .intel .intel-btn:hover:not(:disabled){background:var(--il-soft)}
      .intel .intel-btn-warn{border-color:var(--il-accent);color:var(--il-accent);font-weight:700}
      .intel .intel-btn-strong{font-weight:800;border-width:2px}
      .intel .intel-btn-primary{background:var(--il-accent);border-color:var(--il-accent);color:#FFFDF7}
      .intel .intel-btn-primary:hover:not(:disabled){background:var(--il-accent);filter:brightness(.92)}
      .intel .intel-card,.intel .intel-topcard,.intel .intel-list-row{border:1.5px solid var(--il-line);border-radius:3px;background:#fff}
      .intel .intel-topcard{border-left:4px solid var(--il-accent)}
      .intel .intel-section h2{text-transform:none;letter-spacing:.6px;font-size:12px;color:var(--il-mute)}
      .intel .intel-badge{border-radius:2px;border:1px solid var(--il-line);font-size:11px;letter-spacing:.2px}
      .intel .intel-badge[data-tone='cat']{background:var(--il-soft)}
      .intel .intel-chip{border-radius:2px;border:1px solid var(--il-line);font-weight:600}
      .intel .intel-chip[data-on='1']{background:var(--il-ink);border-color:var(--il-ink);color:#FFFDF7}
      .intel .intel-filters{border:1.5px solid var(--il-line);border-radius:3px;background:#fff}
      .intel .intel-search,.intel .intel-select,.intel .intel-note{border:1px solid var(--il-line);border-radius:2px;background:#fff}
      .intel .intel-score{border:1.5px solid var(--il-line);border-radius:2px}
      .intel .intel-rank{font-weight:800;color:var(--il-accent);opacity:1}
      .intel .intel-list-title{font-weight:650}
      .intel .intel-link{color:var(--il-accent)}
      .intel .intel-foot{border-top:2px solid var(--il-line);background:#fff}
      .intel .intel-drawer{border-left:2px solid var(--il-line);background:#fff}
      @media (prefers-color-scheme: dark){.intel{--il-bg:#15120E;--il-ink:#F2ECE1;--il-line:rgba(242,236,225,.72);--il-soft:rgba(242,236,225,.10);--il-accent:#FF6B35;--il-mute:rgba(242,236,225,.62)}.intel .intel-card,.intel .intel-topcard,.intel .intel-list-row,.intel .intel-filters,.intel .intel-foot,.intel .intel-drawer,.intel .intel-search,.intel .intel-select,.intel .intel-note{background:#1D1915}.intel .intel-chip[data-on='1']{background:var(--il-accent);border-color:var(--il-accent);color:#15120E}.intel .intel-tile{background:#1D1915}.intel .intel-post{background:#1D1915}}
      `

      function ensureStyle() {
        if (typeof document === 'undefined') return
        if (document.getElementById(STYLE_ID)) return
        const el = document.createElement('style')
        el.id = STYLE_ID
        el.textContent = CSS
        document.head.appendChild(el)
      }


      async function apiFetch(path, init) {
        const response = await fetch(API + path, {
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          ...init
        })
        let payload = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        if (!response.ok) throw new Error(payload?.error || `请求失败（${response.status}）`)
        return payload
      }


      /** 本地日期（YYYY-MM-DD）：榜单的「今日」按用户时区算，不拿 UTC 字符串截断。 */
      function localDayOf(iso) {
        const time = Date.parse(iso)
        if (Number.isNaN(time)) return ''
        const date = new Date(time)
        const pad = (n) => String(n).padStart(2, '0')
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      }

      /** 有截止时间的条目（Epic 限免）：显示还剩几天，2 天内标红。 */
      function deadlineChip(iso) {
        const time = Date.parse(iso)
        if (!Number.isFinite(time)) return null
        const days = Math.ceil((time - Date.now()) / 86400000)
        return h('span', { className: 'intel-deadline', 'data-urgent': days <= 2 ? '1' : '0' },
          days <= 0 ? '今天截止' : `${days} 天后截止`)
      }

      function ScorePill({ score }) {
        return h('span', { className: 'intel-score', title: '适用场景评分（1-5）' },
          h('b', null, Number(score || 0)),
          h('span', { className: 'intel-muted' }, '/5'))
      }

      function StatusBadge({ status }) {
        const tone = status === 'confirmed' ? 'ok' : 'warn'
        return h('span', { className: 'intel-badge', 'data-tone': tone }, STATUS_LABEL[status] || '待验证')
      }

      function CardFacts({ facts }) {
        if (!facts || facts.length === 0) return null
        return h('table', { className: 'intel-facts' },
          h('tbody', null, facts.map((fact, index) =>
            h('tr', { key: index },
              h('th', { scope: 'row' }, fact.label),
              h('td', null, fact.value)))))
      }

      function Card({ card, expanded, onToggle, onChangeNote, onChangeFlag }) {
        const tags = card.tags || []
        return h('article', { className: 'intel-card', 'data-flag': card.flag || 'none' },
          h('div', { className: 'intel-card-head' },
            h('h3', { className: 'intel-card-title' },
              card.priority === 'high' ? '★ ' : '',
              card.title),
            h(ScorePill, { score: card.score })),

          h('div', { className: 'intel-badges' },
            h('span', { className: 'intel-badge', 'data-tone': 'cat' }, card.category),
            h(StatusBadge, { status: card.status }),
            tags.slice(0, 4).map((tag) => h('span', { key: tag, className: 'intel-badge' }, `#${tag}`)),
            card.verifiedAt ? h('span', { className: 'intel-muted' }, `核实 ${card.verifiedAt}`) : h('span', { className: 'intel-muted' }, '未核实')),

          card.summary && card.summary.length > 0
            ? h('ul', { className: 'intel-ul' }, card.summary.slice(0, expanded ? 6 : 3).map((item, index) =>
              h('li', { key: index }, item)))
            : null,

          expanded ? h('div', { className: 'intel-section' },
            h('h4', null, '数据与规格'),
            h(CardFacts, { facts: card.facts }),
            h('div', { className: 'intel-two', style: { marginTop: '8px' } },
              h('div', null,
                h('h4', null, '优点'),
                h('ul', { className: 'intel-ul' }, (card.pros || []).map((item, index) => h('li', { key: index }, item)))),
              h('div', null,
                h('h4', null, '坑点与提醒'),
                h('ul', { className: 'intel-ul' }, (card.cons || []).map((item, index) => h('li', { key: index }, item))))),
            card.signup ? h('p', { className: 'intel-muted', style: { margin: '8px 0 0' } }, `注册条件：${card.signup}`) : null,
            card.scoreReason ? h('p', { className: 'intel-muted', style: { margin: '4px 0 0' } }, `评分理由：${card.scoreReason}`) : null,
            card.nextAction ? h('p', { style: { margin: '8px 0 0' } }, h('strong', null, '下一步：'), card.nextAction) : null,
            (card.sources || []).length > 0 ? h('div', { style: { marginTop: '8px' } },
              h('h4', null, '来源'),
              h('ul', { className: 'intel-ul' }, card.sources.map((source, index) =>
                h('li', { key: index },
                  h('a', { className: 'intel-link', href: source.url, target: '_blank', rel: 'noreferrer noopener' },
                    source.title || source.url))))) : null
          ) : null,

          h('div', { className: 'intel-row' },
            h('button', {
              className: 'intel-btn intel-btn-ghost',
              onClick: () => onToggle(card.id),
              'aria-expanded': expanded ? 'true' : 'false'
            }, expanded ? '收起详情' : '展开详情'),
            h('select', {
              className: 'intel-select',
              value: card.flag || 'none',
              'aria-label': `标记「${card.title}」的处理状态`,
              onChange: (event) => onChangeFlag(card.id, event.target.value)
            }, FLAGS.map(([value, label]) => h('option', { key: value, value }, label)))),

          expanded ? h('label', { style: { display: 'block' } },
            h('span', { className: 'intel-muted', style: { fontSize: '12px' } }, '我的备注'),
            h('textarea', {
              className: 'intel-note',
              value: card.note || '',
              placeholder: '记下试用情况、可用区域、遇到的坑……（自动保存）',
              onChange: (event) => onChangeNote(card.id, event.target.value)
            })) : (card.note ? h('p', { className: 'intel-muted', style: { margin: 0 } }, `备注：${card.note}`) : null)
        )
      }

      function Panel(props) {
        const service = props.service
        const conversation = props.conversation

        const [state, setState] = useState(null)
        const [meta, setMeta] = useState(null)
        const [loading, setLoading] = useState(true)
        const [error, setError] = useState('')
        const [savedAt, setSavedAt] = useState('')
        const [q, setQ] = useState('')
        const [category, setCategory] = useState('')
        const [status, setStatus] = useState('')
        const [flag, setFlag] = useState('')
        const [minScore, setMinScore] = useState('')
        const [expanded, setExpanded] = useState({})
        const [convOpen, setConvOpen] = useState(false)
        const [convBusy, setConvBusy] = useState(false)
        const [notice, setNotice] = useState('')
        const [xStatus, setXStatus] = useState(null)
        const [xBusy, setXBusy] = useState(false)
        const [radarSource, setRadarSource] = useState('')
        const [radarCategory, setRadarCategory] = useState('')
        const [radarQuery, setRadarQuery] = useState('')
        const [radarKeyword, setRadarKeyword] = useState('')
        const [radarSince, setRadarSince] = useState('')
        const [radarOrder, setRadarOrder] = useState('score')
        const [radarStatus, setRadarStatus] = useState(null)
        const [radarBusy, setRadarBusy] = useState(false)
        const [elapsed, setElapsed] = useState(0)
        const [serverOutdated, setServerOutdated] = useState(false)
        const [promptText, setPromptText] = useState('')
        const [promptKind, setPromptKind] = useState('review')
        const [copied, setCopied] = useState('')
        const [tab, setTab] = useState('radar')
        const [woolKey, setWoolKey] = useState(0)
        const [woolForce, setWoolForce] = useState(false)
        const [woolLoading, setWoolLoading] = useState(false)
        const [unsaved, setUnsaved] = useState(false)
        const saveTimer = useRef(null)
        const noticeTimer = useRef(null)
        const prevJobRunning = useRef(false)
        const loadSeq = useRef(0)
        const baseRef = useRef('')

        useEffect(() => { ensureStyle() }, [])

        const load = useCallback(async () => {
          // 连点「刷新」时只认最后一次响应，旧响应不能把新数据盖回去。
          const seq = loadSeq.current + 1
          loadSeq.current = seq
          setLoading(true)
          setError('')
          try {
            const [statePayload, metaPayload] = await Promise.all([
              apiFetch('/state'),
              apiFetch('/meta').catch(() => null)
            ])
            if (seq !== loadSeq.current) return
            setState(statePayload.state)
            baseRef.current = statePayload.state?.updatedAt || ''
            if (metaPayload) {
              setMeta(metaPayload)
              // 客户端换版立即生效，服务端要等 Harness 重启。版本对不上时明说，
              // 否则用户只会看到「刷新没反应」，以为是功能坏了。
              setServerOutdated(Number(metaPayload.apiVersion) !== API_VERSION)
            }
          } catch (caught) {
            if (seq === loadSeq.current) setError(caught?.message || '读取情报数据失败。')
          } finally {
            if (seq === loadSeq.current) setLoading(false)
          }
        }, [])

        useEffect(() => { void load() }, [load])
        useEffect(() => () => {
          if (saveTimer.current) clearTimeout(saveTimer.current)
          if (noticeTimer.current) clearTimeout(noticeTimer.current)
          // 关掉工作台时还有没保存的改动：用 sendBeacon 补最后一次，别让用户白写备注。
          const pending = stateRef.current
          if (pending && unsavedRef.current) {
            try {
              const body = new Blob([JSON.stringify({ ...pending, baseUpdatedAt: baseRef.current })], { type: 'application/json' })
              navigator?.sendBeacon?.(API + '/state', body)
            } catch {
              /* 关页面时没别的办法，下次打开还会读到旧值 */
            }
          }
        }, [])

        const loadXStatus = useCallback(async () => {
          try {
            const payload = await apiFetch('/x/status')
            setXStatus(payload)
          } catch {
            /* 状态只是辅助信息，取不到不影响榜单展示 */
          }
        }, [])

        useEffect(() => { void loadXStatus() }, [loadXStatus])

        const loadRadarStatus = useCallback(async () => {
          try {
            setRadarStatus(await apiFetch('/radar/status'))
          } catch {
            /* 状态是辅助信息 */
          }
        }, [])

        useEffect(() => { void loadRadarStatus() }, [loadRadarStatus])

        // 服务端自己也在跑定时任务：按钮的「正在抓取」要跟着服务端状态走，不能只信本地这次请求。
        const radarRunning = Boolean(radarBusy || radarStatus?.job?.running)
        const xRunning = Boolean(xBusy || xStatus?.job?.running)
        const jobsRunning = radarRunning || xRunning

        // 后台任务结束（包含在别处跑完的）时自动拉一次数据，用户不用手动刷新。
        useEffect(() => {
          if (prevJobRunning.current && !jobsRunning) void load()
          prevJobRunning.current = jobsRunning
        }, [jobsRunning, load])

        // 有任务在跑时低速轮询状态。
        useEffect(() => {
          if (!jobsRunning) return undefined
          const timer = setInterval(() => {
            void loadRadarStatus()
            void loadXStatus()
          }, 4000)
          return () => clearInterval(timer)
        }, [jobsRunning, loadRadarStatus, loadXStatus])

        // 抓取期间每秒走一格：用户点下去立刻能看到「确实开始了、已经跑了多久」。
        useEffect(() => {
          if (!jobsRunning) {
            setElapsed(0)
            return undefined
          }
          const startedAtLocal = Date.now()
          setElapsed(0)
          const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAtLocal) / 1000)), 1000)
          return () => clearInterval(timer)
        }, [jobsRunning])

        // Esc 关掉提示词弹窗：模态开着时键盘只有一个出口才不别扭。
        useEffect(() => {
          if (!promptText) return undefined
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setPromptText('')
          }
          window.addEventListener('keydown', onKeyDown)
          return () => window.removeEventListener('keydown', onKeyDown)
        }, [promptText])

        // 强制刷新羊毛页后，即使 iframe 的 load 事件没来也要把 force 复位，
        // 否则之后每次切到这个标签页都会绕过缓存重新回源。
        useEffect(() => {
          if (!woolForce) return undefined
          const timer = setTimeout(() => setWoolForce(false), 10000)
          return () => clearTimeout(timer)
        }, [woolForce, woolKey])

        /** 提示条：成功类几秒后自动消失，失败与「正在跑」类留在页面上等用户处理。 */
        const notify = useCallback((text, { sticky = false } = {}) => {
          if (noticeTimer.current) clearTimeout(noticeTimer.current)
          setNotice(text)
          if (!sticky && text) {
            noticeTimer.current = setTimeout(() => setNotice(''), 12000)
          }
        }, [])

        /** 抓取在后台跑，这里轮询状态直到这一轮结束（最多等 3 分钟）。 */
        const waitForJob = useCallback(async (kind) => {
          const deadline = Date.now() + 180000
          for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 1500))
            const status = await apiFetch(`/${kind}/status`).catch(() => null)
            if (status) {
              if (kind === 'radar') setRadarStatus(status)
              else setXStatus(status)
              if (!status.job?.running) return status
            }
            if (Date.now() > deadline) return null
          }
        }, [])

        const runRefresh = useCallback(async (kind) => {
          const isRadar = kind === 'radar'
          const label = isRadar ? '羊毛雷达' : 'X 榜单'
          const setBusy = isRadar ? setRadarBusy : setXBusy
          setBusy(true)
          notify(`已启动：正在抓取${label}，右边按钮开始计时。可以切到别的标签页，抓完这里会给结果。`, { sticky: true })
          try {
            const started = await apiFetch(`/${kind}/refresh`, {
              method: 'POST',
              body: JSON.stringify({ reason: 'manual' })
            })
            if (started?.skipped) notify(`${label}上一轮还在抓（不是没反应），等它结束再试。`, { sticky: true })
            const finalStatus = await waitForJob(kind)
            const snapshot = finalStatus?.job
            await load()
            const seconds = Math.max(1, Math.round((snapshot?.durationMs || 0) / 1000))
            if (snapshot?.status === 'succeeded') {
              const result = snapshot.result || {}
              const bySource = result.bySource || {}
              const breakdown = Object.keys(bySource).length
                ? '（' + Object.entries(bySource).map(([id, count]) => `${RADAR_SOURCE_LABEL[id] || id} ${count}`).join(' / ') + '）'
                : ''
              const failed = (result.errors || []).length ? `；个别来源失败：${result.errors.join('、')}` : ''
              notify(`${label}抓取完成 · 用时 ${seconds} 秒 · 本轮 ${result.fresh ?? 0} 条${breakdown} · 在库 ${result.count ?? 0} 条${failed}`)
            } else if (snapshot?.status === 'failed') {
              notify(`${label}抓取失败（用时 ${seconds} 秒）：${snapshot.error || '原因未记录'}。可以再试一次；X 需要 Chrome 开着远程调试，且 web-access 的 CDP 代理（localhost:3456）在运行。`, { sticky: true })
            } else {
              notify(`${label}还在后台抓（已经在计时），回到这个页面会自动更新。`, { sticky: true })
            }
          } catch (caught) {
            notify(`${label}没能启动：${caught?.message || caught}`, { sticky: true })
          } finally {
            setBusy(false)
          }
        }, [load, notify, waitForJob])

        const refreshRadarNow = useCallback(() => runRefresh('radar'), [runRefresh])
        const refreshXNow = useCallback(() => runRefresh('x'), [runRefresh])

        const persist = useCallback(async (next, attempt = 0) => {
          try {
            const payload = await apiFetch('/state', {
              method: 'POST',
              // baseUpdatedAt 让服务端知道「我这一份是基于哪一版读出来的」，别处改过时它会合并而不是覆盖。
              body: JSON.stringify({ ...next, baseUpdatedAt: baseRef.current })
            })
            setSavedAt(new Date().toISOString())
            setUnsaved(false)
            setError('')
            baseRef.current = payload?.state?.updatedAt || baseRef.current
            if (payload?.conflict) {
              notify('检测到卡片在别处被改过，已自动合并，没有覆盖对方新增的内容。')
            }
            // 服务端合并后的结果就是最新真相；本地没有更新改动时直接采用，避免界面与文件不一致。
            if (payload?.state && stateRef.current === next) {
              stateRef.current = payload.state
              setState(payload.state)
            }
            // 保存期间又改过：再存一次，避免最后一次编辑只留在内存里。
            const latest = stateRef.current
            if (latest && latest !== next && latest !== payload?.state) {
              if (saveTimer.current) clearTimeout(saveTimer.current)
              saveTimer.current = setTimeout(() => { void persist(latest) }, 400)
            }
          } catch (caught) {
            const reason = caught?.message || '网络中断'
            if (attempt < 2) {
              setUnsaved(true)
              setError(`保存失败：${reason}；正在自动重试（第 ${attempt + 1} 次）…`)
              if (saveTimer.current) clearTimeout(saveTimer.current)
              saveTimer.current = setTimeout(() => {
                void persist(stateRef.current || next, attempt + 1)
              }, 1000 * (attempt + 1))
              return
            }
            setUnsaved(true)
            setError(`保存失败：${reason}。改动还在页面上，点右上角「重试保存」；关掉工作台会丢。`)
          }
        }, [])

        const retrySave = useCallback(() => {
          const latest = stateRef.current
          if (latest) void persist(latest)
        }, [persist])

        // 用 ref 拿最新状态再算下一版：副作用不放进 setState 更新函数，StrictMode 下也不会重复排定时器。
        const stateRef = useRef(state)
        stateRef.current = state
        const unsavedRef = useRef(false)
        unsavedRef.current = unsaved

        const update = useCallback((mutator) => {
          const current = stateRef.current
          if (!current) return
          const draft = {
            ...current,
            cards: current.cards.map((card) => ({ ...card })),
            topics: [...(current.topics || [])]
          }
          const next = mutator(draft)
          stateRef.current = next
          setState(next)
          setUnsaved(true)
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => { void persist(next) }, 700)
        }, [persist])

        const cards = state?.cards || []
        const topics = state?.topics || []
        const categories = useMemo(() => {
          const seen = new Map()
          for (const card of cards) seen.set(card.category, (seen.get(card.category) || 0) + 1)
          return [...seen.entries()].sort((a, b) => b[1] - a[1])
        }, [cards])

        const visible = useMemo(
          () => filterCards(cards, { q, category, status, minScore, flag }),
          [cards, q, category, status, minScore, flag])
        const highlights = useMemo(() => highlightCards(cards, 3), [cards])
        const xFeed = state?.x || { updatedAt: '', date: '', keywords: [], items: [] }
        const xItems = xFeed.items || []
        // 展示顺序一律按发布时间倒序：旧版本写进文件的是点赞序，这里不依赖文件里的顺序。
        const xShown = [...xItems].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
        const radarFeed = state?.radar || { updatedAt: '', date: '', items: [] }
        const radarItems = radarFeed.items || []
        // 价格维度（限免/免费/低价/一般）与内容类型（游戏限免）分开：游戏单独一页，按截止时间排。
        const { games: gameItems, offers: offerItems } = splitRadarItems(radarItems)
        const RADAR_SOURCE_LABEL = {
          linuxdo: 'LINUX DO',
          nodeseek: 'NodeSeek',
          v2ex: 'V2EX',
          appinn: '小众软件',
          ghxi: '果核剥壳',
          iplaysoft: '异次元',
          epic: 'Epic'
        }

        // 时间表只有一处真值（服务端 RUN_HOURS），界面把它渲染出来，不另写一份文案。
        const runHoursText = (radarStatus?.hours || [8, 12, 16, 20])
          .map((hour) => `${String(hour).padStart(2, '0')}:00`).join(' / ')

        /**
         * 「上次跑成什么样」的常驻说明。
         * 提示条十几秒后会消失，但用户需要一个随时能确认「刚才那下到底成功没有」的地方。
         */
        const describeJob = (job) => {
          if (!job) return ''
          if (job.status === 'running') return '正在抓取…'
          if (job.status === 'failed') return `上次失败：${String(job.error || '原因未记录').slice(0, 60)}`
          if (!job.result) return ''
          const seconds = Math.max(1, Math.round((job.durationMs || 0) / 1000))
          const parts = Object.entries(job.result.bySource || {})
            .map(([id, count]) => `${RADAR_SOURCE_LABEL[id] || id} ${count}`)
          return `上次抓到 ${job.result.fresh ?? 0} 条 · 用时 ${seconds}s${parts.length ? '（' + parts.join(' / ') + '）' : ''}`
        }

        const radarVisible = useMemo(() => filterRadar(offerItems, { source: radarSource, category: radarCategory, q: radarQuery }), [offerItems, radarSource, radarCategory, radarQuery])
        const radarSourcesPresent = useMemo(() => { const seen = new Map(); for (const item of offerItems) seen.set(item.source, (seen.get(item.source) || 0) + 1); return [...seen.entries()] }, [offerItems])

        const activeFilters = Boolean(q || category || status || flag || minScore)
        const resetFilters = () => { setQ(''); setCategory(''); setStatus(''); setFlag(''); setMinScore('') }

        const [folderConfirmed, setFolderConfirmed] = useState(false)
        const openConversation = useCallback(async () => {
          if (convOpen) { setConvOpen(false); return }
          setNotice('')
          try {
            const existing = typeof service?.currentSession === 'function' ? service.currentSession() : null
            if (!existing && !folderConfirmed) {
              // 首次要选一个资料文件夹，系统弹的是「文件夹」选择框而不是上传文件框，先说清楚再弹。
              setFolderConfirmed(true)
              notify('第一次用 AI 对话要先选一个「资料文件夹」：再点一次按钮会弹出系统的文件夹选择框（不是上传文件）。选好后会话就建在这个目录里。', { sticky: true })
              return
            }
            setConvBusy(true)
            if (!existing) {
              if (typeof service?.newWorkspaceSession !== 'function') {
                throw new Error('当前 Desktop 版本不支持在工作台内新建会话，请用左侧栏「新会话」后再打开。')
              }
              // 由宿主弹出目录选择器：用户选目录（或新建）才创建知识库与工作台会话；取消则什么都不留。
              const created = await service.newWorkspaceSession()
              const hasNow = typeof service?.currentSession === 'function' ? service.currentSession() : null
              if (!created && !hasNow) {
                notify('已取消选择资料位置，没有创建会话。')
                return
              }
            }
            setConvOpen(true)
          } catch (caught) {
            notify(caught?.message || '无法创建本工作台的会话，请检查工作台是否已启用。', { sticky: true })
          } finally {
            setConvBusy(false)
          }
        }, [convOpen, folderConfirmed, notify, service])

        const prepareReview = useCallback(async () => {
          const text = buildReviewPrompt({
            topics,
            cards,
            dataFile: meta?.file || '',
            today: todayISO()
          })
          setPromptText(text)
          setPromptKind('review')
          setCopied('')
          try {
            if (navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText(text)
              setCopied('提示词已复制到剪贴板，直接粘贴到对话里发送即可。')
            } else {
              setCopied('已生成，但当前环境不允许自动复制：点「复制提示词」再手动粘贴。')
            }
          } catch {
            setCopied('提示词已生成，请点「复制提示词」再粘贴到对话里。')
          }
        }, [cards, meta, topics])

        const prepareX = useCallback(async () => {
          const text = buildXPrompt({
            date: todayISO(),
            keywords: (xFeed.keywords && xFeed.keywords.length) ? xFeed.keywords : ['羊毛', '薅'],
            dataFile: meta?.file || '',
            existing: xItems
          })
          setPromptText(text)
          setPromptKind('x')
          setCopied('')
          try {
            if (navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText(text)
              setCopied('抓取指令已复制。发到 AI 对话里，它会用 web-access skill 通过你 Chrome 的登录态抓取。')
            } else {
              setCopied('已生成，但当前环境不允许自动复制：点「复制提示词」再手动粘贴。')
            }
          } catch {
            setCopied('抓取指令已生成，请点「复制提示词」再粘贴到对话里。')
          }
        }, [meta, xFeed.keywords, xItems])

        /** 「AI 帮领」：只对非游戏条目生成领取指令；游戏仍由用户自己点「去领取」。 */
        const prepareClaim = useCallback(async (item) => {
          const text = buildClaimPrompt({ item, today: todayISO() })
          setPromptText(text)
          setPromptKind('claim')
          setCopied('')
          try {
            if (navigator?.clipboard?.writeText) {
              await navigator.clipboard.writeText(text)
              setCopied('领取指令已复制：发到 AI 对话里，它会打开页面按步骤领取。')
            } else {
              setCopied('已生成，但当前环境不允许自动复制：点「复制提示词」再手动粘贴。')
            }
          } catch {
            setCopied('领取指令已生成，请点「复制提示词」再粘贴到对话里。')
          }
        }, [])

        const copyPrompt = useCallback(async () => {
          try {
            await navigator.clipboard.writeText(promptText)
            setCopied('已复制。')
          } catch {
            setCopied('复制失败，请手动全选复制。')
          }
        }, [promptText])

        const onChangeNote = useCallback((id, note) => {
          update((draft) => {
            const card = draft.cards.find((item) => item.id === id)
            if (card) card.note = note
            return draft
          })
        }, [update])

        const onChangeFlag = useCallback((id, nextFlag) => {
          update((draft) => {
            const card = draft.cards.find((item) => item.id === id)
            if (card) card.flag = nextFlag
            return draft
          })
        }, [update])

        const toggleCard = (id) => setExpanded((current) => ({ ...current, [id]: !current[id] }))

        const header = h('div', { className: 'intel-head' },
          h('div', { className: 'intel-title' },
            h('h1', null, '羊毛大王'),
            h('span', { className: 'intel-sub' },
              topics.length > 0 ? `关注主题：${topics.map((topic) => topic.title).join('、')}` : '还没有关注主题'),
            h('span', { className: 'intel-sub' },
              `${cards.length} 张卡片 · 已确认 ${cards.filter((card) => card.status === 'confirmed').length} · 待验证 ${cards.filter((card) => card.status !== 'confirmed').length}`)),
          h('div', { className: 'intel-actions' },
            unsaved
              ? h('button', { className: 'intel-btn intel-btn-warn', onClick: retrySave }, '未保存 · 重试保存')
              : null,
            h('button', { className: 'intel-btn', onClick: () => { void load() }, disabled: loading }, loading ? '读取中…' : '刷新'),
            h('button', {
              className: 'intel-btn intel-btn-primary',
              onClick: () => { void openConversation() },
              disabled: convBusy
            }, convBusy ? '正在准备对话…' : (convOpen ? '收起 AI 对话' : (folderConfirmed ? '选择资料文件夹…' : '打开 AI 对话')))))

        const tabDefs = [
          { id: 'radar', label: '羊毛雷达', count: offerItems.length },
          { id: 'games', label: '游戏限免', count: gameItems.length },
          { id: 'cards', label: 'VPS 羊毛', count: cards.length },
          { id: 'x', label: 'X 羊毛', count: xItems.length },
          { id: 'wool', label: 'Token 羊毛', count: 0 }
        ]

        const tabs = h('div', { className: 'intel-tabs', role: 'tablist', 'aria-label': '羊毛大王视图' },
          tabDefs.map((item) => h('button', {
            key: item.id,
            className: 'intel-tab',
            role: 'tab',
            'data-on': tab === item.id ? '1' : '0',
            'aria-selected': tab === item.id ? 'true' : 'false',
            onClick: () => {
              if (tab === item.id) return
              setTab(item.id)
              if (item.id === 'radar') void loadRadarStatus()
              if (item.id === 'x') void loadXStatus()
              if (item.id === 'wool') setWoolLoading(true)
              // 这两页的数据可能被 AI 会话或抓取任务直接写进文件，切回来时重新读一次。
              if (item.id === 'cards' || item.id === 'games') void load()
            }
          }, item.label, item.count > 0 ? h('span', { className: 'intel-tab-count' }, item.count) : null)),
          // 雷达的来源分段与 tab 合并到同一行，避免两条分段条重复占位。
          tab === 'radar'
            ? h('span', { className: 'intel-tab-sep', 'aria-hidden': 'true' }, '|')
            : null,
          tab === 'radar'
            ? [
              h('button', {
                key: 'src-all',
                className: 'intel-tab intel-tab-src',
                'data-on': radarSource ? '0' : '1',
                onClick: () => setRadarSource('')
              }, '全部来源'),
              ['linuxdo', 'v2ex', 'nodeseek', 'appinn'].map((id) => {
                const pair = radarSourcesPresent.find(([key]) => key === id)
                const count = pair ? pair[1] : 0
                return h('button', {
                  key: id,
                  className: 'intel-tab intel-tab-src',
                  'data-on': radarSource === id ? '1' : '0',
                  onClick: () => setRadarSource(radarSource === id ? '' : id)
                }, RADAR_SOURCE_LABEL[id], h('span', { className: 'intel-tab-count' }, count))
              })
            ]
            : null)


        const cardsBody = h('div', { className: 'intel-body' },
          h('div', { className: 'intel-band' }, 'VPS 羊毛 · 云主机情报',
            h('span', { className: 'intel-band-sub' }, cards.length + ' 张卡片')),

          cards.length === 0 && !loading
            ? h('div', { className: 'intel-empty' },
              h('strong', null, '还没有情报卡片'),
              h('span', null, '点下方的「一键复核最新信息」：会生成一段复核指令并复制到剪贴板，交给 AI 对话去查最新来源，查完回这里点「刷新」。'),
              h('span', { className: 'intel-muted', style: { display: 'block', marginTop: '6px' } },
                topics.length > 0 ? `当前主题：${topics.map((topic) => topic.title).join('、')}` : '当前还没有关注主题'))
            : null,

          highlights.length > 0
            ? h('section', { className: 'intel-section' },
              h('h2', null, '今日重点', h('span', { className: 'intel-count' }, `· 高优先级 ${highlights.length} 条`)),
              h('div', { className: 'intel-top' }, highlights.map((card) =>
                h('div', {
                  key: card.id,
                  className: 'intel-topcard',
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => setExpanded((current) => ({ ...current, [card.id]: !current[card.id] })),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setExpanded((current) => ({ ...current, [card.id]: !current[card.id] }))
                    }
                  }
                },
                h('div', { className: 't' }, card.title),
                h('div', { className: 'intel-badges' },
                  h('span', { className: 'intel-badge', 'data-tone': 'cat' }, card.category),
                  h(StatusBadge, { status: card.status }),
                  h('span', { className: 'intel-muted' }, `评分 ${card.score}/5`)),
                (card.summary || []).slice(0, 2).map((item, index) => h('div', { key: index, className: 'intel-muted' }, `· ${item}`))))))
            : null,

          h('section', { className: 'intel-section' },
            h('div', { className: 'intel-filters' },
              h('div', { className: 'intel-search' },
                h('span', { 'aria-hidden': 'true' }, '🔍'),
                h('input', {
                  value: q,
                  placeholder: '搜索标题、要点、额度、坑点、来源…',
                  'aria-label': '搜索情报卡片',
                  onChange: (event) => setQ(event.target.value)
                })),
              h('div', { className: 'intel-tagset' },
                h('button', { className: 'intel-chip', 'data-on': category ? '0' : '1', onClick: () => setCategory('') }, '全部'),
                categories.map(([name, count]) =>
                  h('button', {
                    key: name,
                    className: 'intel-chip',
                    'data-on': category === name ? '1' : '0',
                    onClick: () => setCategory(category === name ? '' : name)
                  }, `${name} ${count}`))),
              h('select', {
                className: 'intel-select',
                value: status,
                'aria-label': '按核实状态筛选',
                onChange: (event) => setStatus(event.target.value)
              },
              h('option', { value: '' }, '全部状态'),
              h('option', { value: 'confirmed' }, '已确认'),
              h('option', { value: 'pending' }, '待验证')),
              h('select', {
                className: 'intel-select',
                value: flag,
                'aria-label': '按处理标记筛选',
                onChange: (event) => setFlag(event.target.value)
              },
              h('option', { value: '' }, '全部标记'),
              FLAGS.map(([value, label]) => h('option', { key: value, value }, label))),
              h('select', {
                className: 'intel-select',
                value: minScore,
                'aria-label': '按评分筛选',
                onChange: (event) => setMinScore(event.target.value)
              },
              h('option', { value: '' }, '任意评分'),
              [5, 4, 3, 2].map((value) => h('option', { key: value, value: String(value) }, `${value} 分以上`))),
              activeFilters
                ? h('button', { className: 'intel-btn intel-btn-ghost', onClick: resetFilters }, '清空筛选')
                : null),

            h('h2', null, '情报卡片', h('span', { className: 'intel-count' }, `· ${visible.length}/${cards.length}`)),
            visible.length === 0
              ? h('div', { className: 'intel-empty' },
                h('strong', null, cards.length === 0 ? '还没有卡片' : '没有符合条件的结果'),
                h('span', null, cards.length === 0 ? '点下面的「一键复核最新信息」开始收集。' : '换个关键词，或清空筛选。'),
                activeFilters ? h('button', { className: 'intel-btn', style: { marginTop: '10px' }, onClick: resetFilters }, '清空筛选') : null)
              : h('div', { className: 'intel-grid' }, visible.map((card) =>
                h(Card, {
                  key: card.id,
                  card,
                  expanded: Boolean(expanded[card.id]),
                  onToggle: toggleCard,
                  onChangeNote,
                  onChangeFlag
                })))))

        const woolBody = h('div', { className: 'intel-body intel-body-fill' },
          h('div', { className: 'intel-band' }, 'Token 羊毛 · 实时页面',
            h('span', { className: 'intel-band-sub' }, 'aihot.news')),
          h('div', { className: 'intel-wool-bar' },
            h('div', { className: 'intel-wool-note' },
              h('strong', null, 'Token 羊毛'),
              h('span', { className: 'intel-muted' }, ' 内容来自 aihot.news，在隔离沙箱里嵌入展示，一切以源站为准。')),
            h('div', { className: 'intel-actions' },
              h('button', {
                className: 'intel-btn',
                onClick: () => { setWoolForce(true); setWoolKey((value) => value + 1) }
              }, '刷新羊毛页'),
              h('a', {
                className: 'intel-btn',
                href: 'https://aihot.news/free-tokens',
                target: '_blank',
                rel: 'noreferrer noopener'
              }, '在新窗口打开'))),
          h('iframe', {
            key: woolKey,
            className: 'intel-wool-frame',
            title: 'Token 羊毛（aihot.news）',
            src: `${API}/wool/page?t=${woolKey}${woolForce ? '&force=1' : ''}`,
            sandbox: 'allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox',
            referrerPolicy: 'no-referrer',
            onLoad: () => { setWoolLoading(false); setWoolForce(false) }
          }),
          woolLoading ? h('div', { className: 'intel-wool-loading' }, '正在加载羊毛页…') : null)

        const xBody = h('div', { className: 'intel-body' },
          h('div', { className: 'intel-band' }, 'X 羊毛 · 热帖榜',
            h('span', { className: 'intel-band-sub' }, xItems.length + ' 条')),
          h('div', { className: 'intel-wool-bar' },
            h('div', { className: 'intel-wool-note' },
              h('strong', null, 'X 羊毛热帖'),
              h('span', { className: 'intel-muted' },
                xFeed.date
                  ? ` · ${xFeed.date}${(xFeed.keywords || []).length ? ` · 关键词 ${(xFeed.keywords || []).join(' / ')}` : ''}`
                  : ' · 还没抓过')),
            h('div', { className: 'intel-actions' },
              h('button', {
                className: 'intel-btn intel-btn-primary',
                onClick: () => { void refreshXNow() },
                disabled: xRunning,
                'aria-busy': xRunning ? 'true' : 'false'
              }, xRunning ? `抓取中 ${elapsed}s…` : `立即抓 ${xStatus?.limit ?? X_TOP_LIMIT} 条`),
              h('button', { className: 'intel-btn', onClick: () => { void prepareX() } }, '让 AI 搜'),
              h('a', {
                className: 'intel-btn',
                href: 'https://x.com/search?q=' + encodeURIComponent('羊毛') + '&f=top',
                target: '_blank',
                rel: 'noreferrer noopener'
              }, '打开 X 搜索')),
            h('div', { className: 'intel-wool-note intel-muted', style: { fontSize: '12px' } },
              xStatus?.nextRunAt
                ? `下次自动刷新：${formatWhen(xStatus.nextRunAt)} · 每 ${runHoursText}（本机时区）`
                : `自动刷新：每天 ${runHoursText}（Harness 需保持运行）`),
            describeJob(xStatus?.job)
              ? h('div', { className: 'intel-wool-note intel-muted', style: { fontSize: '12px' } }, describeJob(xStatus?.job))
              : null),

          xItems.length === 0
            ? h('div', { className: 'intel-empty' },
              h('strong', null, '还没有抓取记录'),
              h('span', null, `点「立即抓 ${xStatus?.limit ?? X_TOP_LIMIT} 条」会通过 web-access 的 CDP 代理、用你 Chrome 的登录态抓取，按点赞排序保留前 ${xStatus?.limit ?? X_TOP_LIMIT} 条；抓不了时用「让 AI 搜」生成指令交给会话。`),
              h('span', { className: 'intel-muted', style: { display: 'block', marginTop: '6px' } },
                `关键词：${((xFeed.keywords && xFeed.keywords.length) ? xFeed.keywords : ['羊毛', '薅']).join(' / ')} · 目标 ${todayISO()}`))
            : h('ol', { className: 'intel-list' }, xShown.map((item, index) =>
              h('li', { key: item.id || index, className: 'intel-list-row' },
                h('span', { className: 'intel-rank' }, item.rank || index + 1),
                h('div', { className: 'intel-list-main' },
                  h('a', {
                    className: 'intel-list-title',
                    href: item.url || 'https://x.com',
                    target: '_blank',
                    rel: 'noreferrer noopener'
                  }, item.title),
                  h('div', { className: 'intel-badges' },
                    item.handle ? h('span', { className: 'intel-badge', 'data-tone': 'cat' }, item.handle) : null,
                    item.author ? h('span', { className: 'intel-muted' }, item.author) : null,
                    h('span', { className: 'intel-muted' }, `❤ ${item.likes}`),
                    h('span', { className: 'intel-muted' }, `🔁 ${item.reposts}`),
                    h('span', { className: 'intel-muted' }, `💬 ${item.replies}`),
                    item.createdAt ? h('span', { className: 'intel-muted' }, item.createdAt.slice(0, 10)) : null),
                  item.excerpt ? h('div', { className: 'intel-muted', style: { fontSize: '12px' } }, item.excerpt) : null)))),

          xFeed.updatedAt
            ? h('p', { className: 'intel-muted', style: { fontSize: '12px', margin: '10px 0 0' } },
              `上次抓取：${formatWhen(xFeed.updatedAt)}`)
            : null)

        const radarStats = (() => {
          const today = todayISO()
          const addedToday = offerItems.filter((item) => localDayOf(item.createdAt) === today).length
          return { total: offerItems.length, addedToday }
        })()
        const radarKeywords = ['GPT', 'Claude', 'Muse', 'Gemini', 'VPS', '家宽IP', '云电脑', '会员', 'API', '服务器', '域名', '代理']
          .map((word) => [word, offerItems.filter((item) => String(item.title + ' ' + item.excerpt).toLowerCase().includes(word.toLowerCase())).length])
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
        const radarKeywordMatches = (item, word) => word
          ? String(item.title + ' ' + item.excerpt).toLowerCase().includes(word.toLowerCase())
          : true
        const radarShown = sortRadarItems(
          radarVisible
            .filter((item) => radarKeywordMatches(item, radarKeyword))
            .filter((item) => radarSince !== 'today' || localDayOf(item.createdAt) === todayISO()),
          radarOrder
        )

        const radarKeywordChips = (() => {
          const top = radarKeywords.slice(0, 8)
          // 已选中的词即使这一轮计数为 0 也要留在行里，否则刷新后用户没法再取消它。
          if (radarKeyword && !top.some(([word]) => word === radarKeyword)) return [...top, [radarKeyword, 0]]
          return top
        })()
        const radarFilterActive = Boolean(radarSource || radarCategory || radarQuery || radarKeyword || radarSince)

        const radarBody = h('div', { className: 'intel-body intel-radar' },
          // 顶部统计条
          h('div', { className: 'intel-stats' },
            h('div', { className: 'intel-stat' },
              h('div', { className: 'intel-stat-label' }, '在库帖子'),
              h('div', { className: 'intel-stat-value' }, radarStats.total,
                h('span', { className: 'intel-stat-cap' }, ` / 上限 ${radarStatus?.limit ?? 500}`)),
              h('div', { className: 'intel-stat-foot' },
                `羊毛近 ${radarStatus?.retentionDays ?? 7} 天 · 过期自动下版`)),
            h('div', { className: 'intel-stat' },
              h('div', { className: 'intel-stat-label' }, '今日新增'),
              h('div', { className: 'intel-stat-value intel-stat-accent' }, '+', radarStats.addedToday)),
            h('div', { className: 'intel-stat' },
              h('div', { className: 'intel-stat-label' }, '上次刷新'),
              h('div', { className: 'intel-stat-value intel-stat-time' }, formatWhen(radarFeed.updatedAt)),
              describeJob(radarStatus?.job) ? h('div', { className: 'intel-stat-foot' }, describeJob(radarStatus?.job)) : null,
              h('div', { className: 'intel-stat-foot' },
                radarStatus?.nextRunAt ? `下次 ${formatWhen(radarStatus.nextRunAt)}` : runHoursText)),
            h('div', { className: 'intel-stat-actions' },
              h('button', {
                className: 'intel-btn intel-btn-strong',
                onClick: () => { void refreshRadarNow() },
                disabled: radarRunning,
                'aria-busy': radarRunning ? 'true' : 'false'
              }, radarRunning ? `抓取中 ${elapsed}s…` : '↻ 刷新'))),

          // 时间 / 排序两行都是真控件（以前「全部内容」那对按钮点了没反应）。
          h('div', { className: 'intel-catrow' },
            h('span', { className: 'intel-catrow-label' }, '时间'),
            h('button', {
              className: 'intel-cat',
              'data-on': radarSince ? '0' : '1',
              onClick: () => setRadarSince('')
            }, '全部内容'),
            h('button', {
              className: 'intel-cat',
              'data-on': radarSince === 'today' ? '1' : '0',
              onClick: () => setRadarSince('today')
            }, `今日新增 · ${radarStats.addedToday}`),
            h('span', { className: 'intel-catrow-label', style: { marginLeft: '10px' } }, '排序'),
            h('button', {
              className: 'intel-cat',
              'data-on': radarOrder === 'score' ? '1' : '0',
              onClick: () => setRadarOrder('score')
            }, '羊毛分从高到低'),
            h('button', {
              className: 'intel-cat',
              'data-on': radarOrder === 'time' ? '1' : '0',
              onClick: () => setRadarOrder('time')
            }, '最新发布')),

          // 标签 + 搜索
          h('div', { className: 'intel-tagrow' },
            h('div', { className: 'intel-taglist' },
              h('button', {
                className: 'intel-tag',
                'data-on': radarCategory ? '0' : '1',
                onClick: () => setRadarCategory('')
              }, '全部'),
              RADAR_CATEGORIES.map((category) => h('button', {
                key: category.id,
                className: 'intel-tag',
                'data-on': radarCategory === category.id ? '1' : '0',
                onClick: () => setRadarCategory(radarCategory === category.id ? '' : category.id)
              }, category.name))),
            h('input', {
              className: 'intel-tagsearch',
              value: radarQuery,
              placeholder: '搜关键词…',
              'aria-label': '搜索羊毛雷达',
              onChange: (event) => setRadarQuery(event.target.value)
            }),
            radarFilterActive
              ? h('button', {
                className: 'intel-btn intel-btn-ghost',
                onClick: () => {
                  setRadarSource('')
                  setRadarCategory('')
                  setRadarQuery('')
                  setRadarKeyword('')
                  setRadarSince('')
                }
              }, '清空筛选')
              : null),

          // 关键词 chips
          radarKeywordChips.length > 0
            ? h('div', { className: 'intel-kwrow' },
              h('span', { className: 'intel-kwlabel' }, '重点词'),
              h('button', {
                className: 'intel-kw intel-kw-strong',
                'data-on': radarKeyword ? '0' : '1',
                onClick: () => setRadarKeyword('')
              }, '全部重点'),
              radarKeywordChips.map(([word, count]) => h('button', {
                key: word,
                className: 'intel-kw',
                'data-on': radarKeyword === word ? '1' : '0',
                onClick: () => setRadarKeyword(radarKeyword === word ? '' : word)
              }, word, h('span', { className: 'intel-kw-count' }, count))))
            : null,

          // 区块标题
          h('div', { className: 'intel-band' },
            radarSince === 'today' ? '今日新增羊毛' : `近 ${radarStatus?.retentionDays ?? 7} 天羊毛`,
            h('span', { className: 'intel-band-sub' }, radarShown.length + ' 条')
          ),

          radarShown.length === 0
            ? h('div', { className: 'intel-empty' },
              h('strong', null, offerItems.length === 0
                ? '还没有抓到羊毛信息'
                : (radarSince === 'today' ? '今天还没有新增' : '没有符合条件的结果')),
              h('span', null, offerItems.length === 0
                ? '点右上角「刷新」拉取七个来源：LINUX DO、NodeSeek、V2EX、小众软件、果核剥壳、异次元。'
                : (radarSince === 'today' ? '点「全部内容」看近 7 天，或刷新抓一次新的。' : '换个来源、标签或关键词试试。')))
            : h('div', { className: 'intel-feed' }, radarShown.map((item) => h('div', {
              key: item.id || item.url,
              className: 'intel-post'
            },
            h('div', { className: 'intel-post-meta' },
              h('span', { className: 'intel-post-src' }, RADAR_SOURCE_LABEL[item.source] || item.source),
              h('span', { className: 'intel-chip-tag', 'data-tag': item.category },
                RADAR_CATEGORY_LABEL[item.category] || '羊毛'),
              item.score ? h('span', { className: 'intel-woolscore', 'data-tier': item.score >= 70 ? 'hot' : (item.score >= 50 ? 'warm' : 'cool') }, '羊毛分 ' + item.score) : null,
              h('span', { className: 'intel-verify', 'data-verdict': item.verdict || 'unknown' }, ({ free: '真实免费', conditional: '有条件免费', discount: '只是优惠', unknown: '待判断' })[item.verdict] || '待判断'),
              item.expiresAt ? deadlineChip(item.expiresAt) : null,
              h('span', { className: 'intel-post-time' }, item.timeExact === false ? '最近活跃' : relativeTime(item.createdAt))),
            h('a', {
              className: 'intel-post-title',
              href: item.url || '#',
              target: '_blank',
              rel: 'noreferrer noopener'
            }, item.title),
            item.excerpt ? h('p', { className: 'intel-post-desc' }, item.excerpt) : null,
            item.author || item.handle
              ? h('div', { className: 'intel-post-by' }, item.handle || item.author)
              : null,
            h('div', { className: 'intel-post-actions' },
              h('a', {
                className: 'intel-link',
                href: item.url || '#',
                target: '_blank',
                rel: 'noreferrer noopener'
              }, '去原帖 →'),
              h('button', {
                className: 'intel-btn intel-btn-ghost',
                onClick: () => { void prepareClaim(item) }
              }, 'AI 帮领'))))));
        // 「游戏」是内容类型，不是价格维度：单独一页，按截止时间从近到远。
        const gameRow = (item, index) => h('li', { key: item.id || item.url, className: 'intel-list-row' },
          h('span', { className: 'intel-rank' }, index + 1),
          h('div', { className: 'intel-list-main' },
            h('a', {
              className: 'intel-list-title',
              href: item.url || 'https://store.epicgames.com/zh-CN/free-games',
              target: '_blank',
              rel: 'noreferrer noopener'
            }, item.title),
            h('div', { className: 'intel-badges' },
              h('span', { className: 'intel-badge', 'data-tone': 'cat' }, 'Epic'),
              deadlineChip(item.expiresAt),
              item.score ? h('span', { className: 'intel-woolscore', 'data-tier': 'hot' }, '羊毛分 ' + item.score) : null),
            item.excerpt ? h('div', { className: 'intel-muted', style: { fontSize: '12px' } }, item.excerpt) : null,
            h('a', {
              className: 'intel-link',
              href: item.url || 'https://store.epicgames.com/zh-CN/free-games',
              target: '_blank',
              rel: 'noreferrer noopener'
            }, '去领取 →')))

        const gameEmpty = h('div', { className: 'intel-empty' },
          h('strong', null, '现在没有可领的免费游戏'),
          h('span', null, 'Epic 每周四换一批。点右下角「立即抓一次」手动刷新；如果一直为空，去「羊毛雷达」看「上次刷新」下面有没有 Epic 的失败原因。'),
          h('span', { className: 'intel-muted', style: { display: 'block', marginTop: '6px' } },
            `上次刷新：${formatWhen(radarFeed.updatedAt)}`))

        const gameList = h('div', null,
          h('ol', { className: 'intel-list' }, gameItems.map(gameRow)),
          h('p', { className: 'intel-muted', style: { fontSize: '12px', margin: '10px 0 0' } },
            `上次刷新：${formatWhen(radarFeed.updatedAt)} · 按截止时间排序，最先到期的在最上面`))

        const gamesBody = h('div', { className: 'intel-body' },
          h('div', { className: 'intel-band' }, '游戏限免 · Epic',
            h('span', { className: 'intel-band-sub' }, `${gameItems.length} 个可领`)),
          gameItems.length === 0 ? gameEmpty : gameList)

        const body = tab === 'wool'
          ? woolBody
            : tab === 'x'
              ? xBody
                : tab === 'games'
                  ? gamesBody
                  : tab === 'radar'
                    ? radarBody
                    : cardsBody

        // 错误、提示与服务端版本横幅都放在标签栏下方：任何一页操作都能看到反馈。
        const strip = (error || notice || serverOutdated)
          ? h('div', { className: 'intel-strip' },
            serverOutdated
              ? h('div', { className: 'intel-notice', role: 'status' },
                h('span', null, '服务端还是旧版本：新功能要等 Harness 重启才会生效。用菜单「Harness → 重启 Harness」，再把工作台切走切回即可。'))
              : null,
            error ? h('p', { className: 'intel-err', style: { margin: 0 } }, error) : null,
            notice
              ? h('div', { className: 'intel-notice', role: 'status' },
                h('span', null, notice),
                h('button', { className: 'intel-btn intel-btn-ghost', onClick: () => setNotice('') }, '知道了'))
              : null)
          : null

        const footer = h('div', { className: 'intel-foot' },
          h('div', { className: 'meta' },
            tab === 'wool'
              ? 'Token 羊毛为只读嵌入，领取与规则以 aihot.news 为准'
              : tab === 'games'
                ? 'Epic 每周免费游戏 · 截止前领取即永久入库'
                : tab === 'x'
                  ? `X 榜单由 AI 用 web-access 抓取写回 · 上次抓取：${formatWhen(xFeed.updatedAt)}`
                  : `上次复核：${formatWhen(state?.lastReviewedAt)} · 数据更新：${formatWhen(state?.updatedAt)}`,
            tab === 'cards' && savedAt ? ` · 已保存 ${formatWhen(savedAt)}` : '',
            (tab === 'cards' || tab === 'x') && meta?.file
              ? h('span', { className: 'intel-muted', style: { display: 'block' } }, `数据文件：${meta.file}`)
              : null),
          tab === 'cards'
            ? h('div', { className: 'intel-actions' },
              h('button', { className: 'intel-btn intel-btn-primary', onClick: () => { void prepareReview() } }, '一键复核最新信息'))

              : tab === 'games'
                ? h('div', { className: 'intel-actions' },
                  h('button', { className: 'intel-btn', onClick: () => { void load() }, disabled: loading }, loading ? '读取中…' : '刷新列表'),
                  h('button', { className: 'intel-btn intel-btn-primary', onClick: () => { void refreshRadarNow() }, disabled: radarRunning }, radarRunning ? `抓取中 ${elapsed}s…` : '立即抓一次'))
                : tab === 'x'
                ? h('div', { className: 'intel-actions' },
                  h('button', { className: 'intel-btn', onClick: () => { void load() }, disabled: loading }, loading ? '读取中…' : '刷新'),
                  h('button', { className: 'intel-btn intel-btn-primary', onClick: () => { void refreshXNow() }, disabled: xRunning }, xRunning ? `抓取中 ${elapsed}s…` : `立即抓 ${xStatus?.limit ?? X_TOP_LIMIT} 条`),
                  h('button', { className: 'intel-btn', onClick: () => { void prepareX() } }, '让 AI 搜'))
                : tab === 'radar'
                  ? h('div', { className: 'intel-actions' },
                    h('button', { className: 'intel-btn', onClick: () => { void load() }, disabled: loading }, loading ? '读取中…' : '刷新列表'),
                    h('button', { className: 'intel-btn intel-btn-primary', onClick: () => { void refreshRadarNow() }, disabled: radarRunning }, radarRunning ? `抓取中 ${elapsed}s…` : '立即抓一次'))
                  : h('div', { className: 'intel-actions' },
                    h('button', {
                      className: 'intel-btn',
                      onClick: () => { setWoolForce(true); setWoolKey((value) => value + 1) }
                    }, '刷新羊毛页')))

        const drawer = convOpen
          ? h('aside', { className: 'intel-drawer', 'aria-label': 'AI 对话' },
            h('div', { className: 'intel-drawer-head' },
              h('span', null, 'AI 协助复核'),
              h('button', { className: 'intel-btn intel-btn-ghost', onClick: () => setConvOpen(false) }, '关闭')),
            h('div', { className: 'intel-conv' },
              conversation || h('div', { className: 'intel-conv-note' },
                '会话正在准备中。如果一直没有内容，关掉抽屉后用左侧栏「新会话」创建，再回来打开。')))
          : null

        const promptTitle = promptKind === 'review'
          ? '复核提示词已生成'
          : (promptKind === 'claim' ? '领取指令已生成' : '抓取指令已生成')
        const promptHint = promptKind === 'review'
          ? '把它发到本工作台的会话里，Agent 会联网核实并直接写回卡片数据文件；完成后回到这里点「刷新」。'
          : (promptKind === 'claim'
            ? '发到 AI 对话里，Agent 会先读原帖、再打开落地页按页面要求领取；遇到登录、验证码、绑卡或付费会停下来问你。'
            : '把它发到本工作台的会话里，Agent 会按指令抓取并写回数据文件；完成后回到这里点「刷新」。')

        const modal = promptText
          ? h('div', { className: 'intel-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': promptTitle },
            h('div', { className: 'intel-modal-box' },
              h('header', null, promptTitle),
              h('div', { className: 'body' },
                h('p', { style: { margin: '0 0 8px' } }, promptHint),
                copied ? h('p', { className: 'intel-muted', style: { margin: '0 0 8px' } }, copied) : null,
                h('pre', { className: 'intel-pre' }, promptText)),
              h('footer', null,
                h('button', { className: 'intel-btn', onClick: () => { setPromptText('') } }, '关闭'),
                h('button', { className: 'intel-btn', onClick: () => { void copyPrompt() } }, '复制提示词'),
                h('button', {
                  className: 'intel-btn intel-btn-primary',
                  onClick: () => { setPromptText(''); void openConversation() }
                }, '打开 AI 对话'))))
          : null

        const tabLabel = (tabDefs.find((item) => item.id === tab) || tabDefs[0]).label

        if (loading && !state) {
          return h('div', { className: 'intel' },
            h('div', { className: 'intel-main' },
              header,
              tabs,
              strip,
              h('div', { className: 'intel-body' }, h('div', { className: 'intel-empty' }, h('strong', null, '正在读取情报数据…')))))
        }

        return h('div', { className: 'intel' },
          h('div', { className: 'intel-main' },
            header,
            tabs,
            strip,
            h('div', { className: 'intel-panel', role: 'tabpanel', 'aria-label': tabLabel }, body),
            footer),
          drawer,
          modal)
      }

      function apply(ctx) {
        ctx.effect(() => ctx.desktopWorkbenches.register({
          title: '羊毛大王',
          description: '按关注主题收集、核实并结构化呈现最新信息：今日重点、多维筛选、卡片详情与一键复核。',
          panelTitle: '羊毛大王',
          icon: '🛰️',
          repository: 'https://github.com/ttttstc/dsh-workbench-intel-center',
          customFrame: true
        }, Panel), 'intel-center: register workbench')
      }

      const inject = ['desktopWorkbenches']

      module.exports = { apply, inject, Panel, filterCards, highlightCards, buildReviewPrompt }

    })(module, exports, require)
    return module.exports
  }
})
