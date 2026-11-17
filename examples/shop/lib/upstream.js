import { requestContext } from './context.js'
import { HttpError } from './http.js'

// 整个请求的时间预算。每次下游调用只能使用“剩余时间”，避免链路总耗时失控。
export function createDeadline(budgetMs, now = () => performance.now()) {
  const end = now() + budgetMs
  return { remaining: () => Math.max(0, end - now()) }
}

export class UpstreamError extends HttpError {
  constructor(upstream, kind, cause) {
    const timeout = kind === 'timeout' || kind === 'deadline'
    super(timeout ? 504 : 502, timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', '服务暂时不可用，请稍后重试', { expose: true, cause })
    this.upstream = upstream
    this.kind = kind
    // 只有“连接层失败”可以考虑重试；超时说明对方可能仍在处理
    this.retriable = kind === 'network'
  }
}

export function createUpstream(name, baseUrl, { serviceToken, timeoutMs = 1000, metrics, fetchImpl = fetch }) {
  const calls = metrics.counter('upstream_requests_total', 'Calls to downstream services')
  const duration = metrics.histogram('upstream_request_duration_seconds', 'Downstream call duration')

  return async function call(method, path, { body, headers = {}, userId, deadline, signal, timeoutMs: perCall = timeoutMs } = {}) {
    // AbortSignal.timeout 只接受整数毫秒
    const budget = Math.floor(Math.min(perCall, deadline ? deadline.remaining() : Infinity))
    if (budget < 1) {
      calls.inc({ upstream: name, outcome: 'deadline' })
      throw new UpstreamError(name, 'deadline')
    }
    const timeoutSignal = AbortSignal.timeout(budget)
    const combined = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal
    const start = performance.now()
    let outcome = 'network'
    try {
      const res = await fetchImpl(baseUrl + path, {
        method,
        signal: combined,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${serviceToken}`,
          'x-request-id': requestContext.getStore()?.requestId ?? '',
          ...(userId ? { 'x-user-id': userId } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      const text = await res.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch (err) {
        outcome = 'bad_response'
        throw new UpstreamError(name, 'bad_response', err)
      }
      outcome = res.status >= 500 ? '5xx' : res.status >= 400 ? '4xx' : 'ok'
      return { status: res.status, data, headers: res.headers }
    } catch (err) {
      if (err instanceof UpstreamError) throw err
      if (timeoutSignal.aborted) { outcome = 'timeout'; throw new UpstreamError(name, 'timeout', err) }
      if (signal?.aborted) { outcome = 'cancelled'; throw new HttpError(499, 'CLIENT_CLOSED_REQUEST', 'client closed request', { cause: err }) }
      throw new UpstreamError(name, 'network', err)
    } finally {
      calls.inc({ upstream: name, outcome })
      duration.observe({ upstream: name }, (performance.now() - start) / 1000)
    }
  }
}

// 只用于幂等操作：带幂等键的写请求、条件更新、读请求。重试必须留在 deadline 内。
export async function retryIdempotent(fn, { deadline, retries = 1, minRemainingMs = 100, random = Math.random } = {}) {
  for (let attempt = 0; ; attempt++) {
    const budgetLeft = () => attempt < retries && deadline.remaining() > minRemainingMs
    try {
      const result = await fn()
      if (result.status !== 503 || !budgetLeft()) return result
    } catch (err) {
      if (!(err instanceof UpstreamError && err.retriable && budgetLeft())) throw err
    }
    await new Promise(r => setTimeout(r, 20 + random() * 30))
  }
}
