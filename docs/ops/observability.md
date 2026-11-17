# 日志 / 指标 / 链路追踪

可观测性三支柱：**Logs（发生了什么）、Metrics（多少/多快）、Traces（在哪慢）**。

## 1. 指标（Prometheus）

```ts
import client from 'prom-client'
client.collectDefaultMetrics() // 内存、GC、事件循环延迟、句柄数

export const httpDuration = new client.Histogram({
  name: 'http_server_duration_seconds',
  help: 'HTTP latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 3]
})
app.use((req, res, next) => {
  const end = httpDuration.startTimer()
  // req.route 只包含子路由内的路径；挂载在 Router 下时要拼上 req.baseUrl，否则 /users/:id 与 /orders/:id 会混在一起
  res.on('finish', () => end({ method: req.method, route: req.route ? req.baseUrl + req.route.path : 'unmatched', status: res.statusCode }))
  next()
})
app.get('/metrics', async (req, res) => { res.set('Content-Type', client.register.contentType); res.end(await client.register.metrics()) })
```

::: warning 标签基数
`route` 用路由模板（`/users/:id`）而非实际 URL（`/users/123`），否则时间序列爆炸。
:::

### 核心指标（RED + USE）

- **R**ate 请求数、**E**rrors 错误率、**D**uration 延迟分位（P50/P95/P99）。
- 资源：CPU、内存（RSS/heap）、事件循环延迟、活跃句柄、连接池使用率。
- 下游：每个下游的 QPS、错误率、延迟、熔断状态。
- 业务：下单数、登录成功率。

### 告警示例

- 5 分钟错误率 > 1%；P99 > 1s；事件循环延迟 P99 > 200ms；内存持续增长；熔断打开。

## 2. 链路追踪（OpenTelemetry）

```ts
// tracing.ts —— 必须在其他模块之前加载：node --import ./dist/tracing.js dist/main.js
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

new NodeSDK({
  serviceName: 'bff-web',
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()] // 自动埋点 http/undici/express/koa/redis/mysql...
}).start()
```

- W3C `traceparent` header 自动在服务间传播。
- 在 Jaeger/Tempo 中能看到一次请求的瀑布图：BFF 总耗时 800ms，其中推荐服务 650ms → 定位瓶颈。
- 日志中写入 `trace_id`，日志与追踪互相跳转。

## 3. 日志

见 [配置、日志、错误、校验](../engineering/foundation)。补充：
- 访问日志：method、route、status、耗时、traceId、userId、UA。
- 下游调用日志：upstream、耗时、状态（慢调用 > 阈值时 warn）。
- 采样：高 QPS 时 info 级访问日志可采样，错误日志全量。

## 4. 前端监控与 BFF 联动

- 前端请求头携带 `x-request-id`，报错时上报，后端可按 id 查全链路。
- BFF 可作为前端埋点/错误上报的收集入口（注意限流与鉴权）。

## 练习

为 `examples/bff-aggregation` 增加 `/metrics`，用 Prometheus 抓取，并构造推荐服务变慢，观察下游延迟直方图变化。
