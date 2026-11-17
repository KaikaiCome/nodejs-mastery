// 实验：弹性调用（deadline + 单次超时 + 幂等重试）
// 目标：实现 createClient，详见同目录 README.md
import { setTimeout as delay } from 'node:timers/promises'

/**
 * @param {{
 *   request: (attempt: number, opts: { signal: AbortSignal }) => Promise<{ status: number, body?: any }>,
 *   deadlineMs: number,
 *   attemptTimeoutMs: number,
 *   retries?: number,
 *   backoffMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 */
export function createClient({
  request,
  deadlineMs,
  attemptTimeoutMs,
  retries = 2,
  backoffMs = 10,
  now = () => performance.now(),
  sleep = (ms) => delay(ms),
}) {
  /**
   * @param {{ idempotent?: boolean }} [options]
   * @returns {Promise<{ status: number, body?: any }>}
   */
  async function call({ idempotent = false } = {}) {
    // TODO: 记录总 deadline = now() + deadlineMs
    // TODO: 每次尝试创建 AbortController，在 min(attemptTimeoutMs, 剩余时间) 后 abort
    // TODO: 只有 idempotent 且（抛出网络错误/单次超时 或 状态码 502/503/504）且还有剩余时间才重试
    // TODO: 4xx、非幂等请求一律不重试；总时间耗尽时以 code = 'DEADLINE_EXCEEDED' 的错误拒绝
    throw new Error('TODO: 实现 call')
  }

  return { call }
}
