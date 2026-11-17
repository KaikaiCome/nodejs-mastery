// BFF 首页聚合示例：并行调用 + 核心/非核心分级 + 超时 + 熔断降级 + 字段裁剪
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient, UpstreamError } from './client.js'
import { CircuitBreaker } from './breaker.js'
import { startUpstreams } from './upstreams.js'

export function createBff(urls, { recTimeoutMs = 300, breakerOptions = {}, log = console.log } = {}) {
  const onCall = c => { if (!c.ok || c.ms > 200) log(`[upstream] ${c.upstream} ${c.path} ok=${c.ok} ${c.ms}ms`) }
  const userClient = createClient('user-svc', urls.users, { timeoutMs: 800, onCall })
  const orderClient = createClient('order-svc', urls.orders, { timeoutMs: 800, onCall })
  const recClient = createClient('rec-svc', urls.rec, { timeoutMs: recTimeoutMs, onCall })

  const recBreaker = new CircuitBreaker((uid, traceId) => recClient(`/rec?uid=${uid}`, { traceId }), {
    name: 'rec-svc', minimumRequests: 5, resetTimeoutMs: 5000, ...breakerOptions,
    fallback: () => { throw new UpstreamError('rec-svc', 'degraded') }
  })

  // ViewModel：只返回前端需要的字段，并做展示层转换
  const toUser = u => ({ id: u.id, nickname: u.nickname, avatar: u.avatar })
  const toOrder = o => ({ id: o.id, amount: (o.amountCents / 100).toFixed(2), statusText: { PAID: '已支付', SHIPPED: '已发货' }[o.status] ?? o.status })
  const toCard = p => ({ id: p.id, title: p.name, price: (p.priceCents / 100).toFixed(2) })

  async function home(uid, traceId) {
    const [user, orders, recs] = await Promise.allSettled([
      userClient(`/users/${uid}`, { traceId }),   // 核心依赖
      orderClient(`/orders?uid=${uid}`, { traceId }),
      recBreaker.fire(uid, traceId)               // 非核心依赖：超时短 + 熔断
    ])
    if (user.status === 'rejected') throw user.reason
    const degraded = []
    if (orders.status === 'rejected') degraded.push('orders')
    if (recs.status === 'rejected') degraded.push('recommendations')
    return {
      user: toUser(user.value),
      recentOrders: orders.status === 'fulfilled' ? orders.value.map(toOrder) : [],
      recommendations: recs.status === 'fulfilled' ? recs.value.map(toCard) : [],
      degraded
    }
  }

  return http.createServer(async (req, res) => {
    const traceId = req.headers['x-request-id'] || randomUUID()
    const url = new URL(req.url, 'http://localhost')
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-request-id': traceId })
      res.end(JSON.stringify(body))
    }
    const start = performance.now()
    try {
      if (url.pathname === '/bff/home') {
        const uid = url.searchParams.get('uid')
        if (!uid || !/^\w{1,32}$/.test(uid)) return send(400, { code: 'VALIDATION_ERROR', message: 'uid is required', requestId: traceId })
        send(200, { code: 0, data: await home(uid, traceId), requestId: traceId })
      } else if (url.pathname === '/bff/breakers') {
        send(200, recBreaker.stats())
      } else if (url.pathname === '/healthz') {
        send(200, { ok: true })
      } else {
        send(404, { code: 'NOT_FOUND', message: 'Not Found', requestId: traceId })
      }
    } catch (err) {
      log(`[error] ${traceId} ${err.message}`)
      const status = err.status ?? 500
      send(status, { code: status === 502 ? 'UPSTREAM_ERROR' : 'INTERNAL_ERROR', message: status === 502 ? 'service temporarily unavailable' : 'Internal Server Error', requestId: traceId })
    } finally {
      log(`[access] ${req.method} ${url.pathname} ${res.statusCode} ${Math.round(performance.now() - start)}ms trace=${traceId}`)
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const upstreams = startUpstreams()
  const server = createBff(upstreams.urls)
  const port = process.env.PORT || 3000
  server.listen(port, () => {
    console.log(`BFF listening on http://localhost:${port}`)
    console.log(`  curl "http://localhost:${port}/bff/home?uid=1"`)
    console.log(`  curl "http://localhost:${port}/bff/breakers"`)
  })
  const shutdown = () => {
    console.log('shutting down...')
    server.close(() => { upstreams.close(); process.exit(0) })
    server.closeIdleConnections()
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
