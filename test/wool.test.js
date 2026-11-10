import test from 'node:test'
import assert from 'node:assert/strict'
import { createWoolFetcher, prepareEmbedHtml, stripScripts } from '../dsh/wool.js'

test('注入 base 指向源站，保证相对资源仍能加载', () => {
  const html = '<html><head><meta charset="utf-8"></head><body>hi</body></html>'
  const out = prepareEmbedHtml(html, 'https://aihot.news')
  assert.match(out, /<head><base href="https:\/\/aihot\.news\/">/)
  assert.match(out, /hi/)
})

test('去掉会拦住嵌入的 meta CSP，其他 meta 保留', () => {
  const html = '<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors none"><meta charset="utf-8"></head>'
  const out = prepareEmbedHtml(html)
  assert.equal(/content-security-policy/i.test(out), false)
  assert.match(out, /<meta charset="utf-8">/)
})

test('没有 head 时把 base 放在最前面', () => {
  const out = prepareEmbedHtml('<body>x</body>', 'https://aihot.news')
  assert.ok(out.startsWith('<base href="https://aihot.news/">'))
})

test('空页面直接报错，避免把空 iframe 当成功', () => {
  assert.throws(() => prepareEmbedHtml(''), /空页面/)
  assert.throws(() => prepareEmbedHtml(null), /空页面/)
})

test('stripScripts 去掉脚本但保留文字', () => {
  const out = stripScripts('<div>文字</div><script>alert(1)</script><noscript>n</noscript>')
  assert.equal(out, '<div>文字</div>')
})

test('抓取器命中缓存，force 时重新取', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(url)
    return new Response('<html><head></head><body>第 ' + calls.length + ' 次</body></html>', { status: 200 })
  }
  try {
    const get = createWoolFetcher({ url: 'https://example.com/wool', ttl: 5000 })
    const first = await get()
    assert.equal(first.cached, false)
    assert.match(first.html, /第 1 次/)
    const second = await get()
    assert.equal(second.cached, true)
    assert.match(second.html, /第 1 次/)
    const forced = await get({ force: true })
    assert.equal(forced.cached, false)
    assert.match(forced.html, /第 2 次/)
    assert.ok(first.fetchedAt)
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = original
  }
})

test('源站报错时抛出可读错误', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('nope', { status: 503 })
  try {
    const get = createWoolFetcher({ url: 'https://example.com/wool' })
    await assert.rejects(() => get(), /源站返回 503/)
  } finally {
    globalThis.fetch = original
  }
})
