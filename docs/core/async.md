# 异步编程与错误处理

## 演进

回调（error-first）→ Promise → async/await → AsyncIterator / Stream。

```js
const { promisify } = require('node:util')
const sleep = promisify(setTimeout)
```

## 并发控制：BFF 的基本功

```js
// 1. 全部成功才返回
const [user, orders] = await Promise.all([getUser(id), getOrders(id)])

// 2. 部分失败可容忍（BFF 聚合常用）
const results = await Promise.allSettled([getUser(id), getAds(id)])
const ads = results[1].status === 'fulfilled' ? results[1].value : []

// 3. 限制并发数（避免打爆下游）
async function mapLimit(list, limit, fn) {
  const ret = new Array(list.length)
  let i = 0
  const workers = Array.from({ length: limit }, async () => {
    while (i < list.length) {
      const idx = i++
      ret[idx] = await fn(list[idx], idx)
    }
  })
  await Promise.all(workers)
  return ret
}
```

### 常见坑：forEach + async

```js
ids.forEach(async id => { await save(id) }) // 不会等待，错误也无法被捕获
for (const id of ids) await save(id)        // 串行
await Promise.all(ids.map(save))            // 并行
```

## 超时与取消：AbortController

```js
async function fetchWithTimeout(url, ms = 3000) {
  const signal = AbortSignal.timeout(ms)
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  return res.json()
}

// 客户端断开时，取消所有下游请求
app.get('/page', async (req, res) => {
  const ac = new AbortController()
  req.on('close', () => ac.abort())
  const data = await fetch(UPSTREAM, { signal: ac.signal })
})
```

## 错误处理全景

| 错误类型 | 例子 | 处理 |
| --- | --- | --- |
| 操作错误（可预期） | 下游超时、参数错误、记录不存在 | 捕获、转换为业务错误码、返回 4xx/5xx |
| 程序错误（bug） | `undefined.x`、逻辑错误 | 记录日志 + 告警；严重时让进程退出由守护进程重启 |

```js
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection')
  // Node ≥ 15 默认会让进程崩溃，这是好事：不要静默吞掉
})
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException')
  // 进程已处于未知状态：优雅关闭后退出
  gracefulShutdown().finally(() => process.exit(1))
})
```

::: danger 不要这样做
`process.on('uncaughtException', () => {})` 吞掉异常继续运行，会导致连接、锁、事务处于不一致状态，后果比崩溃更严重。
:::

## AsyncLocalStorage：请求上下文

后端日志必须带 `traceId`，但不想把它层层传参：

```js
const { AsyncLocalStorage } = require('node:async_hooks')
const als = new AsyncLocalStorage()

app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || crypto.randomUUID()
  als.run({ traceId, userId: null }, next)
})

function log(msg) {
  const store = als.getStore()
  console.log(JSON.stringify({ traceId: store?.traceId, msg }))
}
```

## 练习

1. 实现 `retry(fn, { times, backoff })`，支持指数退避 + 抖动。
2. 实现 `pTimeout(promise, ms)`，超时后 reject 并调用可选的 `onTimeout` 清理。
