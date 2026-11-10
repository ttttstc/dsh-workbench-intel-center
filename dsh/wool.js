/**
 * Token 羊毛页面的转发与改造。
 *
 * 源站带 X-Frame-Options: SAMEORIGIN，直接 iframe 会被浏览器拦掉，所以由本机服务端取回 HTML，
 * 注入 <base> 让相对资源仍指向源站，再由前端用「无 allow-same-origin」的沙箱 iframe 展示——
 * 页面有自己的来源隔离，拿不到宿主与工作台的任何对象。
 *
 * 这里只有纯函数与一个带缓存的小抓取器，方便单独测试。
 */

export const WOOL_URL = 'https://aihot.news/free-tokens'
export const WOOL_ORIGIN = 'https://aihot.news'
export const CACHE_TTL_MS = 5 * 60 * 1000

/** 去掉 meta CSP、注入 <base>，其他内容一律不动。 */
export function prepareEmbedHtml(html, origin = WOOL_ORIGIN) {
  if (typeof html !== 'string' || html.length === 0) throw new Error('源站返回了空页面。')
  let out = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')
  const base = `<base href="${origin}/">`
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, (match, attrs) => `<head${attrs}>${base}`)
  } else {
    out = base + out
  }
  return out
}

/** 页面里脚本若在沙箱内跑不通，至少要能读文字：给最终兜底用。 */
export function stripScripts(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
}

export function createWoolFetcher({ url = WOOL_URL, origin = WOOL_ORIGIN, ttl = CACHE_TTL_MS, timeoutMs = 15000 } = {}) {
  let cached = null
  let inflight = null

  async function fetchFresh() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DSH-Workbench/1',
          accept: 'text/html,application/xhtml+xml'
        },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`源站返回 ${response.status}`)
      const html = await response.text()
      return { html, fetchedAt: new Date().toISOString(), url }
    } finally {
      clearTimeout(timer)
    }
  }

  async function load() {
    const value = await fetchFresh()
    // TTL 从抓取完成时算起，否则抓多久就少缓存多久。
    cached = { at: Date.now(), value }
    return value
  }

  return async function get({ force = false } = {}) {
    if (!force && cached && Date.now() - cached.at < ttl) {
      return { ...cached.value, cached: true }
    }
    // 并发请求共用同一次上游抓取：接口被连点或两个视图同时打开时不会重复打源站。
    if (inflight) {
      const value = await inflight
      return { ...value, cached: true }
    }
    inflight = load()
    try {
      const value = await inflight
      return { ...value, cached: false }
    } catch (error) {
      // 抓不到新页面时，旧缓存比一张 502 错误页有用。
      if (cached) {
        return { ...cached.value, cached: true, stale: true, error: String(error?.message || error) }
      }
      throw error
    } finally {
      inflight = null
    }
  }
}
