# 实验：event-loop-yield（事件循环让步）

## 目标

实现 `processInChunks`：把一次性的大批量同步计算切成小块，块与块之间主动让出事件循环，避免长时间阻塞。

## 背景

Node.js 只有一个 JS 主线程。一个耗时 500ms 的同步循环（例如对 10 万条记录做 JSON 转换、排序、计算签名）会让这 500ms 内所有请求、定时器、健康检查都无法响应，表现为 P99 延迟飙升，甚至被 Kubernetes 的存活探针判定为失败而重启。把工作切片并在片间让步，能让其他回调“插队”执行，用略长的总耗时换取服务整体的响应性。对于真正重的 CPU 任务，应进一步考虑 `worker_threads`。

## 要实现的接口

```js
processInChunks(items, fn, {
  chunkSize = 1000,
  yieldFn = () => new Promise((r) => setImmediate(r)),
}) => Promise<any[]>   // fn(item, index) 为同步函数，返回值按顺序组成结果数组
```

## 验收标准

- 结果数组与输入一一对应，`fn` 收到 `(item, index)`
- 处理 10000 项、`chunkSize = 500` 时，提前排队的 `setTimeout(0)` 在处理中途（分片边界）执行
- 使用默认 `yieldFn` 时，提前排队的 `setImmediate` 回调在处理中途执行
- 只在分片之间让步：10000 项 / 500 每片恰好调用 `yieldFn` 19 次
- 空数组返回 `[]` 且不调用 `yieldFn`
- `chunkSize` 不是正整数时以 `RangeError` 拒绝
- `fn` 抛错时返回的 promise 被拒绝

## 提示

1. `await Promise.resolve()` 只会进入微任务队列，微任务会在回到事件循环之前全部清空——这**不是**让步。
2. `setImmediate` 回调在事件循环的 check 阶段执行，正好排在 I/O 回调之后。
3. 外层循环按 `start += chunkSize` 推进，内层循环处理 `[start, end)`。

## 运行命令

```bash
npm run lab -- event-loop-yield
# 或
node labs/run.js event-loop-yield
```

## 延伸思考

1. 为什么不用 `process.nextTick` 作为 `yieldFn`？它会造成什么后果？
2. `chunkSize` 太大或太小各有什么代价？如何按“每片耗时不超过 N 毫秒”动态调整？
3. 什么情况下应该放弃分片，改用 `worker_threads` 或独立服务？
