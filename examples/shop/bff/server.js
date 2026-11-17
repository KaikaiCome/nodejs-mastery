import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { createRouter, createService, readJson, reply, HttpError, HANDLED } from '../lib/http.js'
import { createDeadline, retryIdempotent } from '../lib/upstream.js'
import { parseCookies } from './session.js'

const PASS_THROUGH = new Set([
  'VALIDATION_ERROR', 'PRODUCT_NOT_FOUND', 'OUT_OF_STOCK', 'INVALID_STATE',
  'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_REQUIRED', 'NOT_FOUND', 'INVALID_CURSOR'
])
const STATUS_TEXT = { PENDING: '待支付', PAID: '已支付', CANCELLED: '已取消' }
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml' }
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const formatCents = cents => `¥${(cents / 100).toFixed(2)}`

// BFF 的价值之一：把后端模型转换成“页面可以直接用”的视图模型，按钮能否点击也由服务端决定
export const toOrderView = o => ({
  id: o.id,
  status: o.status,
  statusText: STATUS_TEXT[o.status] ?? o.status,
  total: formatCents(o.totalCents),
  createdAt: o.createdAt,
  items: o.items.map(i => ({ productId: i.productId, name: i.name, qty: i.qty, price: formatCents(i.unitPriceCents) })),
  canPay: o.status === 'PENDING',
  canCancel: o.status === 'PENDING'
})

// 下游返回的 4xx 只有白名单内的错误码对用户有意义；其他情况一律收敛成通用 502，不泄漏内部细节
function unwrap({ status, data }) {
  if (status >= 200 && status < 300) return data
  if (status >= 400 && status < 500 && PASS_THROUGH.has(data?.code)) {
    throw new HttpError(status, data.code, data.message, { details: data.details })
  }
  throw new HttpError(502, 'UPSTREAM_ERROR', '服务暂时不可用，请稍后重试', { expose: true, details: { upstreamStatus: status } })
}

// 客户端断开时取消只读的下游调用，节省资源；写操作不取消，避免“做了一半”
function clientSignal(res) {
  const ac = new AbortController()
  res.once('close', () => { if (!res.writableFinished) ac.abort() })
  return ac.signal
}

export function createBffServer({
  upstreams,
  users,
  sessions,
  limiter,
  logger,
  metrics,
  lifecycle,
  webDir,
  allowedOrigins = [],
  secureCookies = false,
  budgets = { home: 800, write: 3000, read: 1500, optionalDependency: 300 }
}) {
  const { orders, notifications, rec } = upstreams
  const degradedCounter = metrics.counter('bff_degraded_total', 'Optional dependencies that were skipped')
  const deprecated = metrics.counter('bff_deprecated_field_total', 'Requests using deprecated fields')
  const root = resolve(webDir)

  // 不设 Max-Age（会话 Cookie）：空闲超时由服务端的滑动 TTL 决定。
  // 若设固定 Max-Age 而不在每次请求时刷新，活跃用户也会在登录 N 分钟后被浏览器强制登出
  const cookie = (sid, maxAge) =>
    `sid=${sid}; HttpOnly; SameSite=Lax; Path=/${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}${secureCookies ? '; Secure' : ''}`

  // CSRF：会话靠 Cookie 自动携带，所以所有“写”请求必须证明来自本站页面
  function assertSameOrigin(req) {
    if (SAFE_METHODS.has(req.method)) return
    const origin = req.headers.origin
    const ok = origin ? allowedOrigins.includes(origin) : req.headers['sec-fetch-site'] === 'same-origin'
    if (!ok) throw new HttpError(403, 'CSRF_REJECTED', '请求来源不被允许')
  }

  const guard = (fn, { auth = true } = {}) => async ctx => {
    assertSameOrigin(ctx.req)
    const sid = parseCookies(ctx.req.headers.cookie).sid
    const user = sessions.get(sid)
    if (auth && !user) throw new HttpError(401, 'UNAUTHENTICATED', '请先登录')
    return fn({ ...ctx, sid, user })
  }

  async function serveStatic(res, file) {
    const full = resolve(root, file)
    if (!full.startsWith(root + sep)) throw new HttpError(404, 'NOT_FOUND', 'Not Found')
    let body
    try {
      body = await readFile(full)
    } catch {
      throw new HttpError(404, 'NOT_FOUND', 'Not Found')
    }
    res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
    res.end(body)
    return HANDLED
  }

  const router = createRouter()
    .add('GET', '/', ({ res }) => serveStatic(res, 'index.html'))
    .add('GET', '/static/:file', ({ res, params }) => {
      if (!/^[\w-]+\.(js|css|html|svg)$/.test(params.file)) throw new HttpError(404, 'NOT_FOUND', 'Not Found')
      return serveStatic(res, params.file)
    })

    .add('POST', '/bff/login', guard(async ({ req, sid }) => {
      const { username, password } = (await readJson(req, { limit: 4096 })) ?? {}
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) {
        throw new HttpError(400, 'VALIDATION_ERROR', '请输入用户名和密码')
      }
      const key = `${req.socket.remoteAddress}|${username.toLowerCase()}`
      const wait = limiter.hit(key)
      if (wait > 0) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', '尝试次数过多，请稍后再试', { headers: { 'retry-after': String(wait) } })
      const user = await users.verify(username, password)
      if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
      limiter.reset(key)
      // 登录后轮换会话 ID，防止会话固定攻击
      if (sid) sessions.destroy(sid)
      return reply(200, { user }, { 'set-cookie': cookie(sessions.create(user)) })
    }, { auth: false }))

    .add('POST', '/bff/logout', guard(({ sid }) => {
      if (sid) sessions.destroy(sid)
      return reply(204, undefined, { 'set-cookie': cookie('', 0) })
    }, { auth: false }))

    .add('GET', '/bff/me', guard(({ user }) => ({ user })))

    // 页面级聚合：核心依赖失败 → 整页失败；非核心依赖失败或超时 → 降级并告诉前端
    .add('GET', '/bff/pages/home', guard(async ({ res, user }) => {
      const deadline = createDeadline(budgets.home)
      const signal = clientSignal(res)
      const optional = { deadline, signal, userId: user.id, timeoutMs: budgets.optionalDependency }
      const [products, recs, inbox] = await Promise.allSettled([
        orders('GET', '/products', { deadline, signal, userId: user.id }).then(unwrap),
        rec('GET', `/recommendations?userId=${encodeURIComponent(user.id)}`, optional).then(unwrap),
        notifications('GET', '/notifications', optional).then(unwrap)
      ])
      if (products.status === 'rejected') throw products.reason

      const degraded = []
      for (const [name, result] of [['recommendations', recs], ['notifications', inbox]]) {
        if (result.status === 'rejected') {
          degraded.push(name)
          degradedCounter.inc({ dependency: name })
          logger.warn('optional dependency degraded', { dependency: name, err: result.reason })
        }
      }
      const catalog = products.value.items.map(p => ({ id: p.id, name: p.name, price: formatCents(p.priceCents), available: p.available }))
      const byId = new Map(catalog.map(p => [p.id, p]))
      return {
        user,
        products: catalog,
        recommendations: recs.status === 'fulfilled'
          ? recs.value.items.filter(r => byId.has(r.productId)).map(r => ({ ...byId.get(r.productId), reason: r.reason }))
          : [],
        notifications: inbox.status === 'fulfilled' ? inbox.value : { unread: 0, items: [] },
        degraded
      }
    }))

    .add('POST', '/bff/orders', guard(async ({ req, user }) => {
      const key = req.headers['idempotency-key']
      if (typeof key !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', '必须提供 16~64 位的 Idempotency-Key')
      }
      const body = await readJson(req)
      if (!Array.isArray(body?.items)) throw new HttpError(400, 'VALIDATION_ERROR', 'items 必须是数组')
      // 兼容旧客户端的 quantity 字段，同时用指标观察还有多少流量在用它，归零后才能删除
      const items = body.items.map(item => {
        if (item && item.qty === undefined && item.quantity !== undefined) {
          deprecated.inc({ field: 'items.quantity' })
          return { productId: item.productId, qty: item.quantity }
        }
        return { productId: item?.productId, qty: item?.qty }
      })
      const deadline = createDeadline(budgets.write)
      // 不传 client signal：用户关掉页面不应让写操作停在未知状态。同一幂等键使重试安全。
      const result = await retryIdempotent(() => orders('POST', '/orders', {
        body: { items }, userId: user.id, deadline, headers: { 'idempotency-key': key }
      }), { deadline })
      const order = unwrap(result)
      return reply(result.status, toOrderView(order), result.status === 200 ? { 'idempotent-replayed': 'true' } : {})
    }))

    .add('GET', '/bff/orders', guard(async ({ res, url, user }) => {
      const qs = new URLSearchParams()
      if (url.searchParams.get('cursor')) qs.set('cursor', url.searchParams.get('cursor'))
      qs.set('limit', url.searchParams.get('limit') ?? '5')
      const page = unwrap(await orders('GET', `/orders?${qs}`, { userId: user.id, deadline: createDeadline(budgets.read), signal: clientSignal(res) }))
      return { items: page.items.map(toOrderView), nextCursor: page.nextCursor }
    }))

    .add('GET', '/bff/orders/:id', guard(async ({ res, params, user }) =>
      toOrderView(unwrap(await orders('GET', `/orders/${encodeURIComponent(params.id)}`, { userId: user.id, deadline: createDeadline(budgets.read), signal: clientSignal(res) })))))

    .add('POST', '/bff/orders/:id/pay', guard(({ params, user }) => transition(user, params.id, 'pay')))
    .add('POST', '/bff/orders/:id/cancel', guard(({ params, user }) => transition(user, params.id, 'cancel')))

  // 状态迁移在订单服务里是条件更新，重复执行结果相同，因此可以安全重试
  async function transition(user, id, action) {
    const deadline = createDeadline(budgets.write)
    const result = await retryIdempotent(
      () => orders('POST', `/orders/${encodeURIComponent(id)}/${action}`, { userId: user.id, deadline }),
      { deadline }
    )
    return toOrderView(unwrap(result))
  }

  return createService({
    name: 'bff',
    router,
    logger,
    metrics,
    isReady: lifecycle?.isReady,
    isShuttingDown: lifecycle?.isShuttingDown,
    defaultHeaders: {
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'referrer-policy': 'same-origin',
      'cache-control': 'no-store'
    }
  })
}
