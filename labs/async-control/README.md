# 实验：async-control（异步流程控制）

## 目标

亲手实现生产代码里最常用的三个异步工具：带退避与取消的 `retry`、不泄漏定时器的 `pTimeout`、并发受限且保序的 `mapLimit`。

## 背景

调用下游服务、数据库或第三方 API 时，偶发失败是常态：不加重试会放大错误率，盲目重试（固定间隔、无上限）又会在下游故障时形成“重试风暴”，把对方彻底打垮。指数退避 + full jitter 能把重试请求在时间上打散，是 AWS 等云厂商推荐的做法。超时控制如果忘记 `clearTimeout`，会让进程无法退出、测试挂起，或在高 QPS 下累积大量定时器。批量处理（如批量拉取用户信息）不做并发限制，会瞬间打满连接池或触发下游限流。

## 要实现的接口

```js
retry(fn, {
  retries = 3,        // 最多重试次数（总调用次数 = retries + 1）
  baseMs = 100,
  maxMs = 10_000,
  shouldRetry = () => true,
  signal,             // AbortSignal，可选
  random = Math.random,
  sleep,              // (ms, { signal }) => Promise<void>，默认使用真实定时器
}) => Promise<T>      // fn(attempt) 中 attempt 从 0 开始

pTimeout(promise, ms, { signal }?) => Promise<T>

mapLimit(items, limit, fn) => Promise<R[]>   // fn(item, index)
```

## 验收标准

- `retry`
  - 失败后重试，`fn` 收到的 attempt 依次为 0, 1, 2…，成功即返回结果
  - 第 attempt 次失败后的等待时间 = `random() * min(maxMs, baseMs * 2 ** attempt)`
  - 重试次数用尽后抛出**最后一次**的错误，共调用 `retries + 1` 次
  - `shouldRetry(err)` 返回 false 时立即抛出，不再重试
  - `fn` 执行中或退避等待中 abort：立即以 `signal.reason` 拒绝，不再发起新尝试（即使 `fn`/`sleep` 不理会 signal）
  - 调用前 signal 已 abort：不调用 `fn`
- `pTimeout`
  - promise 先完成/失败时透传结果/错误
  - 超时以 `name === 'TimeoutError'` 的 `Error` 拒绝
  - promise 先结束或 signal abort 后，不留下任何活动的 `Timeout`
  - signal abort 时以 `signal.reason` 拒绝
- `mapLimit`
  - 结果顺序与输入顺序一致
  - 同时运行的任务数不超过 `limit`（并且能达到 `limit`）
  - 空数组返回 `[]`
  - 第一个错误立即 reject，之后不再启动新任务

## 提示

1. 写一个小工具 `raceAbort(promise, signal)`：把“任意 promise”与“signal 的 abort 事件”赛跑，你就不必依赖 `fn` 和 `sleep` 自己响应取消。记得在 promise 结束后 `removeEventListener`。
2. `pTimeout` 的关键是：无论哪条路径先结束，都要执行同一个清理函数。
3. `mapLimit` 可以用“启动器”模式：维护 `next`、`active` 计数，每完成一个任务就尝试再启动；失败时置位一个 `failed` 标志。

## 运行命令

```bash
npm run lab -- async-control
# 或
node labs/run.js async-control
```

## 延伸思考

1. 为什么 full jitter 比“固定退避 + 小随机数”更能缓解惊群效应？
2. `pTimeout` 超时后，原 promise 背后的工作仍在继续。如何让底层操作（如 `fetch`）也真正停止？
3. `mapLimit` 失败后，已经在运行的任务怎么办？如何结合 `AbortController` 把它们也取消掉？
