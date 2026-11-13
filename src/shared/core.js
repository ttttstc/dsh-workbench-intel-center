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
export function buildClaimPrompt({ item, today } = {}) {
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
export const RADAR_CATEGORIES = [
  { id: 'limited', name: '限免' },
  { id: 'free', name: '免费' },
  { id: 'cheap', name: '低价' },
  { id: 'general', name: '一般' }
]

/**
 * 把雷达条目按「价格类 / 游戏类」拆开。
 * 游戏按**截止时间最近的在最前**排（能领到比什么都重要），同截止时间再按新近。
 */
export function splitRadarItems(items) {
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
export const X_TOP_LIMIT = 200

/**
 * 客户端与服务端之间的协议版本。
 *
 * 客户端产物与插件服务端是两条加载路径：换版本后服务端要等 Harness 重启才用上新代码，
 * 而客户端 bundle 打开即生效。没有这个握手，界面只会表现为「刷新没反应」。
 */
export const API_VERSION = 4

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

export const RADAR_CATEGORY_LABEL = Object.fromEntries(RADAR_CATEGORIES.map((c) => [c.id, c.name]))

/**
 * 雷达排序。
 * - score：按羊毛分从高到低（同分再看时间），默认口径——先看最值得薅的
 * - time：纯时间倒序，看「今天有什么新的」
 */
export function sortRadarItems(items, order = 'score') {
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
