# 接口聚合与裁剪

## 1. 统一的下游客户端

所有下游调用都应通过一个封装好的 HTTP Client，统一处理：超时、traceId 透传、日志、指标、错误转换、响应校验。

```ts
import { request } from 'undici'
import { z } from 'zod'

interface CallOptions<T> { timeout?: number; schema?: z.ZodType<T>; headers?: Record<string, string> }

export function createClient(name: string, baseUrl: string) {
  return async function call<T>(method: string, path: string, opts: CallOptions<T> = {}): Promise<T> {
    const ctx = als.getStore()
    const start = performance.now()
    try {
      const res = await request(baseUrl + path, {
        method,
        headers: { 'x-request-id': ctx?.traceId ?? '', ...opts.headers },
        headersTimeout: opts.timeout ?? 2000,
        bodyTimeout: opts.timeout ?? 2000
      })
      const body = await res.body.json()
      if (res.statusCode >= 500) throw Errors.Upstream(name, body)
      if (res.statusCode >= 400) throw new AppError('UPSTREAM_4XX', (body as any)?.message ?? 'bad request', res.statusCode)
      return opts.schema ? opts.schema.parse(body) : (body as T)
    } catch (err) {
      if (err instanceof AppError) throw err
      throw Errors.Upstream(name, err)
    } finally {
      metrics.upstreamDuration.observe({ upstream: name }, (performance.now() - start) / 1000)
    }
  }
}
```

## 2. 编排模式

```ts
// 并行：无依赖
const [a, b] = await Promise.all([svcA(), svcB()])

// 串行：有依赖
const order = await orderSvc.get(id)
const [product, logistics] = await Promise.all([productSvc.get(order.productId), logisticsSvc.get(order.trackingNo)])

// 批量：列表补全，避免 N+1
const users = await userSvc.batchGet([...new Set(list.map(i => i.userId))])
const userMap = new Map(users.map(u => [u.id, u]))
const items = list.map(i => ({ ...i, user: userMap.get(i.userId) }))
```

### DataLoader：自动批量 + 去重

```ts
import DataLoader from 'dataloader'
// 每个请求创建一次（避免跨用户缓存泄漏）
const userLoader = new DataLoader(async (ids: readonly string[]) => {
  const users = await userSvc.batchGet(ids as string[])
  const m = new Map(users.map(u => [u.id, u]))
  return ids.map(id => m.get(id) ?? null)
})
await Promise.all([userLoader.load('1'), userLoader.load('2'), userLoader.load('1')]) // 只发 1 次请求
```

## 3. 裁剪与适配（DTO / ViewModel）

```ts
// 下游返回 40 个字段，前端只要 5 个；并在 BFF 做展示层转换
export const toProductCard = (p: ProductDO) => ({
  id: p.id,
  title: p.name,
  price: (p.priceCents / 100).toFixed(2),
  tag: p.stock === 0 ? '已售罄' : p.promo ? '促销' : undefined,
  cover: `${CDN}/${p.images[0]}?x-oss-process=image/resize,w_400`
})
```

**为什么不直接透传**：减少传输体积、隐藏内部字段（防泄露）、解耦前端与下游变更（下游改字段只改映射）。

## 4. 接口设计约定

- 面向页面/场景：`GET /bff/pages/order-detail?id=`，而不是镜像下游 REST。
- 统一响应结构、统一错误码。
- 分页统一：`{ list, nextCursor }`。
- 版本：通过前端发版同步演进，BFF 保持对旧版前端（App 多版本）兼容。
- 用 OpenAPI / 共享 TS 类型保证前后端契约；可用 `ts-rest`、`tRPC`（全 TS 团队）。

## 5. 透明代理

部分接口无需加工，直接代理：

```ts
import { createProxyMiddleware } from 'http-proxy-middleware'
app.use('/api/search', createProxyMiddleware({ target: SEARCH_URL, changeOrigin: true, proxyTimeout: 3000 }))
```

## 练习

运行 `examples/bff-aggregation`：它模拟了用户/订单/推荐三个下游（推荐随机慢、随机失败），观察 BFF 如何并行聚合与降级，并为其增加 DataLoader 批量查询商品。
