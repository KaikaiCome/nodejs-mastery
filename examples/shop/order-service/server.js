import { timingSafeEqual, createHash } from 'node:crypto'
import { createRouter, createService, readJson, reply, HttpError } from '../lib/http.js'
import { DomainError } from './orders.js'

const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  PRODUCT_NOT_FOUND: 400,
  INVALID_CURSOR: 400,
  NOT_FOUND: 404,
  OUT_OF_STOCK: 409,
  INVALID_STATE: 409,
  IDEMPOTENCY_KEY_REUSED: 422
}

const digest = s => createHash('sha256').update(String(s)).digest()

// 内部服务鉴权：只有持有 service token 的调用方（BFF）才能声明 x-user-id。
// 生产环境应使用 mTLS 或短期 JWT，而不是长期共享密钥。
function authenticate(req, serviceToken) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!timingSafeEqual(digest(token), digest(serviceToken))) {
    throw new HttpError(401, 'UNAUTHENTICATED', '缺少或无效的服务凭证')
  }
  const userId = req.headers['x-user-id']
  if (typeof userId !== 'string' || !/^[\w-]{1,64}$/.test(userId)) {
    throw new HttpError(400, 'MISSING_USER', '缺少 x-user-id')
  }
  return userId
}

export function createOrderServer({ store, serviceToken, logger, metrics, lifecycle, faults = { dropNextCommitResponses: 0 } }) {
  const router = createRouter()

  // 把领域错误翻译成 HTTP 错误；其余错误保持原样交给外壳统一处理
  const run = fn => async ctx => {
    try {
      return await fn(ctx)
    } catch (err) {
      if (err instanceof DomainError) {
        throw new HttpError(STATUS_BY_CODE[err.code] ?? 400, err.code, err.message, { details: err.details })
      }
      throw err
    }
  }
  const authed = fn => run(ctx => fn({ ...ctx, userId: authenticate(ctx.req, serviceToken) }))

  // 故障注入：事务已提交，但响应在网络上丢失。调用方会看到连接断开，只能靠幂等键安全重试。
  const maybeDropResponse = res => {
    if (faults.dropNextCommitResponses > 0) {
      faults.dropNextCommitResponses--
      res.socket.destroy()
      return true
    }
    return false
  }

  router
    .add('GET', '/products', authed(() => ({ items: store.listProducts() })))
    .add('GET', '/orders', authed(({ userId, url }) => store.listOrders(userId, {
      cursor: url.searchParams.get('cursor') || undefined,
      limit: url.searchParams.get('limit') || undefined
    })))
    .add('POST', '/orders', authed(async ({ req, res, userId }) => {
      const key = req.headers['idempotency-key']
      if (typeof key !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', '必须提供 16~64 位的 Idempotency-Key')
      }
      const body = await readJson(req)
      const { order, replayed } = store.createOrder(userId, key, body?.items)
      if (maybeDropResponse(res)) return
      return reply(replayed ? 200 : 201, order, replayed ? { 'idempotent-replayed': 'true' } : {})
    }))
    .add('GET', '/orders/:id', authed(({ userId, params }) => store.getOrder(userId, params.id)))
    .add('POST', '/orders/:id/pay', authed(({ res, userId, params }) => {
      const order = store.pay(userId, params.id)
      if (maybeDropResponse(res)) return
      return order
    }))
    .add('POST', '/orders/:id/cancel', authed(({ userId, params }) => store.cancel(userId, params.id)))

  return createService({
    name: 'order-service',
    router,
    logger,
    metrics,
    isReady: lifecycle?.isReady,
    isShuttingDown: lifecycle?.isShuttingDown
  })
}
