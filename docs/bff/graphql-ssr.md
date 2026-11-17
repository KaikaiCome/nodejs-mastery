# GraphQL 与 SSR 网关

## GraphQL 作为 BFF

前端声明需要的字段，BFF 负责解析：天然适合“聚合 + 裁剪”。

```ts
import { createSchema, createYoga } from 'graphql-yoga'
import DataLoader from 'dataloader'

const typeDefs = /* GraphQL */ `
  type User { id: ID!, name: String!, orders(first: Int = 10): [Order!]! }
  type Order { id: ID!, amount: Float!, product: Product! }
  type Product { id: ID!, title: String! }
  type Query { me: User }
`
const resolvers = {
  Query: { me: (_, __, ctx) => ctx.userSvc.get(ctx.userId) },
  User: { orders: (u, { first }, ctx) => ctx.orderSvc.listByUser(u.id, first) },
  Order: { product: (o, _, ctx) => ctx.loaders.product.load(o.productId) } // DataLoader 解决 N+1
}
const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  context: ({ request }) => ({
    userId: getUserId(request),
    userSvc, orderSvc,
    loaders: { product: new DataLoader(ids => productSvc.batchGet(ids)) } // 每请求新建
  })
})
```

### 生产注意

| 问题 | 方案 |
| --- | --- |
| N+1 | DataLoader |
| 恶意深查询 | 查询深度/复杂度限制（`graphql-depth-limit`） |
| 任意查询 | **持久化查询（Persisted Queries）**：只允许白名单 query hash |
| 缓存难 | 字段级缓存、APQ + CDN GET |
| 错误 | 部分成功：`data` + `errors` 并存，前端需处理 |

**何时用 GraphQL**：多端、页面数据复杂且变化快、前端团队强。**何时不用**：简单 CRUD、团队不熟悉、强依赖 HTTP 缓存。

## SSR / 流式渲染

Next.js / Nuxt / Remix 的服务端部分本质上就是 BFF：

- 在服务端组件/loader 中聚合下游，直接渲染 HTML，减少客户端瀑布。
- **SSR 是 CPU 密集**的：注意 renderToString 阻塞事件循环，用流式 `renderToPipeableStream`、缓存页面、多实例扩展。
- 内存泄漏高发区：模块级变量缓存了请求数据（跨请求污染！），每个请求应创建独立的 store。
- 降级：SSR 失败时回退为 CSR（返回空壳 HTML）。

```ts
// SSR 兜底降级
try {
  html = await withTimeout(render(url), 800)
} catch (e) {
  logger.warn({ err: e, url }, 'ssr fallback to csr')
  html = csrShell
}
```

## 选择建议

| 场景 | 推荐 |
| --- | --- |
| 中后台 | REST BFF（Koa/Nest）+ 共享 TS 类型 |
| C 端营销/内容页 | Next/Nuxt SSR + 缓存 |
| 多端复杂数据 | GraphQL BFF |
| 全 TS 小团队 | tRPC |
