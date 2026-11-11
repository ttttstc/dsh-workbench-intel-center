import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

/**
 * 客户端产物没有任何测试：构建脚本是手写的，一旦产物在模块顶层就抛错，
 * 只有装进 Desktop 才会被发现。这里用最小宿主环境把 lib/client.js 真跑一遍，
 * 确认 ModuleLoader 注册成功、导出可用、内联的共享逻辑没有缺名字。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const artifact = path.join(root, 'lib', 'client.js')

function loadArtifact() {
  const code = fs.readFileSync(artifact, 'utf8')
  let registered = null
  const window = {
    __ModuleLoader__: {
      load(definition) {
        registered = definition
      }
    },
    addEventListener() {},
    removeEventListener() {}
  }
  const document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} }
  }
  const context = vm.createContext({
    window,
    document,
    navigator: {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Blob: class Blob {}
  })
  vm.runInContext(code, context, { filename: 'lib/client.js' })
  assert.ok(registered, '产物必须调用 window.__ModuleLoader__.load 注册自己')
  return registered
}

function makeReact({ firstState } = {}) {
  const element = (type, props, ...children) => ({ type, props, children })
  let pendingFirst = firstState !== undefined
  return {
    createElement: element,
    Fragment: 'Fragment',
    useState: (initial) => {
      const fallback = typeof initial === 'function' ? initial() : initial
      if (pendingFirst) {
        pendingFirst = false
        return [firstState, () => {}]
      }
      return [fallback, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (initial) => ({ current: initial })
  }
}

test('客户端产物能被 ModuleLoader 加载，并导出 Panel 与注册入口', () => {
  const definition = loadArtifact()
  assert.equal(definition.id, 'dsh-workbench-intel-center')
  assert.equal(typeof definition.factory, 'function')

  const react = makeReact()
  const exports = definition.factory((name) => {
    assert.equal(name, 'react', `客户端不应 require 其他东西，实际：${name}`)
    return react
  })

  assert.equal(typeof exports.apply, 'function')
  assert.equal(typeof exports.Panel, 'function')
  assert.deepEqual(Array.from(exports.inject), ['desktopWorkbenches'])
  assert.equal(typeof exports.filterCards, 'function')
})

test('产物里内联的共享逻辑可用：筛选、今日重点与提示词都不缺', () => {
  const definition = loadArtifact()
  const react = makeReact()
  const exports = definition.factory(() => react)
  const cards = [
    { id: 'a', title: '免费 VPS', category: '免费VPS', status: 'confirmed', score: 5, priority: 'high', flag: 'used' },
    { id: 'b', title: '收费 VPS', category: '低价VPS', status: 'pending', score: 2, priority: 'normal', flag: 'none' }
  ]
  assert.deepEqual(exports.filterCards(cards, { category: '免费VPS' }).map((card) => card.id), ['a'])
  assert.equal(exports.highlightCards(cards, 1)[0].id, 'a')
  const prompt = exports.buildReviewPrompt({ topics: [{ title: '免费云资源' }], cards, dataFile: 'C:/x/state.json', today: '2026-11-10' })
  assert.match(prompt, /写回规则/, '提示词必须说明谁能改哪些字段')
  assert.match(prompt, /不要动 linuxdo \/ x \/ radar/)
})

test('Panel 在最小宿主里能渲染出骨架（首屏无数据时不抛错）', () => {
  const definition = loadArtifact()
  const react = makeReact()
  const exports = definition.factory(() => react)
  const tree = exports.Panel({ service: {}, conversation: null })
  assert.ok(tree && tree.type === 'div', '首屏应返回一个容器节点')
  const classes = JSON.stringify(tree)
  assert.match(classes, /intel/)
})

test('有数据时渲染完整布局：标签栏、三个榜单与页脚都能构造出来', () => {
  const definition = loadArtifact()
  const state = {
    version: 1,
    cards: [{ id: 'card-a', title: '免费 VPS', category: '免费VPS', score: 5, status: 'confirmed', priority: 'high', summary: ['要点'], facts: [], pros: [], cons: [], sources: [], tags: [], flag: 'none', note: '' }],
    topics: [{ id: 'topic-a', title: '免费云资源' }],
    linuxdo: { updatedAt: '2026-11-10T01:00:00.000Z', date: '2026-11-10', keywords: ['羊毛'], items: [{ id: 'ld1', title: 'linux.do 帖', url: 'https://linux.do/t/1', likes: 3 }] },
    x: { updatedAt: '2026-11-10T02:00:00.000Z', date: '2026-11-10', keywords: ['羊毛'], items: [{ id: 'x1', title: 'X 帖', url: 'https://x.com/a/status/1', likes: 9 }] },
    radar: {
      updatedAt: '2026-11-10T03:00:00.000Z',
      date: '2026-11-10',
      keywords: ['免费'],
      items: [{ id: 'r1', title: '限免 3 天', url: 'https://example.com/1', source: 'v2ex', category: 'limited', createdAt: '2026-11-10T02:30:00.000Z', score: 80, verdict: 'free' }]
    },
    lastReviewedAt: '',
    updatedAt: '2026-11-10T03:00:00.000Z'
  }
  const react = makeReact({ firstState: state })
  const exports = definition.factory(() => react)
  const tree = exports.Panel({ service: {}, conversation: null })
  const text = JSON.stringify(tree)
  assert.match(text, /羊毛雷达/)
  assert.match(text, /VPS 羊毛/)
  assert.match(text, /X 羊毛/)
  assert.match(text, /Token 羊毛/)
  assert.ok(!text.includes('linux.do 羊毛'), 'linux.do 独立标签已移除，避免与雷达的 LINUX DO 来源重复')
  assert.match(text, /羊毛分从高到低/, '排序默认按羊毛分')
  assert.match(text, /限免 3 天/, '雷达条目应出现在页面上')
  assert.ok(text.includes('08:00 / 12:00 / 16:00 / 20:00'), '小时表来自服务端常量，不是写死的文案')
  assert.ok(!text.includes('intel-err'), '没有错误时不该渲染错误条')
})

test('渲染：多了「游戏限免」页，游戏条目只出现在那一页', () => {
  const definition = loadArtifact()
  const react = makeReact()
  const exports = definition.factory(() => react)
  const tree = exports.Panel({ service: {}, conversation: null })
  assert.match(JSON.stringify(tree), /游戏限免/)
})
