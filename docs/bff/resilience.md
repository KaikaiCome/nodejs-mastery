# 稳定性：超时 / 重试 / 熔断 / 降级 / 限流

BFF 依赖众多下游，**任何一个下游变慢都可能拖垮整个 BFF**（连接、内存、事件循环被在途请求占满）。稳定性设计是 BFF 的核心价值。

## 1. 超时：一切调用必须有超时

- 下游超时 < BFF 整体超时 < 网关超时 < 前端超时。
- 设置**整体请求截止时间（deadline）**，后续下游调用使用剩余时间：

```ts
const deadline = Date.now() + 3000
const remain = () => Math.max(0, deadline - Date.now())
await userSvc.get(id, { timeout: Math.min(800, remain()) })
```

## 2. 重试：只对幂等、可重试的错误

```ts
async function retry<T>(fn: () => Promise<T>, { times = 2, base = 100 } = {}): Promise<T> {
  let lastErr
  for (let i = 0; i <= times; i++) {
    try { return await fn() } catch (err: any) {
      lastErr = err
      const retriable = ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET'].includes(err.code) || err.status === 503
      if (!retriable || i === times) break
      await sleep(base * 2 ** i + Math.random() * base) // 指数退避 + 抖动
    }
  }
  throw lastErr
}
```

::: warning 重试风暴
3 层调用每层重试 3 次 = 下游承受 27 倍流量。规则：只在一层重试；设置重试预算（如重试请求不超过总请求的 10%）；非幂等的 POST 不重试（除非有幂等键）。
:::

## 3. 熔断（Circuit Breaker）

下游持续失败时快速失败，给它恢复时间，同时保护自己。

```
CLOSED ──失败率超阈值──► OPEN ──等待 resetTimeout──► HALF_OPEN ──试探成功──► CLOSED
                                              └──试探失败──► OPEN
```

```ts
import CircuitBreaker from 'opossum'
const breaker = new CircuitBreaker((uid) => recClient.list(uid), {
  timeout: 500,                 // 超时视为失败
  errorThresholdPercentage: 50, // 失败率 50% 打开
  resetTimeout: 10_000,         // 10s 后半开
  volumeThreshold: 20           // 至少 20 个请求才统计
})
breaker.fallback(() => [])      // 降级
breaker.on('open', () => logger.warn('rec breaker open'))
const recs = await breaker.fire(uid)
```

示例中的手写版本见 `examples/bff-aggregation/breaker.js`。

## 4. 降级

| 级别 | 示例 |
| --- | --- |
| 返回默认值 | 推荐失败返回空列表 |
| 返回缓存旧数据 | stale-while-revalidate，读取上次成功结果 |
| 关闭功能 | 配置中心开关关闭非核心模块 |
| 静态兜底 | 首页整体降级为 CDN 静态 JSON |

响应中标记 `degraded: true`，便于前端展示与监控统计。

## 5. 缓存（BFF 层）

- 进程内 LRU（`lru-cache`）：热点配置、字典，毫秒级；注意多实例不一致与内存上限。
- Redis：跨实例共享。
- HTTP 缓存：对公开数据设置 `Cache-Control` + CDN。
- 绝不缓存**用户私有数据到共享 key**（缓存 key 要包含用户维度）。

## 6. 限流与隔离

- 入口限流：令牌桶/滑动窗口（网关或 Redis）。
- **舱壁隔离**：每个下游独立连接池/并发上限，慢下游不会耗尽所有资源。

```ts
import pLimit from 'p-limit'
const recLimit = pLimit(50) // 推荐服务最多 50 并发
const recs = await recLimit(() => breaker.fire(uid))
```

- 过载保护：事件循环延迟 > 阈值时直接返回 503（`@fastify/under-pressure` / `toobusy-js`）。

## 7. 稳定性检查清单

- [ ] 每个下游：超时、重试策略、熔断、降级方案、并发上限
- [ ] 核心 / 非核心依赖分级
- [ ] 健康检查 `/healthz`（存活）与 `/readyz`（就绪，检查关键依赖）
- [ ] 优雅关闭
- [ ] 压测与故障演练（混沌工程：注入延迟/错误）

## 练习

在 `examples/bff-aggregation` 中把推荐服务失败率调到 80%，观察熔断打开后 BFF 的 P99 变化。
