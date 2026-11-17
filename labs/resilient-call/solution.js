// 参考实现：带总 deadline、单次超时与幂等重试的客户端
import { setTimeout as delay } from 'node:timers/promises'

const RETRYABLE_STATUS = new Set([502, 503, 504])

function codedError(code, message, cause) {
  const err = new Error(message, cause ? { cause } : undefined)
  err.code = code
  return err
}

// 即使 request 不理会 signal，也能在 abort 时立即结束等待
function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function createClient({
  request,
  deadlineMs,
  attemptTimeoutMs,
  retries = 2,
  backoffMs = 10,
  now = () => performance.now(),
  sleep = (ms) => delay(ms),
}) {
  async function call({ idempotent = false } = {}) {
    const deadline = now() + deadlineMs
    let lastError

    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - now()
      if (remaining <= 0) throw codedError('DEADLINE_EXCEEDED', `超过总时限 ${deadlineMs}ms`, lastError)

      // 本次尝试的超时 = min(单次超时, 剩余总预算)
      const limitedByDeadline = remaining <= attemptTimeoutMs
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(
          limitedByDeadline
            ? codedError('DEADLINE_EXCEEDED', `超过总时限 ${deadlineMs}ms`)
            : Object.assign(codedError('ATTEMPT_TIMEOUT', `单次请求超过 ${attemptTimeoutMs}ms`), { name: 'TimeoutError' }),
        )
      }, Math.min(attemptTimeoutMs, remaining))

      let response
      let error
      try {
        response = await raceAbort(
          Promise.resolve().then(() => request(attempt, { signal: controller.signal })),
          controller.signal,
        )
      } catch (err) {
        error = err
      } finally {
        clearTimeout(timer)
      }

      if (error?.code === 'DEADLINE_EXCEEDED') throw error
      if (!error && !RETRYABLE_STATUS.has(response.status)) return response

      // 4xx 已在上面直接返回；这里只剩网络错误/超时，或 502/503/504
      const canRetry = idempotent && attempt < retries
      if (!canRetry) {
        if (error) throw error
        return response
      }
      lastError = error ?? codedError('UPSTREAM_UNAVAILABLE', `上游返回 ${response.status}`)

      const left = deadline - now()
      if (left <= 0) throw codedError('DEADLINE_EXCEEDED', `超过总时限 ${deadlineMs}ms`, lastError)
      await sleep(Math.min(backoffMs * 2 ** attempt, left))
    }
  }

  return { call }
}
