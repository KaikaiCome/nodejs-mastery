# 实验：resilient-call（弹性调用）

## 目标

实现一个调用下游服务的客户端 `createClient`：每次尝试有独立超时，整体有总时限（deadline），只对**幂等**请求在**可重试错误**上重试。

## 背景

微服务调用链里，只设“单次超时”而不设“总时限”，重试叠加后用户可能要等上几十秒，上游早已超时放弃，下游却还在白白干活。只设总时限而没有单次超时，一个卡住的连接就会吃掉全部预算，失去重试机会。重试也不能一刀切：`POST /orders` 这类非幂等请求，第一次可能已经在服务端成功只是响应丢了，盲目重试会导致重复下单、重复扣款；4xx 是请求本身的问题，重试多少次结果都一样。502/503/504 和网络错误通常是暂时的，才值得重试。

## 要实现的接口

```js
const client = createClient({
  request: async (attempt, { signal }) => ({ status, body }), // 可能抛出网络错误
  deadlineMs: 100,       // 总时限
  attemptTimeoutMs: 30,  // 单次超时
  retries: 2,            // 最多重试次数
  backoffMs: 10,         // 可选，重试间隔基数
  now: () => performance.now(), // 可选
  sleep: (ms) => Promise,       // 可选
})

await client.call({ idempotent: true }) // => { status, body }
```

- 每次尝试的 signal 在 `min(attemptTimeoutMs, 剩余总时间)` 后 abort
- 可重试 = `idempotent === true` 且（抛错/单次超时 或 状态码 502/503/504）且还有剩余时间且还有重试次数
- 不可重试时：抛出的错误原样抛出；拿到的响应原样返回（包括 5xx）
- 总时间耗尽：以 `err.code === 'DEADLINE_EXCEEDED'` 的错误拒绝

## 验收标准

- 首次成功直接返回，`request` 收到 `attempt = 0` 和一个 `AbortSignal`
- 幂等请求遇到 503、网络错误会重试直到成功
- 重试次数用尽时共调用 `retries + 1` 次，返回最后的 5xx 响应
- 非幂等请求从不重试：503 原样返回，网络错误原样抛出
- 4xx 从不重试
- 挂起的请求在 `attemptTimeoutMs` 后被 abort，幂等请求继续重试
- 总时限（100ms）耗尽后以 `DEADLINE_EXCEEDED` 拒绝，耗时接近 deadline，调用次数受限
- 单次超时大于剩余时间时按剩余时间 abort；即使 `request` 不理会 signal，`call` 也要按时结束

## 提示

1. 在 `call` 开头算出绝对的 `deadline = now() + deadlineMs`，之后每一步都用 `deadline - now()` 求剩余时间。
2. abort 时传入不同的 `reason`（单次超时 vs 总时限），后续判断会简单很多。
3. 别信任 `request` 一定会响应 signal：把它的 promise 和 abort 事件赛跑。

## 运行命令

```bash
npm run lab -- resilient-call
# 或
node labs/run.js resilient-call
```

## 延伸思考

1. 如何让非幂等请求也能安全重试？（提示：幂等键 `Idempotency-Key`）
2. 下游返回 `Retry-After` 头时，客户端应该如何调整退避？
3. 当下游持续故障时，重试会放大流量。熔断器（circuit breaker）和重试预算（retry budget）如何配合？
