/**
 * 把 src/client/main.js 打成 Desktop 要求的单文件客户端模块（lib/client.js）。
 *
 * Desktop 不替工作台构建客户端：产物必须是一个自包含模块，通过 window.__ModuleLoader__.load()
 * 注册；模块内只能用 require 拿共享基线（React 等）。这里做三件事：
 * 1. 读源码；
 * 2. 包一层最小 CommonJS 环境（module/exports/require）；
 * 3. 写出 lib/client.js，并在文件头标记「由脚本生成」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const sourcePath = path.join(root, 'src', 'client', 'main.js')
const corePath = path.join(root, 'src', 'shared', 'core.js')
const outPath = path.join(root, 'lib', 'client.js')

// 统一换行再处理：Windows 上源文件是 CRLF，直接 split('\n') 会留下一个 '\r'，
// 缩进后变成行尾空白，导致同一份源码在 Windows / Linux 上生成不同的产物。
const readSource = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')

const source = readSource(sourcePath)
const core = readSource(corePath)

// 共享逻辑以 ESM 写（服务端与 node --test 直接导入），构建时去掉 export 关键字内联成一块，
// 再解构出客户端要用的名字，避免运行期再去 require 相对路径。
const CORE_EXPORTS = [
  'STATUS_LABEL',
  'FLAGS',
  'FLAG_LABEL',
  'todayISO',
  'formatWhen',
  'filterCards',
  'highlightCards',
  'buildReviewPrompt',
  'buildClaimPrompt',
  'buildXPrompt',
  'RADAR_CATEGORIES',
  'RADAR_CATEGORY_LABEL',
  'splitRadarItems',
  'X_TOP_LIMIT',
  'API_VERSION',
  'sortRadarItems',
  'filterRadar',
  'relativeTime'
]

const coreInlined = core.replace(/^export /gm, '')
const coreBlock = `    const { ${CORE_EXPORTS.join(', ')} } = (function () {
${coreInlined
  .split('\n')
  .map((line) => (line ? `      ${line}` : ''))
  .join('\n')}
      return { ${CORE_EXPORTS.join(', ')} }
    })()
`

const banner = `// 本文件由 scripts/build-client.mjs 从 src/client/main.js 生成，请勿直接修改。\n`

const body = `${banner}window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    ;(function (module, exports, require) {
${coreBlock}${source
  .split('\n')
  .map((line) => (line ? `      ${line}` : ''))
  .join('\n')}
    })(module, exports, require)
    return module.exports
  }
})
`

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, body, 'utf8')
const bytes = Buffer.byteLength(body, 'utf8')
console.log(`built ${path.relative(root, outPath)} (${bytes} bytes)`)
