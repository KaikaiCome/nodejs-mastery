// 实验：异步流程控制
// 目标：实现 retry / pTimeout / mapLimit，详见同目录 README.md

/**
 * 带指数退避 + full jitter 的重试。
 * @param {(attempt: number) => Promise<any>} fn 第 n 次调用时传入 attempt = n（从 0 开始）
 * @param {{
 *   retries?: number, baseMs?: number, maxMs?: number,
 *   shouldRetry?: (err: unknown) => boolean, signal?: AbortSignal,
 *   random?: () => number, sleep?: (ms: number, opts: { signal?: AbortSignal }) => Promise<void>
 * }} [options]
 */
export async function retry(fn, options = {}) {
  // TODO: 第 attempt 次失败后等待 random() * min(maxMs, baseMs * 2 ** attempt) 毫秒再重试
  // TODO: shouldRetry(err) 为 false 或重试次数用尽时，直接抛出最后一次的错误
  // TODO: signal 被 abort 时立即以 signal.reason 拒绝，且不再发起新的尝试
  throw new Error('TODO: 实现 retry')
}

/**
 * 给 promise 加超时；超时以 name === 'TimeoutError' 的 Error 拒绝。
 * @param {Promise<any>} promise
 * @param {number} ms
 * @param {{ signal?: AbortSignal }} [options]
 */
export function pTimeout(promise, ms, options = {}) {
  // TODO: promise 先完成时必须 clearTimeout，不能留下悬挂的定时器
  throw new Error('TODO: 实现 pTimeout')
}

/**
 * 并发受限的 map，结果顺序与 items 一致。
 * @param {Iterable<any>} items
 * @param {number} limit
 * @param {(item: any, index: number) => Promise<any>} fn
 */
export function mapLimit(items, limit, fn) {
  // TODO: 同时运行的任务数永远不超过 limit
  // TODO: 任意任务失败立即 reject，并且之后不再启动新任务
  throw new Error('TODO: 实现 mapLimit')
}
