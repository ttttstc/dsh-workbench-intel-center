/**
 * 本机接口的具体实现。
 *
 * 与 server.js 分开的原因：server.js 必须静态导入宿主的 Schemastery（Config 的要求），
 * 而这份逻辑没有任何外部依赖，可以脱离宿主直接用 node --test 跑真实请求。
 *
 * 抓取这类几十秒到几分钟的任务不再占住 HTTP 请求：POST 只负责启动，状态与结果从
 * /radar/status、/x/status 读（见 jobs.js）。界面据此轮询，失败原因也留在状态里，
 * 不再只剩一句笼统文案。
 */
import { MAX_STATE_BYTES, createIntelStore } from './store.js'
import { ValidationError, mergeState, normalizeState } from './model.js'
import { WOOL_ORIGIN, WOOL_URL, createWoolFetcher, prepareEmbedHtml } from './wool.js'
import { BROWSER_SOURCES, DEFAULT_KEYWORDS, crawlBrowserFeeds, crawlBrowserSources, crawlX } from './crawler.js'
import { RUN_HOURS, createTickScheduler, nextRunAt, normalizeSettings } from './schedule.js'
import { MAX_AGE_DAYS, MAX_RADAR_ITEMS, SOURCES, buildRadar, collectServerSources } from './sources.js'
import { createJob, lastRunOf } from './jobs.js'
import { API_VERSION, X_TOP_LIMIT, todayISO } from '../src/shared/core.js'

const PREFIX = '/api/intel-center'
const RADAR_KEYWORDS = ['免费', '限免', '优惠']

/** 同一数据目录只允许一个调度器：插件被重复 apply 时不会一天跑两遍抓取。 */
const schedulers = new Map()

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_STATE_BYTES) {
    throw new ValidationError('请求体过大。', 413)
  }
  const reader = request.body?.getReader()
  if (!reader) throw new ValidationError('请求需要一个 JSON 请求体。')
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_STATE_BYTES) {
        await reader.cancel()
        throw new ValidationError('请求体过大。', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ValidationError('请求体不是合法 JSON。')
  }
}

/**
 * @param ctx 宿主上下文（只用 ctx.connection.fetch.register 与 ctx.effect）
 * @param config 插件配置（root：数据目录）
 * @param pluginName 插件名，meta 接口会回显
 * @param deps 可替换依赖，仅测试用：store / now / collectServerSources / crawlBrowserFeeds / crawlX / keywords / jobTimeoutMs / startScheduler
 */
export function apply(ctx, config, pluginName = 'dsh-workbench-intel-center', deps = {}) {
  const store = deps.store || createIntelStore(config.root)
  const now = deps.now || (() => new Date())
  const keywords = Array.isArray(deps.keywords) && deps.keywords.length ? deps.keywords : DEFAULT_KEYWORDS
  const fetchServerSources = deps.collectServerSources || collectServerSources
  const fetchBrowserFeeds = deps.crawlBrowserFeeds || crawlBrowserFeeds
  const fetchBrowserSources = deps.crawlBrowserSources || crawlBrowserSources
  const fetchX = deps.crawlX || crawlX
  const jobTimeoutMs = Number.isFinite(deps.jobTimeoutMs) ? deps.jobTimeoutMs : 300000
  const noStore = { 'cache-control': 'no-store' }
  const json = (payload, status = 200) => Response.json(payload, { status, headers: noStore })
  const fail = (error, fallback) => {
    const known = error instanceof ValidationError
    if (!known) console.error(`[intel-center] ${fallback}`, error)
    const body = { error: known ? error.message : fallback }
    // 本机接口，把原始原因一并回传，界面与 Agent 都能看懂到底哪一步坏了。
    if (!known) body.detail = String(error?.message || error)
    return json(body, known ? error.status : 500)
  }

  let nextRunAtValue = nextRunAt(now(), RUN_HOURS)

  // ---- 羊毛雷达：V2EX / 小众软件（直连）+ LINUX DO / NodeSeek（浏览器） ----
  /** 把一批原始条目合并进 state.radar（保留近 7 天，自动去重与淘汰）。 */
  async function mergeIntoRadar(rawItems, at) {
    const current = await store.read()
    const merged = buildRadar([...(current.radar?.items || []), ...rawItems], {
      now: Date.parse(at) || now().getTime(),
      days: MAX_AGE_DAYS
    })
    await store.write({
      ...current,
      radar: {
        updatedAt: at,
        date: todayISO(new Date(at)),
        keywords: RADAR_KEYWORDS,
        items: merged
      }
    })
    return merged
  }

  async function runRadar(reason) {
    const startedAt = now().toISOString()
    // 先跑直连源。哪个源「0 条且有错」就改走浏览器通道——不再靠错误文案里有没有「LINUX DO」
    // 来判断：403 / Cloudflare / 与系统代理不同的出口 IP，都会落到这条路径上。
    const server = await fetchServerSources()
    const perSource = server.perSource || []
    const blocked = perSource
      .filter((item) => item.count === 0 && item.errors.length && BROWSER_SOURCES[item.id])
      .map((item) => item.id)
    const browser = blocked.length
      ? await fetchBrowserSources({ sources: blocked, log: () => {} })
        .catch((error) => ({ items: [], errors: [String(error?.message || error)] }))
      : { items: [], errors: [] }
    const all = [...(server.items || []), ...(browser.items || [])]
    const errors = [...(server.errors || []), ...(browser.errors || [])]
    const merged = await mergeIntoRadar(all, startedAt)
    const bySource = {}
    for (const item of all) {
      if (!item?.source) continue
      bySource[item.source] = (bySource[item.source] || 0) + 1
    }
    const result = {
      ok: true,
      count: merged.length,
      fresh: all.length,
      serverCount: (server.items || []).length,
      browserCount: (browser.items || []).length,
      browserSkipped: blocked.length === 0,
      browserSources: blocked,
      bySource,
      errors,
      reason
    }
    await appendRun({ startedAt, trigger: reason, ok: true, count: all.length, errors })
    return result
  }

  // ---- X 榜单：同一套流程，只是来源是 X 搜索页 ----
  async function runX(reason) {
    const startedAt = now().toISOString()
    const { items, errors, scanned } = await fetchX({ keywords, limit: X_TOP_LIMIT })
    const current = await store.read()
    // 与历史合并：X 单页每次只能拿到一部分，按 id 去重后保留最新（按发布时间倒序）的 N 条。
    // 取最近的不取点赞最高的：用户要的是「最近有什么羊毛」，点赞量仍然显示在卡片上。
    const byId = new Map()
    for (const item of current.x?.items || []) if (item?.id) byId.set(item.id, item)
    for (const item of items) if (item?.id) byId.set(item.id, { ...byId.get(item.id), ...item })
    const merged = [...byId.values()]
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
      .slice(0, X_TOP_LIMIT)
      .map((item, index) => ({ ...item, rank: index + 1 }))
    await store.write({
      ...current,
      x: {
        updatedAt: startedAt,
        date: todayISO(new Date(startedAt)),
        keywords,
        items: merged
      }
    })
    const result = { ok: true, count: merged.length, fresh: items.length, scanned, errors, reason }
    await appendRun({ startedAt, trigger: reason, ok: true, count: items.length, errors })
    return result
  }

  /**
   * 运行记录：定时 / 手动都记一笔（时间、触发方式、条数、耗时、首个错误）。
   *
   * 以前只有内存里的最后一次状态，重启就失忆，用户没有依据判断「定时任务到底跑没跑」。
   * 顺带把 errors 的前两条留下，界面上就能看到「这次是哪个源被挡了」。
   */
  async function appendRun({ startedAt, trigger, ok, count, errors }) {
    try {
      const current = await store.read()
      const at = now().toISOString()
      const entry = {
        at: startedAt,
        trigger: trigger === 'scheduled' ? 'scheduled' : 'manual',
        ok: ok !== false,
        count: Math.max(0, Math.round(Number(count) || 0)),
        ms: Math.max(0, Date.parse(at) - Date.parse(startedAt) || 0),
        error: (errors || []).filter(Boolean).slice(0, 2).join('；').slice(0, 200)
      }
      const runs = [entry, ...(current.schedule?.runs || [])].slice(0, 20)
      await store.write({ ...current, schedule: { ...(current.schedule || {}), runs } })
    } catch (error) {
      console.error(`[intel-center] 写运行记录失败：${error?.message || error}`)
    }
  }

  /** 标记「这个槽位处理过了」：不管成功失败都要写，否则调度器会每 60 秒重试一次。 */
  async function markSlotRan(trigger) {
    try {
      const current = await store.read()
      await store.write({
        ...current,
        schedule: {
          ...(current.schedule || {}),
          lastRunAt: now().toISOString(),
          lastTrigger: trigger === 'scheduled' ? 'scheduled' : 'manual'
        }
      })
    } catch (error) {
      console.error(`[intel-center] 写调度状态失败：${error?.message || error}`)
    }
  }

  const logFailure = (label) => (snapshot) => {
    if (snapshot.status === 'failed') console.error(`[intel-center] ${label}失败：${snapshot.error}`)
  }

  let radarReason = 'manual'
  const radarJob = createJob({
    name: 'radar',
    now,
    timeoutMs: jobTimeoutMs,
    run: () => runRadar(radarReason),
    onSettled: logFailure('羊毛雷达刷新')
  })
  let xReason = 'manual'
  const xJob = createJob({
    name: 'x',
    now,
    timeoutMs: jobTimeoutMs,
    run: () => runX(xReason),
    onSettled: logFailure('X 榜单刷新')
  })

  function startRadar(reason = 'manual') {
    radarReason = reason === 'scheduled' ? 'scheduled' : 'manual'
    return radarJob.start(radarReason)
  }

  function startX(reason = 'manual') {
    xReason = reason === 'scheduled' ? 'scheduled' : 'manual'
    return xJob.start(xReason)
  }

  // 调度器改成「每 60 秒检查一次有没有该跑的槽位」，而不是一次性的 setTimeout：
  // - 睡眠 / 关机 / 进程重启后能补跑最近错过的槽位（6 小时窗口内）
  // - 设置改完立刻生效（每次 tick 都从 state 里读）
  // - 上次运行时间持久化在 state.schedule 里，重启不会重复跑、也不会忘记跑
  let tickCache = null
  async function readStateCached() {
    const at = Date.now()
    if (tickCache && at - tickCache.at < 1000) return tickCache.state
    const state = await store.read()
    tickCache = { at, state }
    return state
  }

  const scheduler = createTickScheduler({
    now,
    tickMs: Number.isFinite(deps.tickMs) ? deps.tickMs : undefined,
    getSettings: async () => normalizeSettings((await readStateCached()).settings),
    getLastRunAt: async () => (await readStateCached()).schedule?.lastRunAt || '',
    onDue: async () => {
      try {
        startRadar('scheduled')
        await radarJob.wait()
        startX('scheduled')
        await xJob.wait()
      } finally {
        // 成功失败都算「这个槽位已经处理过」，否则会每 60 秒重试一次
        await markSlotRan('scheduled')
      }
    },
    onScheduled: (next) => {
      nextRunAtValue = next
    },
    onError: (error) => console.error(`[intel-center] 定时调度失败：${error?.message || error}`)
  })
  const schedulerKey = String(config.root)
  if (deps.startScheduler !== false) {
    const previous = schedulers.get(schedulerKey)
    if (previous && previous !== scheduler) previous.stop()
    schedulers.set(schedulerKey, scheduler)
    scheduler.start()
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      scheduler.stop()
      if (schedulers.get(schedulerKey) === scheduler) schedulers.delete(schedulerKey)
    })
  }

  ctx.connection.fetch.register({
    path: `${PREFIX}/radar/status`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      const state = await store.read()
      const settings = normalizeSettings(state.settings)
      const next = nextRunAtValue instanceof Date && Number.isFinite(nextRunAtValue.getTime())
        ? nextRunAtValue
        : nextRunAt(now(), settings.scheduler.hours)
      return json({
        nextRunAt: next.toISOString(),
        hours: settings.scheduler.hours,
        enabled: settings.scheduler.enabled,
        catchUp: settings.scheduler.catchUp,
        retentionDays: settings.retentionDays,
        schedule: state.schedule || { lastRunAt: '', lastTrigger: '', runs: [] },
        running: radarJob.running,
        limit: MAX_RADAR_ITEMS,
        sources: SOURCES,
        job: radarJob.snapshot(),
        last: lastRunOf(radarJob)
      })
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/radar/refresh`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const payload = await readJsonBody(request).catch(() => ({}))
      const started = startRadar(payload?.reason === 'scheduled' ? 'scheduled' : 'manual')
      return json(started, started.started ? 202 : 200)
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/x/status`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      return json({
        nextRunAt: nextRunAtValue.toISOString(),
        hours: RUN_HOURS,
        running: xJob.running,
        limit: X_TOP_LIMIT,
        job: xJob.snapshot(),
        last: lastRunOf(xJob)
      })
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/x/refresh`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const payload = await readJsonBody(request).catch(() => ({}))
      const started = startX(payload?.reason === 'scheduled' ? 'scheduled' : 'manual')
      return json(started, started.started ? 202 : 200)
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/meta`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        return json({ plugin: pluginName, version: 1, apiVersion: API_VERSION, ...(await store.meta()) })
      } catch (error) {
        return fail(error, '无法读取情报数据位置。')
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/state`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request?.method === 'POST') {
          const payload = await readJsonBody(request)
          const current = await store.read()
          // 整份覆盖会丢掉刚抓到的榜单：卡片归用户、榜单归抓取任务，按 mergeState 的规则合并后再写。
          let merged = mergeState(current, payload)
          let conflict = false
          if (payload?.baseUpdatedAt && current.updatedAt && payload.baseUpdatedAt !== current.updatedAt) {
            // 界面读完之后文件被别处（Agent 或另一个窗口）改过：卡片按 id 合并，谁都不覆盖谁。
            conflict = true
            const incoming = normalizeState(merged)
            const ids = new Set(incoming.cards.map((card) => card.id))
            const extra = current.cards.filter((card) => !ids.has(card.id))
            merged = extra.length ? { ...incoming, cards: [...incoming.cards, ...extra] } : incoming
          }
          const { state, bytes } = await store.write(merged)
          return json({ state, bytes, conflict })
        }
        return json({ state: await store.read() })
      } catch (error) {
        return fail(error, '无法处理情报数据请求。')
      }
    }
  })

  // Token 羊毛：源站带 X-Frame-Options: SAMEORIGIN，直接 iframe 会被拦，
  // 这里取回 HTML、注入 <base> 后由本机同源转发，前端用沙箱 iframe 展示。
  const getWool = deps.woolFetcher || createWoolFetcher()

  ctx.connection.fetch.register({
    path: `${PREFIX}/wool`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const force = new URL(request?.url ?? 'http://localhost').searchParams.get('force') === '1'
      try {
        const { html, fetchedAt, cached } = await getWool({ force })
        return json({ source: WOOL_URL, origin: WOOL_ORIGIN, fetchedAt, cached, bytes: Buffer.byteLength(html, 'utf8') })
      } catch (error) {
        return json({ source: WOOL_URL, error: error?.message || '无法读取 Token 羊毛页面。' }, 502)
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/wool/page`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const force = new URL(request?.url ?? 'http://localhost').searchParams.get('force') === '1'
      try {
        const { html, fetchedAt, cached } = await getWool({ force })
        return new Response(prepareEmbedHtml(html, WOOL_ORIGIN), {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': cached ? 'private, max-age=60' : 'no-store',
            'x-intel-fetched-at': fetchedAt
          }
        })
      } catch (error) {
        return new Response(
          `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px;line-height:1.7">`
          + `<p><strong>暂时取不到 Token 羊毛页面</strong></p><p>${String(error?.message || error)}</p>`
          + `<p><a href="${WOOL_URL}" target="_blank" rel="noreferrer noopener">在新窗口打开源页面</a></p></body>`,
          { status: 502, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
        )
      }
    }
  })

  return { store, radarJob, xJob, scheduler, startRadar, startX }
}
