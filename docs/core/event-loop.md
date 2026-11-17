# Node.js 架构与事件循环

## 1. 整体架构

```
┌──────────────────────────────────────────────┐
│ 你的 JS 代码 / npm 包                          │
├──────────────────────────────────────────────┤
│ Node.js 标准库 (lib/*.js：fs, http, stream…)   │
├──────────────────────────────────────────────┤
│ Bindings (C++)                                │
├──────────────┬──────────────┬────────────────┤
│ V8 (JS 执行)  │ libuv (事件循环│ llhttp, OpenSSL│
│ 堆/GC/JIT     │ + 线程池 + IO) │ zlib, c-ares…  │
└──────────────┴──────────────┴────────────────┘
```

- **JS 是单线程的**：你的业务代码在一个主线程上执行。
- **I/O 不是单线程的**：网络 I/O 由操作系统的 epoll/kqueue/IOCP 异步完成；文件 I/O、DNS (`dns.lookup`)、`crypto`、`zlib` 用 libuv **线程池**（默认 4 个，`UV_THREADPOOL_SIZE` 可调，最大 1024）。

::: warning 结论
Node 擅长 **I/O 密集**（BFF、网关、API 聚合），不擅长 **CPU 密集**（图片处理、大 JSON 计算、加密大量数据）——后者会阻塞主线程，让所有请求排队。
:::

## 2. 事件循环六阶段

```
   ┌───────────────────────────┐
┌─>│           timers          │  setTimeout / setInterval 到期回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks     │  上一轮推迟的系统回调（如 TCP 错误）
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare       │  内部使用
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │           poll            │  取新的 I/O 事件并执行回调；可能在此阻塞等待
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │           check           │  setImmediate 回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
└──┤      close callbacks      │  socket.on('close')
   └───────────────────────────┘
```

**微任务**：每执行完**一个**宏任务回调后，先清空 `process.nextTick` 队列，再清空 Promise 微任务队列（Node ≥ 11 与浏览器一致）。

### 经典题

```js
setTimeout(() => console.log('timeout'), 0)
setImmediate(() => console.log('immediate'))
process.nextTick(() => console.log('nextTick'))
Promise.resolve().then(() => console.log('promise'))
console.log('sync')
// CommonJS 中：sync → nextTick → promise → (timeout / immediate 顺序不确定)
```

::: warning ESM 中的差异
在 ES Module（`.mjs` 或 `"type": "module"`）顶层运行同样代码，输出是 `sync → promise → nextTick`。原因：ESM 模块求值本身发生在一个 Promise 任务中，当前微任务队列会先被清空，之后才轮到 `nextTick` 队列。可运行 `node examples/event-loop/order.js` 亲自验证。
**结论**：业务代码不要依赖 `nextTick` 与 Promise 的相对顺序。
:::

`timeout` 与 `immediate` 在主模块中顺序不确定（取决于进入循环时 1ms 是否已过）；但在 **I/O 回调内**，`setImmediate` 一定先于 `setTimeout`：

```js
require('fs').readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0)
  setImmediate(() => console.log('immediate')) // 一定先输出
})
```

### nextTick 饿死

```js
function loop() { process.nextTick(loop) } // 永远不会进入 I/O 阶段，服务“假死”
loop()
```

## 3. 事件循环阻塞：后端第一杀手

```js
app.get('/report', (req, res) => {
  const data = JSON.parse(fs.readFileSync('big.json')) // 同步读 + 大 JSON 解析
  res.json(heavyCompute(data))                         // CPU 计算 2s
})
// 这 2s 内其他所有请求（包括健康检查）都无法响应 → K8s 判定不健康 → 重启
```

**对策**：
- 禁用同步 API（`*Sync`）于请求路径；
- 大计算放 `worker_threads` 或独立服务；
- 大数据用 Stream；
- 长循环分片：`await new Promise(setImmediate)` 让出主线程；
- 监控事件循环延迟：

```js
const { monitorEventLoopDelay } = require('node:perf_hooks')
const h = monitorEventLoopDelay({ resolution: 20 })
h.enable()
setInterval(() => {
  console.log('eventloop p99(ms)=', h.percentile(99) / 1e6)
  h.reset()
}, 5000)
```

## 4. V8 内存基础

- 堆分为**新生代**（Scavenge，复制算法，快）和**老生代**（Mark-Sweep-Compact）。
- 默认老生代上限与机器/版本相关，容器内建议显式设置：`node --max-old-space-size=1536 app.js`（约为容器内存的 75%）。
- `process.memoryUsage()`：`rss`（进程总占用）、`heapUsed`、`external`（Buffer 等堆外）。

## 练习

1. 写一段代码，证明 `UV_THREADPOOL_SIZE=1` 时并发 4 次 `crypto.pbkdf2` 是串行的。
2. 在 Express 中加一个 `/block` 路由死循环 3 秒，用 `autocannon` 压测其他路由，观察 P99。
3. 接入 `monitorEventLoopDelay`，在 `/block` 期间观察指标。
