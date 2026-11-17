# BFF 与服务外壳

> 代码：`examples/shop/lib/http.js`、`lib/upstream.js`、`bff/` · 测试：`test/bff.test.js`

## 1. 服务外壳：每个服务都需要、但不该每次重写的东西

`createService()` 是一个约 150 行的“迷你框架”，订单、通知、推荐、BFF 四个服务共用它。看懂它，你就知道 Express/Koa/Fastify 中间件链在生产中实际承担了什么：

| 职责 | 实现要点 |
| --- | --- |
| requestId | 接受上游传入的合法 ID（正则校验，防日志注入），否则生成；写入响应头与 AsyncLocalStorage |
| 请求上下文 | `requestContext.run({ requestId }, ...)`：日志与下游调用自动携带，无需层层传参 |
| 路由 | 匹配失败 404；路径存在但方法不对 **405 + `Allow` 头**；参数解码失败 400 |
| 请求体 | 只接受 `application/json`（415）；超过上限 **413** 并关闭连接；坏 JSON 400 |
| 错误出口 | 统一 `{ code, message, details, requestId }`；5xx 和未知错误**隐藏内部信息** |
| 访问日志与指标 | 在 `res` 的 `close` 事件记录；**标签使用路由模板**（`/bff/orders/:id`），不用真实 URL |
| 健康检查 | `/healthz`（进程活着）与 `/readyz`（可以接流量，关闭时 503）分离 |
| 超时 | `keepAliveTimeout`（65s）大于 LB 空闲超时；`headersTimeout` 大于前者；`requestTimeout` 防慢速攻击 |

::: tip 为什么用 `reply(status, body)` 而不是直接返回对象？
订单对象有个 `status` 字段（`'PAID'`）。如果外壳约定“返回值有 `status` 就当作 HTTP 状态码”，迟早会把业务状态当成 HTTP 状态码发出去。用一个带 Symbol 标记的显式包装，消除歧义。
:::

## 2. 下游调用：时间预算（deadline）

首页的总预算是 800ms。每次下游调用的超时取 **“该依赖的超时”与“剩余预算”中的较小值**：

```js
const budget = Math.floor(Math.min(perCall, deadline.remaining()))   // AbortSignal.timeout 只接受整数
if (budget < 1) throw new UpstreamError(name, 'deadline')
const signal = AbortSignal.any([AbortSignal.timeout(budget), clientSignal])
```

没有 deadline 时，“每个调用 1 秒超时 + 重试一次”在三级调用链上可能变成 8 秒——而用户早已离开。

`AbortSignal.any` 把“超时”和“客户端断开”合并：用户关掉页面，只读的下游调用会被取消，不再浪费资源。**写操作不传客户端信号**：用户关页面不应让下单停在“做了一半”。

## 3. 错误分类决定能否重试

| 错误 | 含义 | 可重试？ |
| --- | --- | --- |
| 连接失败（ECONNREFUSED 等） | 请求大概率没到达对方 | 是（幂等操作） |
| 超时 | 对方**可能正在处理**或已经处理完 | 只有幂等操作 + 剩余预算充足 |
| 503 | 对方明确表示暂时不可用 | 是（幂等操作） |
| 4xx | 请求本身有问题 | 否 |
| 500 | 对方出 bug | 通常否 |

`retryIdempotent` 只用于带幂等键的下单与天然幂等的状态迁移，最多重试一次，带 20–50ms 抖动，并要求剩余预算 > 100ms。**重试是放大器**：每层重试 3 次，三层就是 27 倍流量，这就是“重试风暴”。

## 4. 页面级聚合与降级

```js
const [products, recs, inbox] = await Promise.allSettled([
  orders('GET', '/products', { deadline, signal, userId }),          // 核心依赖
  rec('GET', '/recommendations?...', { ...optional }),                // 非核心，300ms
  notifications('GET', '/notifications', { ...optional })             // 非核心，300ms
])
if (products.status === 'rejected') throw products.reason             // 核心失败 → 整页失败
// 非核心失败 → 空数据 + degraded: ['recommendations']
```

- 三个调用**并行**发起，首页耗时 ≈ 最慢的那个，而不是三者之和。
- 返回 `degraded` 字段，前端据此显示“部分内容暂不可用”，而不是静默显示空列表——**降级要可见**，否则用户和运维都以为一切正常。
- 每次降级计入指标 `bff_degraded_total`，降级率上升时应告警。

```bash
REC_LATENCY_MS=1000 npm run shop    # 推荐服务变慢，首页仍在 ~300ms 内返回
```

## 5. 错误不能原样透传

下游返回的错误分三类处理：

- 白名单中的业务错误（`OUT_OF_STOCK`、`INVALID_STATE` 等）：透传 code 与 message，前端可以据此提示用户。
- 其他 4xx/5xx：统一为 `502 UPSTREAM_ERROR`，“服务暂时不可用，请稍后重试”。下游的 SQL 报错、堆栈、内部主机名**绝不能**出现在响应里（测试会检查）。
- 所有错误都带 `requestId`，用户反馈时可以直接定位日志。

## 6. 视图模型

BFF 把后端模型转换成页面直接可用的数据：

```js
{ total: '¥798.00', statusText: '待支付', canPay: true, canCancel: true }
```

“这个订单能不能取消”是**业务规则**，放在服务端决定，前端只负责显示按钮。否则规则会在 Web、iOS、Android 三端各实现一遍，且迟早不一致。

### 兼容旧客户端

旧版 App 发送 `quantity` 字段，新版用 `qty`。BFF 同时接受两者，并记录指标 `bff_deprecated_field_total`。**指标归零后才能删除兼容代码**——不要凭感觉判断“应该没人用了”。

## 7. 会话、CSRF 与登录安全

| 措施 | 实现 | 防御 |
| --- | --- | --- |
| Cookie `HttpOnly; SameSite=Lax; Path=/`（生产加 `Secure`） | `bff/server.js` | XSS 窃取会话、跨站请求携带 Cookie |
| 登录后轮换 session ID | `sessions.destroy(old)` + `create()` | 会话固定攻击 |
| 写请求校验 `Origin`（或 `Sec-Fetch-Site: same-origin`） | `assertSameOrigin` | CSRF |
| scrypt 哈希 + 异步计算 | `bff/session.js` | 数据库泄漏后的密码还原；阻塞事件循环 |
| 未知用户也计算一次哈希 | `dummy` | 通过响应时间枚举用户名 |
| 按 IP+用户名限流，返回 `429 + Retry-After`；**在 await 密码校验之前同步计数** | `createLoginLimiter` | 暴力破解（包括并发爆破） |
| 会话 Cookie 不设 `Max-Age`，空闲超时由服务端滑动 TTL 决定 | `createSessionStore` | 固定 `Max-Age` 不刷新时，活跃用户会被强制登出 |
| CSP、`nosniff`、`Referrer-Policy` | `defaultHeaders` | XSS 影响面、MIME 嗅探、URL 泄漏 |

::: danger 先检查、再 await、再计数 = 没有限流
```js
if (limiter.blocked(key)) throw tooMany()   // 20 个并发请求同时通过检查
const user = await users.verify(...)        // 全部在这里等待 scrypt
if (!user) limiter.fail(key)                // 计数来得太晚
```
这是 Node 中最常见的一类竞态：**检查与更新之间隔了一个 `await`**。正确做法是在 `await` 之前同步完成“检查 + 计数”（`limiter.hit(key)`），成功后再重置。测试“并发爆破也只能尝试 5 次”同时发起 20 个请求验证这一点。用 Redis 时对应 `INCR` + `EXPIRE` 的原子操作。

本项目最初的实现就有这个 bug，是代码审查时用 50 个并发请求发现的——串行的测试永远发现不了它。
:::

::: warning 内存中的会话与限流
只适用于单实例。多实例部署时请求会落到不同实例上，必须换成 Redis 等共享存储。这是[进阶练习](./senior)之一。
:::

## 破坏实验

1. 把首页的 `Promise.allSettled` 改成 `Promise.all`，并设置 `REC_FAIL_RATE=1`。页面会怎样？
2. 删掉 `createUpstream` 里的 `deadline.remaining()`，只保留单次超时，然后把核心依赖的超时调到 1000ms、预算仍是 800ms。观察“首页聚合”测试的耗时断言。
3. 删除 `assertSameOrigin` 的调用，运行 CSRF 测试。然后写一个本地 HTML 页面（另一个端口）对 BFF 发起表单 POST，观察 `SameSite=Lax` 能挡住什么、挡不住什么。

## 练习

1. 为推荐服务实现**熔断器**：连续失败 5 次后打开 10 秒，期间直接降级不发请求；半开状态放行一个探测请求。写测试覆盖三种状态转换（可参考[稳定性章节](../bff/resilience)与实验 `npm run lab -- resilient-call`）。
2. 把会话存储抽象成接口，提供内存实现与（模拟的）Redis 实现，并用同一组测试验证两者。
3. 首页增加“最近订单”区块（调用 `/orders?limit=3`），作为非核心依赖处理；写测试证明订单服务列表接口变慢时首页仍然可用。
