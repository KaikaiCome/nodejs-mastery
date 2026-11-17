// 统一下游客户端：超时、错误转换、耗时记录
export class UpstreamError extends Error {
  constructor(upstream, message, cause) {
    super(`${upstream}: ${message}`)
    this.upstream = upstream
    this.status = 502
    this.cause = cause
  }
}

export function createClient(name, baseUrl, { timeoutMs = 1000, onCall } = {}) {
  return async function get(path, { timeout = timeoutMs, traceId } = {}) {
    const start = performance.now()
    let ok = false
    try {
      const res = await fetch(baseUrl + path, {
        signal: AbortSignal.timeout(timeout),
        headers: traceId ? { 'x-request-id': traceId } : {}
      })
      if (!res.ok) {
        await res.body?.cancel() // 不读的响应体要释放，否则连接无法复用
        throw new UpstreamError(name, `status ${res.status}`)
      }
      const data = await res.json()
      ok = true
      return data
    } catch (err) {
      if (err instanceof UpstreamError) throw err
      const reason = err.name === 'TimeoutError' ? `timeout after ${timeout}ms` : err.message
      throw new UpstreamError(name, reason, err)
    } finally {
      onCall?.({ upstream: name, path, ok, ms: Math.round(performance.now() - start) })
    }
  }
}
