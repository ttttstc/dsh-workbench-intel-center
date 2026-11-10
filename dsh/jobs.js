/**
 * 后台抓取任务：把「有没有在跑、上次跑成什么样」显式化成一个小状态机。
 *
 * 为什么要有它：抓取一次雷达要几十秒、抓一次 X 要一两分钟。以前 HTTP 请求里直接
 * 等任务跑完，界面只能干等，失败时也只剩一句笼统文案；「是不是已经在跑」只靠一个
 * 布尔标志，接口没有地方读。现在状态与结果都留在这里，接口只做快照。
 *
 * 状态：idle → running → succeeded | failed
 * - running 期间再 start 不会排队、不会叠加，直接返回 skipped（界面据此提示）
 * - 结束后 result / error / finishedAt 保留在快照里，供界面与 Agent 读取
 * - wait() 给调度器用：等这一轮真正结束再排下一次
 */

export const JOB_STATUSES = ['idle', 'running', 'succeeded', 'failed']

export function createJob({
  name = 'job',
  run,
  now = () => new Date(),
  timeoutMs = 300000,
  onSettled = () => {}
} = {}) {
  if (typeof run !== 'function') throw new Error('createJob 需要一个 run 函数。')

  let status = 'idle'
  let startedAt = ''
  let finishedAt = ''
  let reason = ''
  let result = null
  let error = ''
  let runs = 0
  let current = null

  function snapshot() {
    const start = Date.parse(startedAt)
    const end = finishedAt ? Date.parse(finishedAt) : (startedAt ? now().getTime() : NaN)
    const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
    return { name, status, running: status === 'running', startedAt, finishedAt, durationMs, reason, result, error, runs }
  }

  /** 一轮任务的真实执行；token 用来忽略「上一轮迟到的结果」。 */
  async function execute(token) {
    let timer = null
    try {
      const value = await Promise.race([
        run(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`任务超过 ${Math.round(timeoutMs / 1000)} 秒仍未结束`)),
            timeoutMs
          )
          if (typeof timer?.unref === 'function') timer.unref()
        })
      ])
      if (token !== runs) return
      result = value ?? null
      error = ''
      status = 'succeeded'
    } catch (caught) {
      if (token !== runs) return
      result = null
      error = String(caught?.message || caught)
      status = 'failed'
    } finally {
      if (timer) clearTimeout(timer)
      if (token === runs) {
        finishedAt = now().toISOString()
        try {
          onSettled(snapshot())
        } catch {
          /* 回调失败不影响任务状态 */
        }
      }
    }
  }

  return {
    name,
    snapshot,

    /** 开始一轮；正在跑时返回 skipped，不排队也不打断。 */
    start(nextReason = 'manual') {
      if (status === 'running') {
        return { started: false, skipped: true, reason: 'already-running', job: snapshot() }
      }
      runs += 1
      status = 'running'
      startedAt = now().toISOString()
      finishedAt = ''
      reason = String(nextReason || 'manual')
      result = null
      error = ''
      current = execute(runs)
      return { started: true, skipped: false, job: snapshot() }
    },

    get running() {
      return status === 'running'
    },

    /** 等当前这一轮结束（没有在跑就立刻返回快照）。 */
    async wait() {
      if (current) await current
      return snapshot()
    }
  }
}

/**
 * 兼容旧接口的「上次运行」视图：以前 /radar/status、/x/status 的 last 就是这五个字段。
 * ok 为 null 表示还没跑过或正在跑（与旧实现一致）。
 */
export function lastRunOf(job) {
  const snap = job.snapshot()
  if (snap.status === 'idle') return { at: '', ok: null, count: 0, error: '', reason: '' }
  const count = Number(snap.result?.count) || 0
  const resultErrors = Array.isArray(snap.result?.errors) ? snap.result.errors : []
  return {
    at: snap.finishedAt || snap.startedAt,
    ok: snap.status === 'running' ? null : snap.status === 'succeeded',
    count,
    error: snap.error || resultErrors.join('；'),
    reason: snap.reason
  }
}
