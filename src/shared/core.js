/**
 * 情报中心的纯逻辑：状态文案、筛选、今日重点排序、复核提示词。
 *
 * 放在 shared 里有两层原因：客户端构建时会内联这份代码，服务端与 node --test 也直接导入，
 * 一套逻辑不会因为界面改动而与测试脱节。
 */

export const STATUS_LABEL = { confirmed: '已确认', pending: '待验证' }

export const FLAGS = [
  ['none', '未标记'],
  ['shortlist', '待试用'],
  ['watch', '持续关注'],
  ['used', '已采用'],
  ['dropped', '已排除']
]

export const FLAG_LABEL = Object.fromEntries(FLAGS)

/** 本地日期（YYYY-MM-DD），复核提示词里的「今天」用它。 */
export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function formatWhen(value) {
  if (!value) return '未记录'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 40)
  const pad = (n) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

const norm = (value) => String(value ?? '').trim().toLowerCase()

/** 搜索 + 多维筛选（分类、核实状态、处理标记、最低评分）。 */
export function filterCards(cards, filters = {}) {
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
export function highlightCards(cards, limit = 3) {
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
export function buildReviewPrompt({ topics, cards, dataFile, today }) {
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
 * 生成「抓 linux.do 羊毛榜」的指令：写清关键词、当天日期、排序口径与回写位置。
 * 这份提示词是给会话里的 AI 用的——它有自己的浏览器，登录状态由用户在那台浏览器里维护。
 */
export function buildLinuxdoPrompt({ date, keywords = ['羊毛', '薅'], dataFile, existing = [] }) {
  const day = date || todayISO()
  const kws = (keywords && keywords.length ? keywords : ['羊毛', '薅']).map((k) => `「${k}」`).join('、')
  const prev = (existing || []).length
    ? `上一次抓到 ${existing.length} 条（最近更新：${existing[0]?.createdAt || '未知'}），本次请覆盖成今天的新榜。`
    : '目前还没有抓取记录。'
  return [
    '请帮我抓取 linux.do 今天的「羊毛」热帖榜，并把结果写回工作台数据文件。',
    '',
    '## 目标',
    `- 站点：https://linux.do`,
    `- 关键词：${kws}`,
    `- 范围：今天（${day}）发布或有新回复的帖子，按点赞数（likes）从高到低取前 20 条`,
    prev,
    '',
    '## 步骤',
    '1. 打开浏览器访问 linux.do。如果显示未登录，请在浏览器窗口里登录（我在这边完成登录，你再继续）。',
    '2. 用站内搜索，搜索词分别试：`羊毛 order:likes after:' + day + '`、`薅 order:likes after:' + day + '`；',
    '   若搜索接口要求登录，就用搜索结果页正常浏览，按点赞排序。',
    '3. 合并两组结果，按帖子 id 去重，按点赞数降序保留前 20 条。',
    '4. 每条记录：标题、链接、作者、分类、点赞数、回复数、浏览量、发布时间、一句摘要（不超过 60 字）。',
    '5. 抓不到点赞/浏览数据时留 0，不要编造数字。',
    '',
    '## 写回位置',
    dataFile ? '`' + dataFile + '`' : '（读取工作台数据目录后填写）',
    '',
    '## 文件结构（只改 linuxdo 字段，cards/topics 原样保留）',
    '{',
    '  "version": 1,',
    '  "cards": [ ... 保持不变 ... ],',
    '  "topics": [ ... 保持不变 ... ],',
    '  "linuxdo": {',
    '    "updatedAt": "抓取完成时间（ISO 8601）",',
    '    "date": "' + day + '",',
    '    "keywords": ' + JSON.stringify(keywords && keywords.length ? keywords : ['羊毛', '薅']) + ',',
    '    "items": [',
    '      {',
    '        "id": "帖子 id",',
    '        "rank": 1,',
    '        "title": "标题",',
    '        "url": "https://linux.do/t/...",',
    '        "author": "作者",',
    '        "category": "分类",',
    '        "likes": 0,',
    '        "replies": 0,',
    '        "views": 0,',
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
    '写回文件后，一句话告诉我：抓到几条、最高点赞的是哪条、有没有因为未登录或限流漏掉的。'
  ].join('\n')
}

/**
 * 生成「搜 X 上羊毛热帖」的指令。抓取必须走 web-access skill（用户 Chrome 的真实登录态 + CDP）。
 */
export function buildXPrompt({ date, keywords = ['羊毛', '薅'], dataFile, existing = [] }) {
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
    '- 排序：按点赞数（likes）从高到低，取前 50 条',
    '- 时间范围：优先今天（' + day + '），不足 50 条可放宽到最近 7 天',
    prev,
    '',
    '## 做法',
    '1. 加载 web-access skill，按其指引用 CDP 操作用户 Chrome（天然带登录态），自建后台 tab，结束后关闭。',
    '2. 搜索页用 https://x.com/search?q=<关键词>&f=top ；关键词可补充「薅羊毛」「羊毛 免费」提高召回。',
    '3. 抽取每条帖子的：正文（超长截断）、作者名、@handle、点赞、转发、回复、发布时间、帖子链接。',
    '4. 按帖子 id 去重，按点赞降序保留前 50，过滤纯广告与无关内容。',
    '5. 计数可能是「1.2万」这类中文缩写，统一换算成整数；抓不到的字段留 0，不要编造。',
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

/** 羊毛雷达的分类（与服务端 sources.js 的 id 对齐）。 */
export const RADAR_CATEGORIES = [
  { id: 'limited', name: '限免' },
  { id: 'free', name: '免费' },
  { id: 'cheap', name: '低价' },
  { id: 'general', name: '一般' }
]

export const RADAR_CATEGORY_LABEL = Object.fromEntries(RADAR_CATEGORIES.map((c) => [c.id, c.name]))

/** 按来源、分类、关键词过滤雷达条目。 */
export function filterRadar(items, { source = '', category = '', q = '' } = {}) {
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
export function relativeTime(iso, now = Date.now()) {
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
