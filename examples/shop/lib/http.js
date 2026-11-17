import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { requestContext } from './context.js'

// 可预期的错误：带 HTTP 状态码与稳定的错误码。expose=false 时只对外返回通用信息。
export class HttpError extends Error {
  constructor(status, code, message, { details, headers, expose = status < 500, cause } = {}) {
    super(message, { cause })
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
    this.expose = expose
  }
}

const REPLY = Symbol('reply')
export const HANDLED = Symbol('handled')

// 显式的响应包装：避免把领域对象里的 status 字段误当成 HTTP 状态码
export const reply = (status, body, headers = {}) => ({ [REPLY]: true, status, body, headers })

export async function readJson(req, { limit = 64 * 1024 } = {}) {
  const type = req.headers['content-type'] ?? ''
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json')
  }
  const tooLarge = () => new HttpError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${limit} 字节`, { headers: { connection: 'close' } })
  if (Number(req.headers['content-length']) > limit) throw tooLarge()
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw tooLarge()
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体不是合法的 JSON')
  }
}

export function createRouter() {
  const routes = []
  return {
    add(method, pattern, handler) {
      const keys = []
      const source = pattern.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)' })
      routes.push({ method, pattern, re: new RegExp(`^${source}$`), keys, handler })
      return this
    },
    match(method, pathname) {
      const allow = []
      for (const route of routes) {
        const m = route.re.exec(pathname)
        if (!m) continue
        if (route.method !== method) { allow.push(route.method); continue }
        const params = {}
        try {
          route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
        } catch {
          throw new HttpError(400, 'BAD_PATH', '路径参数编码不合法')
        }
        return { route, params }
      }
      return allow.length ? { allow } : null
    }
  }
}

function send(res, status, body, headers = {}) {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (body === undefined || status === 204) {
    res.writeHead(status)
    return res.end()
  }
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    if (!res.hasHeader('content-type')) res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.writeHead(status)
    return res.end(body)
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

// 统一的服务外壳：requestId、上下文、路由、错误出口、访问日志、指标、健康检查。
export function createService({
  name,
  router,
  logger,
  metrics,
  isReady = () => true,
  isShuttingDown = () => false,
  defaultHeaders = {},
  keepAliveTimeoutMs = 65_000
}) {
  const requests = metrics.counter('http_requests_total', 'HTTP requests')
  const duration = metrics.histogram('http_request_duration_seconds', 'HTTP request duration')

  const server = http.createServer((req, res) => {
    const incoming = req.headers['x-request-id']
    const requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID()
    requestContext.run({ requestId }, () => handle(req, res, requestId))
  })
  // 必须大于负载均衡器的空闲超时，否则 LB 复用到被 Node 关闭的连接会产生 502
  server.keepAliveTimeout = keepAliveTimeoutMs
  server.headersTimeout = keepAliveTimeoutMs + 1000
  server.requestTimeout = 30_000

  async function handle(req, res, requestId) {
    const start = performance.now()
    let route = 'unmatched'
    res.once('close', () => {
      const seconds = (performance.now() - start) / 1000
      const status = res.writableFinished ? res.statusCode : 499
      requests.inc({ service: name, method: req.method, route, status })
      duration.observe({ service: name, route }, seconds)
      logger.info('access', { method: req.method, route, status, ms: Math.round(seconds * 1000) })
    })
    for (const [k, v] of Object.entries(defaultHeaders)) res.setHeader(k, v)
    res.setHeader('x-request-id', requestId)
    // 关闭期间让客户端不要复用这条连接，在途请求结束后连接即可释放
    if (isShuttingDown()) res.setHeader('connection', 'close')

    try {
      const { pathname } = new URL(req.url, 'http://internal')
      if (pathname === '/healthz') { route = pathname; return send(res, 200, { ok: true }) }
      if (pathname === '/readyz') { route = pathname; return send(res, isReady() ? 200 : 503, { ready: isReady() }) }
      if (pathname === '/metrics') {
        route = pathname
        return send(res, 200, metrics.render(), { 'content-type': 'text/plain; version=0.0.4' })
      }
      const match = router.match(req.method, pathname)
      if (!match) throw new HttpError(404, 'NOT_FOUND', 'Not Found')
      if (match.allow) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method Not Allowed', { headers: { allow: match.allow.join(', ') } })
      route = match.route.pattern
      const result = await match.route.handler({ req, res, params: match.params, url: new URL(req.url, 'http://internal'), requestId })
      if (result === HANDLED || res.headersSent || res.destroyed) return
      if (result?.[REPLY]) return send(res, result.status, result.body, result.headers)
      return send(res, result === undefined ? 204 : 200, result)
    } catch (err) {
      if (res.headersSent || res.destroyed) {
        logger.error('error after response started', { err })
        return res.destroy()
      }
      const known = err instanceof HttpError
      if (!known || err.status >= 500) logger.error('request failed', { err, route })
      const status = known ? err.status : 500
      const expose = known && err.expose
      send(res, status, {
        code: known ? err.code : 'INTERNAL_ERROR',
        message: expose ? err.message : 'Internal Server Error',
        ...(expose && err.details ? { details: err.details } : {}),
        requestId
      }, known ? err.headers : undefined)
    }
  }

  return server
}

export function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve(`http://${host}:${server.address().port}`)
    })
  })
}
