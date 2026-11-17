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
let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  // 1. 健康检查返回 503，让 LB 摘流量
  // 2. 停止接收新连接，等待在途请求完成
  server.close()
  server.closeIdleConnections?.()
  // 3. 关闭资源
  await Promise.allSettled([db.end(), redis.quit(), mq.close()])
  // 4. 兜底超时
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

::: warning
Docker 中 `CMD npm start` 会让 npm 成为 PID 1，**SIGTERM 不会转发给 node**。使用 `CMD ["node", "dist/main.js"]` 或 `tini`。
:::

## 练习

用 `piscina` 实现一个 `/thumbnail` 接口的 CPU 计算卸载，对比压测时其他接口的 P99。
