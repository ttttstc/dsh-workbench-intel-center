/**
 * 通过 web-access 的 CDP 代理（http://localhost:3456）抓 X 顶部帖子。
 *
 * 为什么走 CDP：X 的搜索需要登录态，插件自己不存任何 cookie/token，
 * 直接用用户 Chrome 已经登录的会话；每次抓取自建后台 tab，抓完立刻关掉。
 */

import { parseNodeSeek, parseRss } from './sources.js'

export const CDP_BASE = 'http://localhost:3456'
export const DEFAULT_KEYWORDS = ['羊毛', '薅', '薅羊毛', '羊毛 免费', '白嫖', '免费领取']

/** 在页面里执行的抽取脚本：把 article 节点转成结构化帖子。 */
export const EXTRACT_JS = `(() => {
  const num = (s) => { s = (s || "").trim(); if (!s) return 0; const m = s.match(/([\\d.,]+)\\s*(万|千|[KkMm])?/); if (!m) return 0; let n = parseFloat(m[1].replace(/,/g, "")); const u = (m[2] || "").toUpperCase(); if (u === "万") n *= 1e4; else if (u === "千" || u === "K") n *= 1e3; else if (u === "M") n *= 1e6; return Math.round(n); };
  const out = [];
  document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
    const t = a.querySelector('[data-testid="tweetText"]');
    const text = t ? t.innerText.replace(/\\s+/g, " ").trim() : "";
    if (!text) return;
    const links = Array.from(a.querySelectorAll('a[href*="/status/"]')).map((x) => x.href);
    const time = a.querySelector("time");
    const un = a.querySelector('[data-testid="User-Name"]');
    const like = a.querySelector('[data-testid="like"]');
    const reply = a.querySelector('[data-testid="reply"]');
    const rt = a.querySelector('[data-testid="retweet"]');
    const userText = un ? un.innerText.replace(/\\s+/g, " ").trim() : "";
    out.push({
      title: text.length > 400 ? text.slice(0, 400) : text,
      author: userText.split(" ")[0],
      handle: (userText.match(/@[\\w.]+/) || [""])[0],
      likes: num(like ? like.innerText : ""),
      replies: num(reply ? reply.innerText : ""),
      reposts: num(rt ? rt.innerText : ""),
      url: (links[0] || "").split("?")[0],
      createdAt: time ? time.getAttribute("datetime") : ""
    });
  });
  return JSON.stringify(out);
})()`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 用真实 HTTP 打 CDP 代理；测试时替换成假的。 */
export function createCdpClient(base = CDP_BASE) {
  async function call(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'content-type': 'text/plain; charset=utf-8' } : undefined,
        body,
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`CDP ${path} 返回 ${response.status}`)
      const type = response.headers.get('content-type') || ''
      return type.includes('json') ? await response.json() : await response.text()
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    newTab: async (url) => {
      const data = await call(`/new?url=${encodeURIComponent(url)}`)
      const payload = typeof data === 'string' ? JSON.parse(data) : data
      if (!payload?.targetId) throw new Error('CDP 没能创建浏览器标签页')
      return payload.targetId
    },
    eval: async (target, js) => {
      const data = await call(`/eval?target=${encodeURIComponent(target)}`, { method: 'POST', body: js })
      const payload = typeof data === 'string' ? JSON.parse(data) : data
      return payload?.value
    },
    scrollBottom: (target) => call(`/scroll?target=${encodeURIComponent(target)}&direction=bottom`),
    close: (target) => call(`/close?target=${encodeURIComponent(target)}`)
  }
}

/**
 * 抓取主流程：多关键词 → 滚动 → 抽取 → 去重 → 按点赞降序取前 limit 条。
 * 任何单条链路失败都不会中断整体：记录下来继续下一个关键词。
 */
export async function crawlX({
  cdp = createCdpClient(),
  keywords = DEFAULT_KEYWORDS,
  limit = 50,
  scrolls = 6,
  pageWaitMs = 6000,
  scrollWaitMs = 2500,
  log = () => {}
} = {}) {
  const seen = new Map()
  const errors = []
  for (const keyword of keywords) {
    let tabId = null
    try {
      tabId = await cdp.newTab(`https://x.com/search?q=${encodeURIComponent(keyword)}&f=top`)
      await sleep(pageWaitMs)
      for (let round = 0; round < scrolls; round += 1) {
        const raw = await cdp.eval(tabId, EXTRACT_JS)
        if (raw) {
          let parsed = []
          try {
            parsed = JSON.parse(raw)
          } catch {
            parsed = []
          }
          for (const post of parsed) {
            if (post?.url && !seen.has(post.url)) seen.set(post.url, post)
          }
        }
        await cdp.scrollBottom(tabId)
        await sleep(scrollWaitMs)
      }
      log(`关键词「${keyword}」累计去重 ${seen.size} 条`)
    } catch (error) {
      errors.push(`「${keyword}」${error?.message || error}`)
      log(`关键词「${keyword}」失败：${error?.message || error}`)
    } finally {
      if (tabId) {
        try {
          await cdp.close(tabId)
        } catch {
          /* 关不掉不影响结果 */
        }
      }
    }
  }

  const items = [...seen.values()]
    .filter((post) => post.url && post.title)
    .sort((a, b) => (b.likes || 0) - (a.likes || 0))
    .slice(0, limit)
    .map((post, index) => ({
      id: (post.url.match(/status\/(\d+)/) || [])[1] || `x-${index + 1}`,
      rank: index + 1,
      title: post.title,
      url: post.url,
      author: post.author || '',
      handle: post.handle || '',
      likes: post.likes || 0,
      reposts: post.reposts || 0,
      replies: post.replies || 0,
      createdAt: post.createdAt || '',
      excerpt: ''
    }))

  return { items, errors, scanned: seen.size }
}

/**
 * 两个有登录墙 / Cloudflare 的站：借浏览器页面内的 fetch 取数据，再用 Node 侧解析。
 * linux.do 用 /latest.rss（匿名可取 30 条）；NodeSeek 用首页 HTML 里的 /post-<id> 链接。
 *
 * includeLinuxdo / includeNodeSeek：直连成功的源不该再被浏览器抓一遍（NodeSeek 现在有官方 RSS，
 * 通常直连就能拿到），所以由调用方按「哪些源直连失败」决定要跑哪几段。
 */
export async function crawlBrowserFeeds({
  cdp = createCdpClient(),
  pageWaitMs = 6000,
  includeLinuxdo = true,
  includeNodeSeek = true,
  log = () => {}
} = {}) {
  const items = []
  const errors = []

  if (includeLinuxdo) try {
    const tab = await cdp.newTab('https://linux.do/c/welfare/36')
    try {
      await sleep(pageWaitMs)
      let total = 0
      for (let page = 0; page < 4; page += 1) {
        const path = page === 0 ? '/c/welfare/36.rss' : '/c/welfare/36.rss?page=' + (page + 1)
        const xml = await cdp.eval(
          tab,
          '(async () => { const r = await fetch("' + path + '", { credentials: "include" }); return r.ok ? await r.text() : ""; })()'
        )
        const parsed = parseRss(xml, { source: 'linuxdo' })
        items.push(...parsed)
        total += parsed.length
      }
      log('linux.do：' + total + ' 条')
    } finally {
      await cdp.close(tab).catch(() => {})
    }
  } catch (error) {
    errors.push('linux.do：' + (error?.message || error))
  }

  if (includeNodeSeek) try {
    const tab = await cdp.newTab('https://www.nodeseek.com/categories/promotion')
    try {
      await sleep(pageWaitMs)
      let total = 0
      for (let page = 1; page <= 8; page += 1) {
        const path = page === 1 ? '/categories/promotion' : '/categories/promotion?page=' + page
        const html = await cdp.eval(
          tab,
          '(async () => { const r = await fetch("' + path + '", { credentials: "include" }); return r.ok ? await r.text() : ""; })()'
        )
        const parsed = parseNodeSeek(html)
        items.push(...parsed)
        total += parsed.length
      }
      log('NodeSeek：' + total + ' 条')
    } finally {
      await cdp.close(tab).catch(() => {})
    }
  } catch (error) {
    errors.push('NodeSeek：' + (error?.message || error))
  }

  return { items, errors }
}
