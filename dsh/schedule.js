/**
 * 定时刷新：按「时间点」而不是「一次性的 setTimeout」来调度。
 *
 * 为什么换掉单一 setTimeout：它有三个坑——进程重启就丢、机器睡眠时错过的点永远补不回来、
 * 改了配置要重启才生效。改成每 60 秒 tick 一次，每次都问「有没有该跑却还没跑的槽位」：
 * - 睡眠 / 关机 / 重启后能自愈（补跑最近一个错过的槽位）
 * - 配置（时间点、开关）改完立刻生效，不用重启
 * - 上次运行时间持久化在 state.json 里，重启后不会重复跑、也不会忘记跑
 *
 * 时间函数都是纯函数，可以用假时钟测试。
 */

export const RUN_HOURS = [8, 12, 16, 20]
export const TICK_MS = 60000
/** 补跑窗口：超过这个时长就不补了，避免关机一整天后开机连跑一堆。 */
export const CATCH_UP_WINDOW_MS = 6 * 3600 * 1000

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** 把「8,12,16,20」「['8','12']」这类输入规整成 0–23 的去重升序数组。 */
export function normalizeHours(input, fallback = RUN_HOURS) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[^0-9]+/)
  const hours = [...new Set(
    list
      .map((value) => String(value ?? '').trim())
      // 注意：空串不能进 Number（Number('') === 0），否则「没设置」会变成「0 点跑一次」
      .filter((value) => value !== '')
      .map((value) => Number(value))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23)
      .map((n) => Math.round(n))
  )].sort((a, b) => a - b)
  return hours.length ? hours : [...fallback]
}

/** 用户在界面上能改的设置；缺字段时给默认值，坏值不会让调度停摆。 */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const scheduler = source.scheduler && typeof source.scheduler === 'object' ? source.scheduler : {}
  return {
    scheduler: {
      enabled: scheduler.enabled !== false,
      hours: normalizeHours(scheduler.hours),
      catchUp: scheduler.catchUp !== false
    },
    retentionDays: clamp(Math.round(Number(source.retentionDays) || 7), 1, 30)
  }
}

/** 给定时刻之后的第一个预约时间。 */
export function nextRunAt(from = new Date(), hours = RUN_HOURS) {
  const list = normalizeHours(hours)
  const base = new Date(from.getTime())
  for (const hour of list) {
    const candidate = new Date(base.getTime())
    candidate.setHours(hour, 0, 0, 0)
    if (candidate.getTime() > base.getTime()) return candidate
  }
  const tomorrow = new Date(base.getTime())
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(list[0], 0, 0, 0)
  return tomorrow
}

/** 给定时刻之前（含）最近的一个预约时间；没有任何槽位时返回 null。 */
export function previousRunAt(from = new Date(), hours = RUN_HOURS) {
  const list = normalizeHours(hours)
  const base = new Date(from.getTime())
  for (let offset = 0; offset <= 1; offset += 1) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const candidate = new Date(base.getTime())
      candidate.setDate(candidate.getDate() - offset)
      candidate.setHours(list[i], 0, 0, 0)
      if (candidate.getTime() <= base.getTime()) return candidate
    }
  }
  return null
}

/** 距离下一次刷新还有多久（毫秒），用于界面显示。 */
export function msUntilNextRun(from = new Date(), hours = RUN_HOURS) {
  return Math.max(0, nextRunAt(from, hours).getTime() - from.getTime())
}

/**
 * 判断「现在是否有该跑而没跑的槽位」。
 * @param now 当前时刻
 * @param lastRunAt 上次运行时间（ISO 字符串；空表示还没记录）
 * @param options.hours 时间点
 * @param options.catchUp 是否补跑错过的槽位
 * @param options.windowMs 补跑窗口
 * @returns {Date|null} 应该补跑的槽位时间
 */
export function dueSlot(now, lastRunAt, { hours = RUN_HOURS, catchUp = true, windowMs = CATCH_UP_WINDOW_MS } = {}) {
  const slot = previousRunAt(now, hours)
  if (!slot) return null
  const last = Date.parse(lastRunAt)
  // 已经在这个槽位或之后跑过 → 不重复跑
  if (Number.isFinite(last) && last >= slot.getTime()) return null
  if (!catchUp) {
    // 不补跑：只处理「刚刚到点」的情况（tick 间隔内的容差）
    return now.getTime() - slot.getTime() <= TICK_MS * 2 ? slot : null
  }
  // 补跑也有限度：太久以前的槽位不再补，避免开机后连环触发
  return now.getTime() - slot.getTime() <= windowMs ? slot : null
}

/**
 * tick 调度器。
 * @param getSettings 每次 tick 读取最新设置（返回 normalizeSettings 的结果）
 * @param getLastRunAt 读取上次运行时间（持久化在 state.json 里）
 * @param onDue 到点时调用，参数是槽位时间
 * @param onScheduled 每次 tick 后回调下一次运行时间（给界面）
 */
export function createTickScheduler({
  getSettings = () => normalizeSettings(),
  getLastRunAt = () => '',
  onDue = async () => {},
  now = () => new Date(),
  tickMs = TICK_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onScheduled = () => {},
  onError = () => {}
} = {}) {
  let timer = null
  let stopped = false
  let busy = false
  // 没有运行历史时（首次安装 / 清空数据）不要立刻补跑：把启动时刻当作基线，
  // 之后的槽位照常触发。否则每次重启都会立刻抓一次，既费流量也让人意外。
  let baseline = null

  function scheduleNext() {
    if (stopped) return
    timer = setTimer(tick, tickMs)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  async function tick() {
    if (stopped) return
    try {
      const settings = await getSettings()
      const scheduler = settings.scheduler
      if (!baseline) baseline = now().toISOString()
      const next = nextRunAt(now(), scheduler.hours)
      onScheduled(next)
      if (!scheduler.enabled || busy) {
        scheduleNext()
        return
      }
      const lastRunAt = (await getLastRunAt()) || baseline
      const slot = dueSlot(now(), lastRunAt, {
        hours: scheduler.hours,
        catchUp: scheduler.catchUp
      })
      if (!slot) {
        scheduleNext()
        return
      }
      busy = true
      Promise.resolve(onDue(slot))
        .catch((error) => onError(error))
        .finally(() => {
          busy = false
          scheduleNext()
        })
    } catch (error) {
      onError(error)
      scheduleNext()
    }
  }

  return {
    start() {
      stopped = false
      baseline = now().toISOString()
      // 立刻 tick 一次：让「刚错过」的槽位能补上，同时把下次时间给界面
      void tick()
      return { next: nextRunAt(now(), RUN_HOURS) }
    },
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
    },
    next() {
      return nextRunAt(now(), RUN_HOURS)
    },
    /** 测试用：直接推进一次检查（会走完整个异步流程） */
    runTick: tick
  }
}

/**
 * 兼容旧名字：调度器现在由 createTickScheduler 承担。
 * 保留 createRefreshScheduler 这个名字，是为了让「一次性的 setTimeout 调度」不再被误用。
 */
export const createRefreshScheduler = createTickScheduler
