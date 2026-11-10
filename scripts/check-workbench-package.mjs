/**
 * 包校验：把规范第 3 节的「必须」项逐条核一遍，再核对将要发布的文件清单。
 *
 * 用法：node scripts/check-workbench-package.mjs [--tarball <path.tgz>]
 * 只读，不生成、不安装。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const problems = []
const notes = []

function read(rel) {
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8')
}

function need(condition, message) {
  if (!condition) problems.push(message)
}

const pkgText = read('package.json')
need(pkgText, '缺少 package.json')
const pkg = pkgText ? JSON.parse(pkgText) : {}

need(typeof pkg.name === 'string' && pkg.name.length > 0, 'package.json 缺少 name')
need(/^\d+\.\d+\.\d+/.test(String(pkg.version || '')), 'version 必须是完整 SemVer')
need(pkg.type === 'module', '建议 "type": "module"（当前不是模块包）')

const main = pkg.main
need(typeof main === 'string' && fs.existsSync(path.join(root, main)), 'main 指向的服务端入口不存在')
need(pkg.exports?.['.'] === main, 'exports["."] 必须与服务端入口一致')

const clientRel = pkg.exports?.['./client']
need(typeof clientRel === 'string', '缺少 exports["./client"]')
need(clientRel && fs.existsSync(path.join(root, clientRel)), '客户端产物不存在，请先运行 node scripts/build-client.mjs')

need(pkg.dsh?.bundle?.patch === './cordis.patch.yml', '缺少 dsh.bundle.patch')
need(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform 必须是 "web"')
const injectList = pkg.dsh?.client?.inject
need(Array.isArray(injectList) && injectList.includes('dsh-desktop-workbenches'),
  'dsh.client.inject 必须包含 dsh-desktop-workbenches')

const patch = read('cordis.patch.yml')
need(patch, '缺少 cordis.patch.yml')
if (patch) {
  const trimmed = patch.trim()
  need(trimmed.length > 0, 'cordis.patch.yml 不能为空文件')
  need(/\binsert:/.test(trimmed), 'cordis.patch.yml 里没有 insert 行')
  need(new RegExp(`name:\\s*${String(pkg.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(trimmed),
    'cordis.patch.yml 的 name 必须是 npm 包名')
  need(!/name:\s*(\.{0,2}\/|\\|[A-Za-z]:)/.test(trimmed), 'cordis.patch.yml 的 name 不能是路径')
}

const files = Array.isArray(pkg.files) ? pkg.files : []
for (const required of ['cordis.patch.yml']) {
  need(files.includes(required), `package.json 的 files 必须包含 ${required}`)
}
need(files.some((item) => item.startsWith('lib')), 'package.json 的 files 必须包含 lib/（客户端产物）')
need(files.some((item) => item.startsWith('dsh')), 'package.json 的 files 必须包含 dsh/（服务端入口）')

if (clientRel) {
  const client = read(clientRel)
  if (client) {
    need(client.includes('__ModuleLoader__.load'), '客户端产物没有调用 window.__ModuleLoader__.load')
    need(client.includes(`id: ${JSON.stringify(pkg.name)}`) || client.includes(pkg.name),
      '客户端产物的 id 与 npm 包名不一致')
    need(client.includes("require('react')") || client.includes('require("react")'),
      '客户端没有从共享基线取 React')
    need(!/require\(['"]\.\.?\//.test(client), '客户端产物不应在运行时相对 require 其他文件')
  }
}

if (pkg.repository) {
  notes.push(`声明了 repository：${pkg.repository.url || pkg.repository}`)
} else {
  notes.push('未声明 repository：按本地包安装，宿主会派生 local:<npm 包名> 身份')
}

const tarballFlag = process.argv.indexOf('--tarball')
if (tarballFlag > -1) {
  const tarball = process.argv[tarballFlag + 1]
  if (!tarball || !fs.existsSync(tarball)) problems.push(`找不到产物：${tarball}`)
  else {
    const size = fs.statSync(tarball).size
    notes.push(`产物大小 ${(size / 1024).toFixed(1)} KB`)
    if (size > 8 * 1024 * 1024) problems.push('产物超过 8 MiB，安装会被拒绝')
    let listing = ''
    try {
      listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    } catch (error) {
      problems.push(`无法列出产物内容（需要 tar）：${error.message}`)
    }
    for (const entry of ['package/package.json', 'package/cordis.patch.yml', 'package/lib/client.js', 'package/dsh/server.js']) {
      if (listing && !listing.split(/\r?\n/).includes(entry)) problems.push(`产物内缺少 ${entry}`)
    }
  }
}

for (const note of notes) console.log(`· ${note}`)
if (problems.length === 0) {
  console.log(`\n包校验通过：${pkg.name}@${pkg.version}`)
  process.exit(0)
}
console.error('\n包校验未通过：')
for (const problem of problems) console.error(`  ✗ ${problem}`)
process.exit(1)

