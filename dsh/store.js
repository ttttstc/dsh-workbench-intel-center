/**
 * 情报中心的本机存储。
 *
 * 数据只有一个 JSON 文件，放在插件 config.root（默认是 DSH 数据目录下的 intel-center）。
 * 写盘走「临时文件 + rename」，读到半截文件不会把工作台弄坏；首次读取时用种子数据初始化。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { ValidationError, emptyState, normalizeState, normalizeStoredState } from './model.js'
import { seedState } from '../src/shared/seed.js'

export const MAX_STATE_BYTES = 4 * 1024 * 1024
const FILE = 'state.json'

/** 同一毫秒内两次写入也要拿到不同的临时文件名，否则会互相截断。 */
let writeSeq = 0

function nowISO() {
  return new Date().toISOString()
}

export function createIntelStore(root) {
  if (!root) throw new Error('缺少数据目录配置（root）。')
  const dir = root
  const file = path.join(dir, FILE)

  async function ensureDir() {
    await fs.mkdir(dir, { recursive: true })
  }

  async function writeFile(state) {
    await ensureDir()
    const body = JSON.stringify(state, null, 1)
    if (Buffer.byteLength(body, 'utf8') > MAX_STATE_BYTES) {
      throw new ValidationError('数据超过 4MB 上限，请先删掉部分卡片。', 413)
    }
    const tmp = `${file}.${process.pid}.${Date.now()}.${++writeSeq}.tmp`
    await fs.writeFile(tmp, body, 'utf8')
    await fs.rename(tmp, file)
    return Buffer.byteLength(body, 'utf8')
  }

  async function seedIfMissing() {
    try {
      await fs.access(file)
      return false
    } catch {
      const seeded = normalizeState({ ...seedState(), updatedAt: nowISO() })
      await writeFile(seeded)
      return true
    }
  }

  return {
    dir,
    file,

    /** 读取状态；文件不存在时用种子数据初始化。 */
    async read() {
      await seedIfMissing()
      let raw
      try {
        raw = await fs.readFile(file, 'utf8')
      } catch (error) {
        throw new ValidationError(`无法读取数据文件：${error.message}`, 500)
      }
      try {
        const parsed = JSON.parse(raw)
        if (Number.isFinite(Number(parsed?.version)) && Number(parsed.version) !== 1) {
          console.warn(`[intel-center] 数据版本 ${parsed.version} 与当前实现（1）不一致，按 v1 读取。`)
        }
        // 坏卡片（缺标题、id 重复）只丢那几张，不让整份数据读不出来。
        const { state, dropped } = normalizeStoredState(parsed)
        if (dropped > 0) {
          console.warn(`[intel-center] state.json 里有 ${dropped} 张卡片无法解析，已跳过；下次保存时不会写回它们。`)
        }
        return state
      } catch (error) {
        if (error instanceof ValidationError) throw error
        throw new ValidationError(`数据文件不是合法 JSON：${error.message}`, 500)
      }
    },

    /** 整份覆盖写入，返回写入后的状态与字节数。 */
    async write(input) {
      const state = normalizeState({ ...input, updatedAt: nowISO() })
      const bytes = await writeFile(state)
      return { state, bytes }
    },

    async meta() {
      let exists = true
      try {
        await fs.access(file)
      } catch {
        exists = false
      }
      return { root: dir, file, exists, empty: emptyState() }
    }
  }
}
