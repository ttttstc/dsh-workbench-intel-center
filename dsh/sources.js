/**
 * 羊毛雷达的数据源（七个，全部真实抓取）。
 *
 * 直连：
 * - V2EX · 优惠信息  https://www.v2ex.com/feed/deals.xml （官方 Atom，不用会 403 的 JSON API）
 * - 小众软件        https://www.appinn.com/feed/ （官方 RSS）
 * - 果核剥壳        https://www.ghxi.com/feed （官方 RSS）
 * - 异次元软件世界    https://www.iplaysoft.com/feed （官方 RSS，会 301）
 * - NodeSeek · 最新  https://rss.nodeseek.com/ （官方 RSS，通常可直连；被拦时退回浏览器）
 * - LINUX DO · 福利羊毛 https://linux.do/c/welfare/36.rss （category 36；常被 Cloudflare 拦，退回浏览器）
 * - Epic 免费游戏    免费促销 JSON 接口（带起止时间，到期自动下版）
 *
 * 浏览器通道只在直连失败时启用：来源被 Cloudflare 拦时，借用户浏览器页面内的 fetch 补抓
 * （见 crawler.js）。这一层让四个站点之外的新来源可以纯直连加入，不必都依赖 Chrome。
 *
 * 收录规则集中在 KEYWORDS / CATEGORIES / buildRadar，改词表即可调整口径。
 */

export const SOURCES = [
  { id: 'linuxdo', name: 'LINUX DO 福利羊毛', home: 'https://linux.do/c/welfare/36', kind: 'both' },
  { id: 'nodeseek', name: 'NodeSeek 最新', home: 'https://www.nodeseek.com/', kind: 'both' },
  { id: 'appinn', name: '小众软件', home: 'https://www.appinn.com/', kind: 'direct' },
  { id: 'ghxi', name: '果核剥壳', home: 'https://www.ghxi.com/', kind: 'direct' },
  { id: 'iplaysoft', name: '异次元软件世界', home: 'https://www.iplaysoft.com/', kind: 'direct' },
  { id: 'v2ex', name: 'V2EX 优惠信息', home: 'https://www.v2ex.com/go/deals', kind: 'direct' },
  { id: 'epic', name: 'Epic 免费游戏', home: 'https://store.epicgames.com/zh-CN/free-games', kind: 'direct' },
  { id: 'zcl', name: '资源雷达', home: 'https://radar.zichuanlan.top/', kind: 'direct' }
]

/** 收录关键词：标题或摘要命中任一才进榜。 */
// 关键词不分层级，全部等权：命中任意一个即进入收集范围。
export const KEYWORDS = [
  '羊毛', '薅', '免费', '白嫖', '限免', '0 元', '0元', '低价', '折扣', '优惠',
  '福利', '抽奖', '红包', '秒杀', '团购', '试用', '白送', '便宜', '省钱',
  '优惠券', '折扣码', '返现', '补贴', '特价', '送', '领'
]

/**
 * 分类，顺序即判定优先级（先限免，再免费，然后游戏，最后低价）。
 * 「游戏」不靠词表判定：Epic 的条目由解析器直接标成 game（中文游戏名里未必有「免费」两个字）。
 */
export const CATEGORIES = [
  { id: 'limited', name: '限免', words: ['限免', '限时免费', '限时', '最后一天', '即将结束', '截止'] },
  { id: 'free', name: '免费', words: ['免费', '白嫖', '0 元', '0元', '白给', '赠送', '领取', '试用', '白送', '福利', '抽奖'] },
  { id: 'game', name: '游戏', words: [] },
  { id: 'cheap', name: '低价', words: ['低价', '优惠', '折扣', '特价', '降价', '券', '补贴', '促销', '立减', '首月', '元/月', '红包', '秒杀', '团购', '返现', '便宜', '省钱'] }
]

export const MAX_AGE_DAYS = 7
/** 雷达在库上限：一处定义，抓取合并、接口状态与界面文案共用。 */
export const MAX_RADAR_ITEMS = 500

const NOISE = ['招聘', '求职', '面试', '房源', '租房', '征友']

const norm = (value) => String(value ?? '').toLowerCase()

export function classify(text) {
  const haystack = norm(text)
  for (const category of CATEGORIES) {
    if (category.words.some((word) => haystack.includes(norm(word)))) return category.id
  }
  return 'other'
}

export function matchesKeywords(text) {
  const haystack = norm(text)
  return KEYWORDS.some((word) => haystack.includes(norm(word)))
}


export function isNoise(text) {
  const haystack = norm(text)
  return NOISE.some((word) => haystack.includes(norm(word)))
}

export function withinDays(createdAt, days = MAX_AGE_DAYS, now = Date.now()) {
  const time = Date.parse(createdAt)
  if (Number.isNaN(time)) return false
  return now - time <= days * 24 * 60 * 60 * 1000
}

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** RSS 2.0（小众软件 / Discourse）。 */
export function parseRss(xml, { source, linkBase = '' } = {}) {
  const items = []
  for (const block of String(xml || '').split(/<item[ >]/).slice(1)) {
    const title = stripHtml((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1])
    const link = stripHtml((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1])
    const pub = stripHtml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1])
    const desc = stripHtml((block.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).slice(0, 200)
    if (!title || !link) continue
    const created = Date.parse(pub)
    items.push({
      source,
      title,
      url: link.startsWith('http') ? link : linkBase + link,
      excerpt: desc,
      createdAt: Number.isNaN(created) ? new Date().toISOString() : new Date(created).toISOString(),
      heat: 0
    })
  }
  return items
}

/** Atom（V2EX 官方源）。 */
export function parseAtom(xml, { source } = {}) {
  const items = []
  for (const block of String(xml || '').split(/<entry>/).slice(1)) {
    const title = stripHtml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1])
    const href = (block.match(/<link[^>]+href="([^"]+)"/) || [])[1]
    const updated = stripHtml((block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1])
    const summary = stripHtml((block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1]).slice(0, 200)
    if (!title || !href) continue
    const created = Date.parse(updated)
    items.push({
      source,
      title,
      url: href,
      excerpt: summary,
      createdAt: Number.isNaN(created) ? new Date().toISOString() : new Date(created).toISOString(),
      heat: 0
    })
  }
  return items
}

/** NodeSeek 分类页 HTML：抓 /post-<id>-<n> 链接与标题。 */
export function parseNodeSeek(html, { now = new Date().toISOString() } = {}) {
  const text = String(html || '')
  const items = []
  const seen = new Set()
  const re = /<a[^>]+href="(\/post-\d+-\d+)"[^>]*>([^<]{2,160})<\/a>/g
  let match
  while ((match = re.exec(text)) !== null) {
    const url = 'https://www.nodeseek.com' + match[1]
    const title = stripHtml(match[2])
    if (!title || seen.has(url)) continue
    seen.add(url)
    // 标题后面紧跟的区块里有该帖最后活跃时间（time datetime），用它当时间轴，
    // 取不到才退回抓取时刻——这样列表不会被统一刷成「刚刚」。
    const window = text.slice(match.index, match.index + 2200)
    const stamp = (window.match(/<time[^>]+datetime="([^"]+)"/) || [])[1]
    const parsed = stamp ? Date.parse(stamp) : NaN
    const exact = !Number.isNaN(parsed)
    items.push({
      source: 'nodeseek',
      title,
      url,
      excerpt: '',
      // 没有可靠时间就给抓取时刻，但标记 timeExact=false，界面显示「最近活跃」而不是「刚刚」。
      createdAt: exact ? new Date(parsed).toISOString() : now,
      timeExact: exact,
      heat: 0
    })
  }
  return items
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function getText(url, { fetchImpl = fetch, timeoutMs = 15000, accept = '*/*' } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 不少站按「有没有 referer / sec-fetch-*」判爬虫，缺这些头的直连会被直接 403。
  // 这几项对齐真实浏览器的同源 fetch，能让 RSS 这类公开端点正常返回。
  const origin = (() => {
    try {
      return new URL(url).origin + '/'
    } catch {
      return ''
    }
  })()
  try {
    const headers = {
      'user-agent': UA,
      accept,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    }
    if (origin) headers.referer = origin
    const response = await fetchImpl(url, { headers, signal: controller.signal })
    if (!response.ok) throw new Error(`返回 ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/** V2EX 优惠信息：官方 Atom。 */
export async function fetchV2ex({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://www.v2ex.com/feed/deals.xml', {
      fetchImpl,
      accept: 'application/atom+xml,application/xml,text/xml,*/*'
    })
    return { items: parseAtom(xml, { source: 'v2ex' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`V2EX 优惠信息：${error?.message || error}`] }
  }
}

/** 小众软件：官方 RSS。 */
export async function fetchAppinn({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://www.appinn.com/feed/', {
      fetchImpl,
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    return { items: parseRss(xml, { source: 'appinn' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`小众软件：${error?.message || error}`] }
  }
}

/** LINUX DO · 福利羊毛：category 36 的 RSS。可能被 Cloudflare 拦，失败交给浏览器补抓。 */
export async function fetchLinuxdo({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://linux.do/c/welfare/36.rss', {
      fetchImpl,
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    return { items: parseRss(xml, { source: 'linuxdo', linkBase: 'https://linux.do' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`LINUX DO 福利羊毛：${error?.message || error}`] }
  }
}

/** NodeSeek：官方 RSS（通常可直连，被 Cloudflare 拦时由浏览器通道兜底）。 */
export async function fetchNodeSeek({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://rss.nodeseek.com/', {
      fetchImpl,
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    return { items: parseRss(xml, { source: 'nodeseek' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`NodeSeek 最新：${error?.message || error}`] }
  }
}

/** 果核剥壳：官方 RSS。 */
export async function fetchGhxi({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://www.ghxi.com/feed', {
      fetchImpl,
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    return { items: parseRss(xml, { source: 'ghxi' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`果核剥壳：${error?.message || error}`] }
  }
}

/** 异次元软件世界：官方 RSS（请求会 301 到 feed.iplaysoft.com）。 */
export async function fetchIplaysoft({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://www.iplaysoft.com/feed', {
      fetchImpl,
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    return { items: parseRss(xml, { source: 'iplaysoft' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`异次元软件世界：${error?.message || error}`] }
  }
}

/**
 * Epic 免费游戏：从促销 JSON 里挑出「当前正在免费」和「即将开始免费」的商品。
 *
 * 与其它来源的关键差别：它自带**起止时间**，到期就该下版，所以条目带 expiresAt；
 * 游戏名里通常不含「免费」二字，因此由解析器直接标成 game 分类，绕开关键词表。
 */
export function parseEpic(json, { now = Date.now() } = {}) {
  const elements = json?.data?.Catalog?.searchStore?.elements
  if (!Array.isArray(elements)) throw new Error('Epic 返回结构变了：找不到 data.Catalog.searchStore.elements')

  const items = []
  for (const element of elements) {
    const title = String(element?.title || '').trim()
    if (!title) continue
    const offers = element?.promotions?.promotionalOffers?.[0]?.promotionalOffers || []
    for (const offer of offers) {
      if (Number(offer?.discountSetting?.discountPercentage) !== 0) continue
      const end = Date.parse(offer?.endDate)
      if (!Number.isFinite(end) || end <= now) continue
      const start = Date.parse(offer?.startDate)
      const slug = element?.productSlug || element?.urlSlug || element?.offerMappings?.[0]?.pageSlug || ''
      items.push({
        source: 'epic',
        title,
        url: slug ? `https://store.epicgames.com/zh-CN/p/${slug}` : 'https://store.epicgames.com/zh-CN/free-games',
        excerpt: Number.isFinite(start) && start > now ? '即将开始免费领取' : '当前免费领取，截止前领取永久入库',
        createdAt: new Date(Number.isFinite(start) && start <= now ? start : now).toISOString(),
        expiresAt: new Date(end).toISOString(),
        category: 'game',
        heat: 0
      })
      break
    }
  }
  return items
}

export const EPIC_FREE_URLS = [
  'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN',
  'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN'
]
export const EPIC_FREE_URL = EPIC_FREE_URLS[0]

/**
 * Epic 免费游戏：JSON 接口。没有免费游戏是正常结果，不当失败。
 *
 * 实测这个域名的**首次连接**经常超时（10 秒内失败），紧接着再连就 200 —— 典型的冷启动握手问题。
 * 所以这里对「错误」重试，而不是交给 withRetry（后者会把「本周没有免费游戏」的空结果也当失败重试）。
 * 主域名试完再试 ipv4 域名，两者返回同一份数据。
 */
export async function fetchEpic({
  fetchImpl = fetch,
  now = Date.now(),
  attempts = 3,
  timeoutMs = 20000,
  waitMs = 600
} = {}) {
  const failures = []
  for (const url of EPIC_FREE_URLS) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const body = await getText(url, { fetchImpl, accept: 'application/json', timeoutMs })
        let json
        try {
          json = JSON.parse(body)
        } catch {
          throw new Error('返回的不是合法 JSON')
        }
        return { items: parseEpic(json, { now }), errors: [] }
      } catch (error) {
        failures.push(`${new URL(url).host} 第 ${attempt} 次：${error?.message || error}`)
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
  }
  return { items: [], errors: [`Epic 免费游戏：${failures.slice(-2).join('；')}`] }
}

async function withRetry(task, { retries = 1, waitMs = 800 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await task()
      if (result?.items?.length) return result
      lastError = new Error((result?.errors || []).join('；') || '没有取到内容')
    } catch (error) {
      lastError = error
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  return { items: [], errors: [String(lastError?.message || lastError)] }
}

/** 六个直连来源（LINUX DO 与 NodeSeek 直连失败时，由浏览器通道兜底）。 */
export async function collectServerSources({ fetchImpl = fetch, now = Date.now() } = {}) {
  const [v2, ap, gh, ip, ns, ld, epic, up] = await Promise.all([
    withRetry(() => fetchV2ex({ fetchImpl })),
    withRetry(() => fetchAppinn({ fetchImpl })),
    withRetry(() => fetchGhxi({ fetchImpl })),
    withRetry(() => fetchIplaysoft({ fetchImpl })),
    withRetry(() => fetchNodeSeek({ fetchImpl })),
    withRetry(() => fetchLinuxdo({ fetchImpl }), { retries: 0 }),
    // Epic 没有免费游戏是正常结果，交给 withRetry 会把它当失败重试，所以直接调用。
    fetchEpic({ fetchImpl, now }),
    // 资源雷达：公开 JSON 接口，自带 AI 分类与「可领取」判断。
    fetchUpstream({ fetchImpl, now })
  ])
  const results = [v2, ap, gh, ip, ns, ld, epic, up]
  const ids = ['v2ex', 'appinn', 'ghxi', 'iplaysoft', 'nodeseek', 'linuxdo', 'epic', 'zcl']
  // perSource：哪个源拿了几条、报了什么错。路由据此决定「要不要改走浏览器」——
  // 以前靠错误文案里有没有「LINUX DO」来判断，一个 403 文案变体就漏掉兜底。
  const perSource = results.map((result, index) => ({
    id: ids[index],
    count: (result.items || []).length,
    errors: (result.errors || []).map(String)
  }))
  return {
    items: results.flatMap((result) => result.items || []),
    errors: results.flatMap((result) => result.errors || []),
    perSource
  }
}

const CATEGORY_PRIORITY = { limited: 0, game: 1, free: 2, cheap: 3, general: 4 }

const FREE_SIGNAL = /(免费|白嫖|0\s*元|0元|白给|赠送|免费领取|免单|限免)/
const COST_SIGNAL = /(需绑卡|要绑卡|需实名|实名认证|需付|付费|首充|首月|押金|满减|需购买|会员价|订阅|邀请码|返利|aff|推广)/i
const DISCOUNT_SIGNAL = /(折扣|优惠|立减|特价|秒杀|团购|券|返现|补贴|降价|便宜|省钱)/

/**
 * 核实「是否真实免费」：给出四档结论，而不是笼统的「已核实」。
 * - free        真实免费（有免费信号且没有附加代价）
 * - conditional 有条件免费（要绑卡 / 实名 / 邀请码 / 首充等）
 * - discount    只是优惠（没有免费信号，只有折扣）
 * - unknown     看不出是否免费
 */
export function verifyFree(text) {
  const t = String(text || '')
  const free = FREE_SIGNAL.test(t)
  const cost = COST_SIGNAL.test(t)
  const discount = DISCOUNT_SIGNAL.test(t)
  if (free && !cost) return { verdict: 'free', reason: '明确写了免费且无附加条件' }
  if (free && cost) return { verdict: 'conditional', reason: '写的是免费，但需要绑卡/实名/邀请码等条件' }
  if (!free && discount) return { verdict: 'discount', reason: '没有免费信号，属于折扣/优惠' }
  return { verdict: 'unknown', reason: '看不出是否真实免费' }
}

/** 判断是否有「可核实的具体信息」：金额、额度、期限、领取方式。 */
export function hasConcreteEvidence(text) {
  const t = String(text || '')
  const money = /(¥|￥|\$|\d+\s*(元|块|美元|刀|积分|额度|点|GB|G|TB|天|个月|年))/.test(t)
  const claim = /(领取|领|注册|签到|申请|兑换|下单|直达|链接|邀请码|口令)/.test(t)
  return money && claim
}

/**
 * 「真实能薅到」的判断：把一件事拆成五个可解释的信号，而不是一个笼统印象分。
 *
 * 1. 是不是真免费 —— 免费/白嫖/0 元/限免
 * 2. 值多少      —— 有没有具体数字（元/GB/月/积分）
 * 3. 怎么领      —— 有没有明确的领取动作或路径（领取/注册/链接/口令）
 * 4. 有什么代价  —— 绑卡/实名/新用户/首充/押金/邀请 N 人
 * 5. 会不会白忙  —— 抽奖、已开奖/已结束/名额已满；以及纯讨论/求助
 *
 * 每个加减都进 reasons，界面上能直接告诉用户「凭什么这个分」。
 */
export const WOOL_SIGNALS = {
  free: /(免费|白送|白嫖|0\s*元|零元|白给|赠送|限免|免单|免费领|送\s*\d|送\s*(会员|额度|流量|时长)|领\s*\d+\s*(元|G|个月|天))/, 
  value: /([¥￥$]\s*\d|\d+(\.\d+)?\s*(元|块|美元|刀|GB|G\b|TB|MB|个月|月|年|天|次|积分|额度|折))/i,
  discount: /(优惠|折扣|立减|券|特价|秒杀|补贴|满减)/,
  action: /(领取|领一下|领到|开领|去领|注册|签到|申请|兑换|下单|直达|点击|链接|评论区|口令|扫码|邀请码)/,
  condition: /(绑卡|绑定信用卡|实名|认证|新用户|仅限新|首充|充值|押金|预付|需购买|会员价|开会员|邀请\s*\d+\s*人|助力|砍一刀)/,
  lottery: /(抽奖|抽\s*\d+\s*(名|位|个|份)|随机|概率|中奖|开奖|锦鲤|摇号)/,
  closed: /(已开奖|已结束|已抢完|名额已满|已截止|已过期|活动结束|已领完)/,
  discussion: /(求推荐|怎么领|有没有|求助|请问|问一下|聊聊|讨论|如何看待)/,
  aff: /(返利|aff|affiliate|推广|小黄车|带货|分销|返佣)/i,
  // 转卖/求购帖：常被上游误标成 freebie，本质是二手交易而不是官方福利
  sell: /(\[出\]|【出】|打包出|转让|出闲置|求购|代收|代购|收\s*[:：])/,
  urgency: /(限时|今日|今天|最后一天|仅剩|倒计时|还剩)/
}

/** 来源可信度：福利版块 > 技术社区 > 软件站（软件站的帖子多是发版信息）。 */
const SOURCE_TRUST = { linuxdo: 10, nodeseek: 8, epic: 8, zcl: 7, v2ex: 6, x: 5, appinn: 3, ghxi: 2, iplaysoft: 2 }

export function scoreWool(item, { now = Date.now() } = {}) {
  const text = `${item.title || ''} ${item.excerpt || ''}`
  const hit = (pattern) => pattern.test(text)
  const reasons = []
  const add = (code, label, delta) => {
    if (delta) reasons.push({ code, label, delta })
  }

  // 上游（资源雷达）已经用 AI 判过 obtain/kind，这类结构化判断比关键词更准，优先采用。
  const hints = item.hints && typeof item.hints === 'object' ? item.hints : {}
  // 只认文本里的免费字样：上游对新闻/交易帖也会标 free，不能单凭它判「可薅」。
  const isFree = hit(WOOL_SIGNALS.free)
  const hasValue = hit(WOOL_SIGNALS.value)
  const hasAction = hints.action === true || hit(WOOL_SIGNALS.action)
  const hasCondition = hints.conditional === true || hit(WOOL_SIGNALS.condition)
  const isLottery = hints.lottery === true || hit(WOOL_SIGNALS.lottery)
  const isClosed = hit(WOOL_SIGNALS.closed)
  const isTalk = hit(WOOL_SIGNALS.discussion)
  const isAff = hit(WOOL_SIGNALS.aff)
  const isDiscount = hints.discount === true || hit(WOOL_SIGNALS.discount)
  const isSell = hit(WOOL_SIGNALS.sell)

  let score = 18
  if (isFree) {
    score += 32
    add('free', '写了免费 / 限免', 32)
  } else if (isDiscount) {
    score += 6
    add('discount', '只是优惠，不是免费', 6)
  }
  if (hasValue) {
    score += 16
    add('value', '有具体数字（钱 / 额度 / 时长）', 16)
  }
  if (hasAction) {
    score += 14
    add('action', '领取方式写清楚了', 14)
  }
  // X 上来自「固定账号时间线」的条目比泛关键词搜索更可信：账号是有人替你筛过的。
  const trust = (SOURCE_TRUST[item.source] || 0) + (item.source === 'x' && item.via === 'account' ? 4 : 0)
  if (trust) {
    score += trust
    add('source', '来自羊毛密度高的来源', trust)
  }

  const age = now - (Date.parse(item.createdAt) || now)
  if (age <= 24 * 3600 * 1000) {
    score += 10
    add('fresh', '24 小时内发布', 10)
  } else if (age <= 3 * 24 * 3600 * 1000) {
    score += 6
    add('fresh', '3 天内发布', 6)
  } else if (age <= 7 * 24 * 3600 * 1000) {
    score += 3
  }

  const left = Date.parse(item.expiresAt) - now
  if (Number.isFinite(left) && left > 0) {
    if (left <= 2 * 24 * 3600 * 1000) {
      score += 6
      add('deadline', '两天内截止，得赶紧', 6)
    } else if (left <= 5 * 24 * 3600 * 1000) {
      score += 3
      add('deadline', '五天内截止', 3)
    }
  }
  if (hit(WOOL_SIGNALS.urgency)) {
    score += 4
    add('urgency', '限时 / 今天', 4)
  }

  if (hasCondition) {
    score -= 22
    add('condition', '有门槛：绑卡 / 实名 / 新用户 / 首充 / 邀请', -22)
  }
  if (isAff) {
    score -= 18
    add('aff', '带返利 / 推广', -18)
  }
  if (isLottery) {
    score -= 26
    add('lottery', '抽奖性质，中不中看运气', -26)
  }
  if (isTalk) {
    score -= 28
    add('talk', '更像讨论 / 求助，不是福利', -28)
  }
  if (isClosed) {
    score -= 45
    add('closed', '活动已结束 / 已开奖', -45)
  }
  if (isSell) {
    score -= 20
    add('sell', '是转卖 / 交易帖，不是官方福利', -20)
  }

  score = Math.max(1, Math.min(100, Math.round(score)))

  // 结论按「能不能真拿到」排序，而不是「像不像羊毛」。
  let tier = 'unknown'
  if (isClosed) tier = 'closed'
  else if (isTalk && !isFree) tier = 'talk'
  else if (isLottery) tier = 'lottery'
  else if (isSell) tier = 'discount'
  else if (isFree && hasCondition) tier = 'conditional'
  else if (isFree) tier = 'claimable'
  else if (isAff || isDiscount) tier = 'discount'

  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return {
    score,
    tier,
    // verdict 沿用旧词表，界面与历史数据都还能对上
    verdict: tier === 'claimable' ? 'free' : tier,
    verified: tier === 'claimable',
    reasons: reasons.slice(0, 5)
  }
}


/**
 * 收录与排序：只留近 7 天、命中关键词、非噪声的条目；
 * 先按 限免 > 免费 > 低价，同标签内按发布时间倒序。
 */
export function buildRadar(rawItems, { now = Date.now(), days = MAX_AGE_DAYS, limit = MAX_RADAR_ITEMS } = {}) {
  const byUrl = new Map()
  for (const raw of rawItems) {
    if (!raw?.url || !raw?.title) continue
    // 带截止时间的（Epic 限免）：过了截止就下版，不再占位。
    const expires = Date.parse(raw.expiresAt)
    if (Number.isFinite(expires) && expires <= now) continue
    if (!withinDays(raw.createdAt, days, now)) continue
    if (isNoise(raw.title) || isNoise(raw.excerpt)) continue
    const text = `${raw.title} ${raw.excerpt}`
    // 游戏是解析器直接判定的分类：游戏名里通常没有「免费」，不该被关键词表挡掉。
    const declaredGame = raw.category === 'game'
    // 上游条目（带 topic）已经被它的 AI 与 kind 闸门筛过一遍，不该再被我们的关键词表挡掉。
    const fromUpstream = Boolean(raw.topic) && raw.source === 'zcl'
    if (!declaredGame && !fromUpstream && !matchesKeywords(text)) continue
    const rawCat = declaredGame ? 'game' : classify(text)
    // 命中关键词但归不到三类的（比如只说「福利」「抽奖」），保留为「一般」，
    // 否则版块里大量有效帖子会被关键词表挡掉。
    const category = rawCat === 'other' ? 'general' : rawCat
    if (byUrl.has(raw.url)) continue
    const graded = scoreWool({ ...raw, category }, { now })
    // 已经结束 / 已开奖的：留在库里只会把真正能领的挤下去，直接不进榜。
    if (graded.tier === 'closed') continue
    byUrl.set(raw.url, {
      ...raw,
      category,
      score: graded.score,
      topic: raw.topic || topicOf(text, category),
      tier: graded.tier,
      reasons: graded.reasons,
      verdict: graded.verdict,
      verified: graded.verified,
      id: raw.url.replace(/[^\w]/g, '').slice(-48)
    })
  }
  return [...byUrl.values()]
    .sort((a, b) => {
      // 羊毛分从高到低；同分再看时间。必须是可传递的全序：
      // 以前写成「差值 ≥5 才比分数」，比较函数不满足传递性，排出来的顺序是随机的。
      const sa = a.score || 0
      const sb = b.score || 0
      if (sb !== sa) return sb - sa
      const ta = Date.parse(a.createdAt) || 0
      const tb = Date.parse(b.createdAt) || 0
      if (tb !== ta) return tb - ta
      return (CATEGORY_PRIORITY[a.category] ?? 9) - (CATEGORY_PRIORITY[b.category] ?? 9)
    })
    .slice(0, limit)
}

// ---- 资源雷达（radar.zichuanlan.top）：公开 JSON 接口，自带 AI 分类与「可领取」判断 ----

export const UPSTREAM_BASE = 'https://radar.zichuanlan.top/api/items'

/**
 * 它的分类 → 我们的主题分类。
 * 只收「能薅」的类目：world / news / headline / tech / finance / stock / hardware / car
 * 是资讯与评测，收进来只会稀释雷达。
 */
export const UPSTREAM_TOPIC = {
  media: 'media',
  ai: 'ai',
  cloud: 'cloud',
  vps: 'vps',
  domain: 'web',
  dev: 'web',
  software: 'web',
  game: 'game',
  goods: 'deal',
  trade: 'deal',
  carpool: 'deal',
  edu: 'edu',
  other: 'other'
}

/** obtain（它的 AI 可领取判断）→ 我们的 hints：直接用它的结论，比关键词准。 */
function upstreamHints(raw) {
  const obtain = String(raw?.obtain || '').toLowerCase()
  const kind = String(raw?.kind || '')
  // 它对「交易/出二手」类帖子也会给 obtain=free，但那些不是羊毛。
  // 只有 kind=freebie（免费领取）才认作免费；deal 一律按特价处理。
  const isFree = kind === 'freebie' && obtain !== 'paid'
  return {
    free: isFree,
    conditional: isFree && obtain === 'conditional',
    lottery: obtain === 'lottery',
    discount: !isFree || obtain === 'paid' || obtain === 'promo'
  }
}

export function parseUpstreamItems(json, { now = Date.now() } = {}) {
  const list = Array.isArray(json?.items) ? json.items : []
  const items = []
  for (const raw of list) {
    if (!raw?.url || !raw?.title) continue
    if (String(raw.status || 'active') !== 'active') continue
    const kind = String(raw.kind || '')
    // 只有 freebie（免费领取）与 deal（特价线报）是羊毛；info / news 是资讯，noise 是噪声。
    // 它的 ai.keep 判得偏松（新闻也会 keep=true），所以在 kind 这一层收口。
    if (kind !== 'freebie' && kind !== 'deal') continue
    // noise / news 基本没有可领的东西；freebie 与 deal 才是羊毛
    if (kind === 'noise' || kind === 'news') continue
    const topic = UPSTREAM_TOPIC[String(raw.category || '')]
    if (!topic) continue
    const expires = Date.parse(raw.expires_at)
    if (Number.isFinite(expires) && expires <= now) continue
    const created = Date.parse(raw.published_at) || Date.parse(raw.first_seen_at) || now
    const hints = upstreamHints(raw)
    // 两个独立判断要一致：它说免费，但标题/摘要里看不出任何免费字样（新闻、评测常被这样误标），
    // 就降级成特价，让用户自己点进去判断，而不是替他拍板。
    const looksFree = /(免费|白送|赠送|领取|限免|0\s*元|零元|试用|送\s*\d)/.test(raw.title + ' ' + (raw.summary || ''))
    if (hints.free && !looksFree) {
      hints.free = false
      hints.discount = true
    }
    items.push({
      source: 'zcl',
      title: String(raw.title).slice(0, 300),
      url: String(raw.url),
      excerpt: String(raw.summary || '').slice(0, 300),
      author: String(raw.author || ''),
      createdAt: new Date(created).toISOString(),
      expiresAt: Number.isFinite(expires) ? new Date(expires).toISOString() : '',
      topic,
      hints,
      heat: 0
    })
  }
  return items
}

/** 抓 N 页（默认 3 页 × 100 条）；某一页失败不影响已拿到的。 */
export async function fetchUpstream({ fetchImpl = fetch, pages = 3, limit = 100, now = Date.now(), attempts = 3, waitMs = 600 } = {}) {
  const items = []
  const errors = []
  for (let page = 0; page < pages; page += 1) {
    const url = UPSTREAM_BASE + '?limit=' + limit + '&offset=' + (page * limit) + '&sort=newest'
    try {
      let text = ''
      let lastError = null
      // 这个接口也会偶发冷启动超时（和 Epic 一样的毛病），所以每页重试几次再放弃。
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          text = await getText(url, { fetchImpl, accept: 'application/json', timeoutMs: 20000 })
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
      }
      if (lastError) throw lastError
      let json
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error('返回的不是合法 JSON')
      }
      items.push(...parseUpstreamItems(json, { now }))
      if (!Array.isArray(json?.items) || json.items.length < limit) break
    } catch (error) {
      errors.push('资源雷达第 ' + (page + 1) + ' 页：' + (error?.message || error))
      break
    }
  }
  return { items, errors }
}

/**
 * 主题分类（「这是什么」）—— 与价格分类（「多少钱」）分开：
 * 一条「B 站大会员免费领」既是「免费」也是「影音会员」，两个维度不该挤在同一排。
 */
export const TOPICS = [
  { id: 'media', name: '影音会员' },
  { id: 'ai', name: 'AI 额度' },
  { id: 'cloud', name: '云服务' },
  { id: 'vps', name: 'VPS/主机' },
  { id: 'web', name: '域名/建站' },
  { id: 'game', name: '游戏' },
  { id: 'deal', name: '实物/拼车' },
  { id: 'edu', name: '学习/教育' },
  { id: 'other', name: '其他' }
]

const TOPIC_RULES = [
  ['game', /(游戏|Steam|Epic|PSN|Switch|Xbox)/i],
  ['media', /(会员|影视|电影|剧集|Netflix|Spotify|B站|大会员|爱奇艺|优酷|腾讯视频|音乐|VIP)/i],
  ['ai', /(GPT|Claude|Gemini|OpenAI|API|token|额度|大模型|\bAI\b)/i],
  ['cloud', /(云服务器|云盘|对象存储|CDN|数据库|函数计算|阿里云|腾讯云|华为云|AWS|Azure|Oracle|甲骨文)/i],
  ['vps', /(VPS|主机|服务器|独立IP|CN2|中转|节点|机场|流量)/i],
  ['web', /(域名|建站|SSL|证书|WordPress|图床|备案|解析)/i],
  ['deal', /(拼车|合租|实物|手办|耳机|显示器|充电器)/],
  ['edu', /(课程|教程|学习|考试|教育|网课)/]
]

/** 自有来源没有 topic 字段：按标题/摘要推断一个，前端就能用同一套筛选。 */
export function topicOf(text, category) {
  if (category === 'game') return 'game'
  const t = String(text || '')
  for (const [topic, pattern] of TOPIC_RULES) {
    if (pattern.test(t)) return topic
  }
  return 'other'
}
