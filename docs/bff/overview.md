# BFF 概览与边界

## 什么是 BFF

**Backend For Frontend**：为特定前端（Web、App、小程序）量身定制的一层后端，由前端团队拥有，负责把通用的领域服务（微服务）适配成前端好用的接口。

```
 Web ──► BFF-Web ─┐
 App ──► BFF-App ─┼──► 用户服务 / 订单服务 / 商品服务 / 搜索 / 推荐 ...
 小程序 ► BFF-MP ──┘
```

## BFF 解决什么问题

| 问题 | BFF 方案 |
| --- | --- |
| 一个页面要调 8 个接口，瀑布式请求慢 | 服务端并发聚合，内网 RTT 极低 |
| 后端返回字段冗余 / 结构不适合 UI | 裁剪、重组、字段映射 |
| 各端需求不同 | 每端一个 BFF，互不影响 |
| 前端改个字段要排后端期 | 前端团队自己改 BFF |
| 鉴权、埋点、灰度分散在前端 | 在 BFF 统一处理 |
| 首屏 SEO / 性能 | SSR 也是一种 BFF |

## 边界：BFF **不该**做什么

::: danger BFF 反模式
- **写核心业务逻辑**（如计算订单价格、库存扣减）——会导致多端 BFF 逻辑重复且不一致。业务规则属于领域服务。
- **直连业务数据库**——绕过领域服务破坏数据所有权。
- **变成巨石**：所有端共用一个超级 BFF，又回到了需要协调的老路。
- **无限层级转发**：BFF 调 BFF。
:::

**判断标准**：如果这段逻辑换一个前端（App）也需要并且必须一致，它就不属于 BFF。

## BFF 的典型职责

1. **聚合编排**：并行/串行调用下游，组合页面数据。
2. **裁剪适配**：字段过滤、格式化（时间、金额展示）、枚举转文案。
3. **协议转换**：gRPC/Thrift/内部 HTTP → 前端友好的 REST/GraphQL。
4. **鉴权会话**：Cookie Session ↔ 内部 Token 转换（Token 不落前端）。
5. **稳定性**：超时、重试、熔断、降级、缓存、限流。
6. **可观测**：traceId 贯穿、前端性能与接口指标。
7. **SSR / 流式渲染**（可选）。

## 一个页面接口的样子

```ts
// GET /bff/home  —— 首页一次请求拿全
router.get('/home', async (req, res) => {
  const uid = req.user.id
  const [user, banners, recs, unread] = await Promise.allSettled([
    userClient.get(uid),                    // 核心：失败则整体失败
    cmsClient.banners({ timeout: 300 }),    // 非核心：失败降级为空
    recClient.list(uid, { timeout: 500 }),
    msgClient.unreadCount(uid)
  ])
  if (user.status === 'rejected') throw user.reason
  res.json({
    user: pick(user.value, ['id', 'nickname', 'avatar']),
    banners: banners.status === 'fulfilled' ? banners.value : [],
    recommendations: recs.status === 'fulfilled' ? recs.value.map(toCard) : [],
    unread: unread.status === 'fulfilled' ? unread.value : 0,
    degraded: [banners, recs, unread].some(r => r.status === 'rejected')
  })
})
```

## 技术选型

- 轻量 BFF：Koa / Fastify + TypeScript + undici。
- 大团队：NestJS（模块化，统一规范）。
- 数据灵活：GraphQL（Apollo Server / Yoga）。
- 全栈：Next.js / Nuxt 的 Route Handler / Server Actions 本身就是 BFF。
- Serverless BFF：函数计算 + API 网关（注意冷启动与连接池）。

继续：[接口聚合与裁剪](./aggregation)。
