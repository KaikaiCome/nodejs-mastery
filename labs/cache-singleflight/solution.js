// 参考实现：带 TTL、single-flight 与负缓存的缓存
export function createCache({ load, ttlMs, now = Date.now }) {
  const entries = new Map() // key -> { value, expiresAt }
  const inflight = new Map() // key -> Promise

  function get(key) {
    const entry = entries.get(key)
    if (entry && now() < entry.expiresAt) return Promise.resolve(entry.value)

    // 同一个 key 的并发请求共享同一次加载（single-flight），防止缓存击穿
    const pending = inflight.get(key)
    if (pending) return pending

    const promise = Promise.resolve()
      .then(() => load(key))
      .then(
        (value) => {
          // 期间若被 delete() 过，这次结果已经过时，不再写入
          if (inflight.get(key) === promise) {
            inflight.delete(key)
            // null/undefined 也缓存（负缓存），防止缓存穿透
            entries.set(key, { value, expiresAt: now() + ttlMs })
          }
          return value
        },
        (err) => {
          // 错误不缓存：下一次 get 会重新加载
          if (inflight.get(key) === promise) inflight.delete(key)
          throw err
        },
      )
    inflight.set(key, promise)
    return promise
  }

  function del(key) {
    entries.delete(key)
    inflight.delete(key)
  }

  return { get, delete: del }
}
