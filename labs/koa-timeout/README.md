# 实验：koa-timeout（Koa 超时中间件）

## 目标

基于仓库中的 `examples/mini-koa/compose.js`，实现一个 Koa 风格的 `timeout(ms)` 中间件：超时返回 504，并通过 `ctx.signal` 通知下游取消正在进行的工作。

## 背景

没有超时的接口是生产事故的温床：下游数据库或服务一旦变慢，请求会无限堆积，占满连接池和内存，最终拖垮整个服务。只返回 504 还不够——如果下游工作还在继续跑，资源依然被占用，所以需要用 `AbortSignal` 把“取消”传递下去（`fetch`、`setTimeout`、许多数据库驱动都支持 signal）。超时定时器如果不清理，在高 QPS 下会积累成千上万个定时器，还会让进程无法正常退出。

## 要实现的接口

```js
import { timeout } from './solution.js'

app.use(timeout(ms))   // (ctx, next) => Promise<void>
```

- 在 `ctx.signal` 上提供一个 `AbortSignal`
- 超时：abort 该 signal，`ctx.status = 504`，`ctx.body = { code: 'GATEWAY_TIMEOUT' }`
- 下游正常完成或抛错时清除定时器；下游的错误原样抛出

## 验收标准

- 快速处理：状态码与响应体不变，`ctx.signal.aborted === false`
- 慢处理：尽快返回 504 `GATEWAY_TIMEOUT`，`ctx.signal.aborted === true`，下游通过 signal 感知取消
- 下游同步或异步抛出的错误原样向上传播
- 完成、出错、超时三种情况下都不留下活动的定时器
- 外层中间件在 `await next()` 之后能看到 504

## 提示

1. `Promise.race([next(), timerPromise])`，用一个独特的值（例如 `Symbol`）区分“谁赢了”。
2. 超时后下游的 promise 可能稍后才 reject，提前给它挂一个空的 `.catch`，避免 `unhandledRejection`。
3. 用 `try { ... } finally { clearTimeout(timer) }` 覆盖所有路径。

## 运行命令

```bash
npm run lab -- koa-timeout
# 或
node labs/run.js koa-timeout
```

## 延伸思考

1. 如果下游完全不理会 `ctx.signal`，超时后又写入了 `ctx.body`，会发生什么？如何防止“迟到的响应”覆盖 504？
2. 网关超时、服务端超时、下游调用超时应如何设置才能形成合理的“超时预算”？
3. 504 与 503 的语义有什么区别？客户端应该如何区别对待？
