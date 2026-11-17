# 上线与运维：关闭、指标、压测

> 代码：`examples/shop/lib/lifecycle.js`、`lib/metrics.js`、`lib/context.js`、`scripts/load.js` · 测试：`test/lifecycle.test.js`

## 1. 优雅关闭

K8s 滚动发布时，旧 Pod 收到 SIGTERM。正确的关闭顺序：

```text
SIGTERM
  → readiness 返回 503（LB 开始摘流量）
  → 等待 drainDelay（Endpoint 摘除在集群中传播需要时间，期间仍有新请求进来）
  → server.close()：不再接受新连接，等待在途请求结束
  → 停止后台任务（outbox relay）——它还在用数据库
  → 关闭数据库
  → 退出
```

```js
// lib/lifecycle.js（节选）
const sweep = setInterval(() => server.closeIdleConnections(), 50)
server.close(() => { clearInterval(sweep); resolve() })
server.closeIdleConnections()
```

::: danger 一个真实的坑
`server.close()` 只会关闭**调用那一刻**空闲的 keep-alive 连接。一个在关闭开始时还在处理请求的连接，响应结束后变成空闲，但**不会**被关闭，`close()` 的回调要等到 `keepAliveTimeout`（本项目 65 秒）才触发。

本项目最初的实现就有这个 bug，是测试“优雅关闭”用 keep-alive Agent 发请求后超时才暴露的。修复方法是周期性调用 `closeIdleConnections()`，并对关闭期间开始的请求返回 `Connection: close`。
:::

测试断言了完整顺序：

```js
assert.deepEqual(events, ['request finished', 'relay stopped', 'db closed'])
```

以及：关闭期间 `/readyz` 返回 503、在途请求正常完成、关闭后新连接被拒绝、某个资源关闭卡住时强制退出。

### 关闭超时的配置关系

```text
preStop sleep / drainDelay  +  最长请求耗时  +  资源关闭  <  应用强制退出超时  <  terminationGracePeriodSeconds
```

任何一个不等式不成立，都会在发布时出现 502 或被 SIGKILL 掐断的请求。

## 2. 可观测性

### 日志：结构化 + requestId

```json
{"time":"...","level":"info","service":"bff","msg":"access","requestId":"9f0a...","method":"POST","route":"/bff/orders","status":201,"ms":12}
```

requestId 由 BFF 生成（或接受上游的），通过 `x-request-id` 传给每个下游服务，每个服务的日志都带上它。一次请求在四个服务中的所有日志，用一个 ID 就能串起来。这就是分布式追踪的最小形态；OpenTelemetry 在此基础上增加了 span 层级与耗时。

### 指标：RED + 饱和度

`GET /metrics` 输出 Prometheus 格式：

| 指标 | 用途 |
| --- | --- |
| `http_requests_total{service,method,route,status}` | Rate、Errors |
| `http_request_duration_seconds_bucket{service,route}` | Duration（P50/P99） |
| `upstream_requests_total{upstream,outcome}` | 下游超时/失败率 |
| `bff_degraded_total{dependency}` | 降级率 |
| `nodejs_eventloop_delay_p99_seconds` | Node 特有的饱和度信号 |
| `notification_events_total{topic,result}` | 重复投递比例（`duplicate`） |

`route` 标签必须是模板（`/bff/orders/:id`）。用真实 URL 会让每个订单 ID 产生一条时间序列，Prometheus 内存爆炸——测试专门检查了这一点。

## 3. 压测：先测量，再优化

```bash
npm run shop                                           # 终端 1
node examples/shop/scripts/load.js http://127.0.0.1:4000 50 10   # 终端 2：50 并发，10 秒
```

输出 RPS、P50/P95/P99 与状态码分布。建议依次做以下实验并**记录数据**：

| 实验 | 预期观察 |
| --- | --- |
| 基线 | 记录 RPS 与 P99 |
| `REC_LATENCY_MS=1000` | P99 被限制在 ~300ms 附近；`bff_degraded_total` 增长 |
| 在 BFF 某个路由里加一段同步 CPU 循环（如 20ms） | RPS 断崖下降；**所有**路由的 P99 上升；事件循环延迟指标升高 |
| 把 CPU 循环移到 `worker_threads` | 其他路由恢复 |
| 同时运行 `node --cpu-prof examples/shop/start.js` | 用 Chrome DevTools 打开 `.cpuprofile`，找到热点函数 |

::: tip 量化你的结论
“加了缓存之后快了”不是结论。“P99 从 180ms 降到 40ms，RPS 从 1200 提升到 3100，测试环境 4 核、50 并发”才是。资深工程师的每一个性能结论都带数据和测试条件。
:::

## 破坏实验

1. 删除 `lifecycle.js` 中的 `sweep` 定时器，运行 `node --test "examples/shop/test/lifecycle.test.js"`，观察测试超时。然后解释为什么。
2. 调换 `stack.js` 中 `relay.stop()` 与 `db.close()` 的注册顺序，并让 relay 在关闭时正在投递（提示：增大 `publish` 的耗时）。会发生什么错误？
3. 把 `keepAliveTimeout` 设为 5000，思考它在“LB 空闲超时 60 秒”的环境中会导致什么现象（见 [HTTP 章节](../core/http)）。

## 练习

1. 增加 `/metrics` 指标 `outbox_lag_seconds` 与 `outbox_pending`，并写出两条 Prometheus 告警规则（PromQL），说明阈值依据。
2. 给 BFF 增加按路由的并发上限（舱壁）：`/bff/pages/home` 同时最多处理 100 个请求，超出直接返回 503 + `Retry-After`。用压测脚本验证它保护了其他路由。
3. 写一份本项目的**运行手册**（runbook）：首页 P99 告警、下单 5xx 告警、outbox 积压告警三种情况，各自的排查步骤与止血手段。
