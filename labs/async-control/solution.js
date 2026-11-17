// 参考实现：异步流程控制
import { setTimeout as delay } from 'node:timers/promises'

const defaultSleep = (ms, { signal } = {}) => delay(ms, undefined, { signal })

// 让任意 promise 可被 signal 打断；被中断时统一以 signal.reason 拒绝
function raceAbort(promise, signal) {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(signal.aborted ? signal.reason : err)
      },
    )
  })
}

export async function retry(
  fn,
  {
    retries = 3,
    baseMs = 100,
    maxMs = 10_000,
    shouldRetry = () => true,
    signal,
    random = Math.random,
    sleep = defaultSleep,
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try {
      return await raceAbort(Promise.resolve().then(() => fn(attempt)), signal)
    } catch (err) {
      if (signal?.aborted) throw signal.reason
      if (attempt >= retries || !shouldRetry(err)) throw err
    }
    // full jitter：在 [0, min(maxMs, baseMs * 2^attempt)) 之间随机等待
    const ms = random() * Math.min(maxMs, baseMs * 2 ** attempt)
    await raceAbort(Promise.resolve().then(() => sleep(ms, { signal })), signal)
  }
}

export function pTimeout(promise, ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    if (signal?.aborted) return reject(signal.reason)
    signal?.addEventListener('abort', onAbort, { once: true })

    timer = setTimeout(() => {
      cleanup()
      const err = new Error(`操作超时（${ms}ms）`)
      err.name = 'TimeoutError'
      reject(err)
    }, ms)

    Promise.resolve(promise).then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (err) => {
        cleanup()
        reject(err)
      },
    )
  })
}

export function mapLimit(items, limit, fn) {
  if (!Number.isInteger(limit) || limit < 1) {
    return Promise.reject(new RangeError('limit 必须是 >= 1 的整数'))
  }
  const list = Array.from(items)
  return new Promise((resolve, reject) => {
    const results = new Array(list.length)
    let next = 0
    let active = 0
    let completed = 0
    let failed = false

    if (list.length === 0) return resolve(results)

    const launch = () => {
      while (!failed && active < limit && next < list.length) {
        const index = next++
        active++
        Promise.resolve()
          .then(() => fn(list[index], index))
          .then(
            (value) => {
              results[index] = value
              active--
              completed++
              if (completed === list.length) resolve(results)
              else launch()
            },
            (err) => {
              failed = true
              reject(err)
            },
          )
      }
    }
    launch()
  })
}
