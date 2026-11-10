/**
 * 本机接口的具体实现。
 *
 * 与 server.js 分开的原因：server.js 必须静态导入宿主的 Schemastery（Config 的要求），
 * 而这份逻辑没有任何外部依赖，可以脱离宿主直接用 node --test 跑真实请求。
 */
import { MAX_STATE_BYTES, createIntelStore } from './store.js'
import { ValidationError } from './model.js'
import { WOOL_ORIGIN, WOOL_URL, createWoolFetcher, prepareEmbedHtml } from './wool.js'
import { DEFAULT_KEYWORDS, crawlBrowserFeeds, crawlX } from './crawler.js'
import { RUN_HOURS, createRefreshScheduler, nextRunAt } from './schedule.js'
import { MAX_AGE_DAYS, SOURCES, buildRadar, collectServerSources } from './sources.js'

const PREFIX = '/api/intel-center'

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

export function apply(ctx, config, pluginName = 'dsh-workbench-intel-center') {
  const store = createIntelStore(config.root)
  const noStore = { 'cache-control': 'no-store' }
  const json = (payload, status = 200) => Response.json(payload, { status, headers: noStore })
  const fail = (error, fallback) => {
    const known = error instanceof ValidationError
    return json({ error: known ? error.message : fallback }, known ? error.status : 500)
  }

  // ---- X 榜单：手动刷新 + 每天 09:00 / 14:00 / 21:00 自动刷新 ----
  let lastXRun = { at: '', ok: null, count: 0, error: '', reason: '' }
  let nextXRunAt = nextRunAt(new Date())
  let xRunning = false

  async function refreshX(reason) {
    if (xRunning) return { ok: false, skipped: true, reason: 'already-running', count: lastXRun.count }
    xRunning = true
    const startedAt = new Date().toISOString()
    try {
      const { items, errors, scanned } = await crawlX({ keywords: DEFAULT_KEYWORDS, limit: 500 })
      const current = await store.read()
      // 与历史合并：X 单页能拿到的新帖有限，按 id 去重后保留点赞最高的 50 条，榜单会逐次累积。
      const byId = new Map()
      for (const item of current.x?.items || []) if (item?.id) byId.set(item.id, item)
      for (const item of items) if (item?.id) byId.set(item.id, { ...byId.get(item.id), ...item })
      const merged = [...byId.values()]
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 500)
        .map((item, index) => ({ ...item, rank: index + 1 }))
      await store.write({
        ...current,
        x: {
          updatedAt: startedAt,
          date: startedAt.slice(0, 10),
          keywords: DEFAULT_KEYWORDS,
          items: merged
        },
        updatedAt: startedAt
      })
      lastXRun = { at: startedAt, ok: true, count: merged.length, error: errors.join('；'), reason }
      return { ok: true, count: merged.length, fresh: items.length, scanned, errors, reason }
    } catch (error) {
      lastXRun = { at: startedAt, ok: false, count: 0, error: String(error?.message || error), reason }
      throw error
    } finally {
      xRunning = false
    }
  }

  // ---- 羊毛雷达：V2EX / 小众软件（直连）+ linux.do / NodeSeek（浏览器） ----
  let lastRadarRun = { at: '', ok: null, count: 0, error: '', reason: '' }
  let nextRadarRunAt = nextRunAt(new Date())
  let radarRunning = false

  let browserFilling = false

  /** 把一批原始条目合并进 state.radar（保留近 7 天，自动去重与淘汰）。 */
  async function mergeIntoRadar(rawItems, at) {
    const current = await store.read()
    const merged = buildRadar([...(current.radar?.items || []), ...rawItems], {
      now: Date.parse(at),
      days: MAX_AGE_DAYS
    })
    await store.write({
      ...current,
      radar: {
        updatedAt: at,
        date: at.slice(0, 10),
        keywords: ['免费', '限免', '优惠'],
        items: merged
      },
      updatedAt: at
    })
    return merged
  }

  /** 浏览器通道：NodeSeek 必走；LINUX DO 直连被拦时也能兜住。抓完直接并进榜单。 */
  function fillFromBrowser(reason) {
    if (browserFilling) return
    browserFilling = true
    setTimeout(async () => {
      try {
        const browser = await crawlBrowserFeeds({ log: () => {} })
        const at = new Date().toISOString()
        const merged = await mergeIntoRadar(browser.items, at)
        lastRadarRun = {
          ...lastRadarRun,
          at,
          count: merged.length,
          browserCount: browser.items.length,
          error: [lastRadarRun.error, ...(browser.errors || [])].filter(Boolean).join('；'),
          reason
        }
      } catch (error) {
        lastRadarRun = {
          ...lastRadarRun,
          error: [lastRadarRun.error, `浏览器补抓：${error?.message || error}`].filter(Boolean).join('；')
        }
      } finally {
        browserFilling = false
      }
    }, 0)
  }

  async function refreshRadar(reason = 'manual') {
    if (radarRunning) return { ok: false, skipped: true, reason: 'already-running', count: lastRadarRun.count }
    radarRunning = true
    const startedAt = new Date().toISOString()
    try {
      // 先抓三个直连源并立刻落库，界面刷新马上能看到结果。
      const server = await collectServerSources()
      // 全量：直连 + 浏览器通道一次跑完再返回，避免「刷新后还要等后台补」。
      const browser = await crawlBrowserFeeds({ log: () => {} }).catch((error) => ({ items: [], errors: [String(error?.message || error)] }))
      const all = [...server.items, ...browser.items]
      const allErrors = [...(server.errors || []), ...(browser.errors || [])]
      const merged = await mergeIntoRadar(all, startedAt)
      lastRadarRun = {
        at: startedAt,
        ok: true,
        count: merged.length,
        error: allErrors.join('；'),
        reason
      }
      return {
        ok: true,
        count: merged.length,
        fresh: all.length,
        errors: allErrors,
        browserPending: false,
        reason
      }
    } catch (error) {
      lastRadarRun = { at: startedAt, ok: false, count: 0, error: String(error?.message || error), reason }
      throw error
    } finally {
      radarRunning = false
    }
  }
  const scheduler = createRefreshScheduler({
    run: async () => {
      // 每 4 小时：先抓能直连的来源（V2EX / 小众软件），再尽力补 X（CDP）。
      try {
        await refreshRadar('scheduled')
      } catch {
        /* 记录在 lastRadarRun 里 */
      }
      try {
        await refreshX('scheduled')
      } catch {
        /* 记录在 lastXRun 里 */
      }
    },
    onScheduled: (next) => {
      nextXRunAt = next
      nextRadarRunAt = next
    }
  })
  scheduler.start()
  if (typeof ctx.effect === 'function') ctx.effect(() => () => scheduler.stop())

  ctx.connection.fetch.register({
    path: `${PREFIX}/radar/status`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      return json({
        nextRunAt: nextRadarRunAt.toISOString(),
        hours: RUN_HOURS,
        running: radarRunning,
        retentionDays: MAX_AGE_DAYS,
        sources: SOURCES,
        last: lastRadarRun
      })
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/radar/refresh`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch() {
      try {
        const payload = await readJsonBody(request).catch(() => ({}))
        return json(await refreshRadar(payload?.reason === 'scheduled' ? 'scheduled' : 'manual'))
      } catch (error) {
        return fail(error, '抓取羊毛雷达失败。')
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/x/status`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      return json({
        nextRunAt: nextXRunAt.toISOString(),
        hours: [9, 14, 21],
        running: xRunning,
        limit: 500,
        last: lastXRun
      })
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/x/refresh`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const payload = await readJsonBody(request).catch(() => ({}))
        const reason = payload?.reason === 'scheduled' ? 'scheduled' : 'manual'
        return json(await refreshX(reason))
      } catch (error) {
        return fail(error, '抓取 X 失败：请确认 Chrome 已开启远程调试，且 web-access 的 CDP 代理在运行。')
      }
    }
  })

  ctx.connection.fetch.register({
    path: `${PREFIX}/meta`,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        return json({ plugin: pluginName, version: 1, ...(await store.meta()) })
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
          const { state, bytes } = await store.write(payload)
          return json({ state, bytes })
        }
        return json({ state: await store.read() })
      } catch (error) {
        return fail(error, '无法处理情报数据请求。')
      }
    }
  })

  // Token 羊毛：源站带 X-Frame-Options: SAMEORIGIN，直接 iframe 会被拦，
  // 这里取回 HTML、注入 <base> 后由本机同源转发，前端用沙箱 iframe 展示。
  const getWool = createWoolFetcher()

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
}
