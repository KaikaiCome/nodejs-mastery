# 进程、线程与集群

## process

```js
process.env.NODE_ENV
process.argv
process.exitCode = 1          // 优于 process.exit(1)，让事件循环自然结束
process.on('SIGTERM', shutdown) // K8s/Docker 停止容器发送 SIGTERM
```

## child_process

| API | 用途 |
| --- | --- |
| `spawn` | 流式输出、长时间运行命令 |
| `exec` | 小输出，走 shell（**注意命令注入**） |
| `execFile` | 不走 shell，参数数组，更安全 |
| `fork` | 启动 Node 子进程，带 IPC 通道 |

```js
const { execFile } = require('node:child_process')
execFile('git', ['log', '-1', '--format=%H'], (err, stdout) => { /* ... */ })
```

## worker_threads：CPU 密集任务

```js
// main.js
const { Worker } = require('node:worker_threads')
function runHash(payload) {
  return new Promise((resolve, reject) => {
    const w = new Worker('./hash-worker.js', { workerData: payload })
    w.once('message', resolve)
    w.once('error', reject)
  })
}
// hash-worker.js
const { parentPort, workerData } = require('node:worker_threads')
parentPort.postMessage(heavy(workerData))
```

生产中不要每次 new Worker（启动开销约数十 ms），使用线程池：`piscina`。

## cluster 与多核

```js
const cluster = require('node:cluster')
const os = require('node:os')
if (cluster.isPrimary) {
  for (let i = 0; i < os.availableParallelism(); i++) cluster.fork()
  cluster.on('exit', (w) => { console.log(`worker ${w.process.pid} died`); cluster.fork() })
} else {
  require('./server')
}
```

::: tip 容器时代的选择
在 K8s 中，更推荐**一个容器一个 Node 进程**，通过增加 Pod 副本横向扩展，CPU limit 设为 1 核左右。cluster/PM2 cluster 适用于虚拟机/物理机部署。
:::

## 优雅关闭（Graceful Shutdown）

```js
const { setTimeout: sleep } = require('node:timers/promises')
let shuttingDown = false
app.get('/readyz', (req, res) => res.status(shuttingDown ? 503 : 200).end())

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true // 1. readiness 立即返回 503，LB 开始摘流量
  logger.info({ signal }, 'shutting down')
  // 2. 兜底超时要最先设置：后面任何一步卡住都能强制退出
  setTimeout(() => process.exit(1), 10_000).unref()
  // 3. 给 LB / K8s Endpoint 传播留出时间，期间仍正常处理请求
  await sleep(5_000)
  // 4. 停止接收新连接，并“等待”在途请求完成
  await new Promise((resolve) => {
    // close() 只关闭此刻空闲的 keep-alive 连接；在途请求结束后才空闲的连接需要反复清理
    const sweep = setInterval(() => server.closeIdleConnections(), 100)
    server.close(() => { clearInterval(sweep); resolve() })
    server.closeIdleConnections()
  })
  // 5. 在途请求都结束了，才能关闭它们依赖的资源
  await Promise.allSettled([db.end(), redis.quit(), mq.close()])
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

::: danger 常见错误顺序
`server.close()` 不传回调、不 `await`，紧接着关闭数据库——此时在途请求仍在执行，会因为连接池已关闭而失败。正确的顺序永远是：**摘流量 → 等在途请求结束 → 关资源 → 退出**。

完整可运行的实现与测试见主线项目 [`examples/shop/lib/lifecycle.js`](https://github.com/KaikaiCome/nodejs-mastery/blob/main/examples/shop/lib/lifecycle.js)，对应实验：`npm run lab -- graceful-shutdown`。
:::

::: warning
Docker 中 `CMD npm start` 会让 npm 成为 PID 1，**SIGTERM 不会转发给 node**。使用 `CMD ["node", "dist/main.js"]` 或 `tini`。
:::

## 练习

用 `piscina` 实现一个 `/thumbnail` 接口的 CPU 计算卸载，对比压测时其他接口的 P99。
