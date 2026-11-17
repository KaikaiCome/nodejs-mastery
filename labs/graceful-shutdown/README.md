# 实验：graceful-shutdown（优雅停机）

## 目标

实现 `createGracefulServer`：收到停机指令后，先摘流量，再停止接收新连接、等待在途请求完成、释放资源，并在超时时强制退出。

## 背景

每次发布、扩缩容、节点驱逐，Kubernetes 都会给进程发送 `SIGTERM`。如果进程立即退出，正在处理的请求会被腰斩，用户看到 502；如果先关闭数据库连接池再等请求结束，在途请求会因为拿不到连接而失败。正确的顺序是：就绪探针先失败 → 等负载均衡器摘除本实例（drain）→ 停止接收新连接 → 等在途请求完成 → 释放资源 → 退出。还有一个真实存在的坑：`server.close()` 只会关闭**调用那一刻**空闲的 keep-alive 连接，正在处理请求的连接在响应结束后会重新变为空闲，却要等到 `keepAliveTimeout` 才被关闭，于是停机被莫名拖长，甚至被 `terminationGracePeriodSeconds` 强杀。

## 要实现的接口

```js
const { server, shutdown, isReady } = createGracefulServer(handler, {
  onClose: async () => {},   // 释放资源（数据库、消息队列等）
  drainDelayMs: 0,           // 标记未就绪后等待多久再停止接收连接
  timeoutMs: 5000,           // 超时强制退出
  onForceExit: () => process.exit(1),
})

server.listen(3000)
process.on('SIGTERM', () => shutdown())
```

## 验收标准

- 存在 keep-alive 连接上的在途慢请求时，`shutdown()` 等它完成后才 resolve，且不会拖到 `keepAliveTimeout`（测试限时 3 秒）
- 事件顺序为 `['request done', 'onClose']`：`onClose` 必须在在途请求结束之后执行
- 停机后服务不再监听，新连接被拒绝（`ECONNREFUSED`）
- 调用 `shutdown()` 后 `isReady()` 立即为 `false`；drain 期间服务仍在监听并能处理请求
- 多次调用 `shutdown()` 只执行一次 `onClose`
- 超过 `timeoutMs` 仍未完成（例如 `onClose` 卡住）时调用 `onForceExit`
- 正常完成后不会调用 `onForceExit`；强制退出定时器需 `unref()`，不能阻止进程自然退出

## 提示

1. `server.close(callback)` 的回调在所有连接都关闭后才触发——问题在于有连接迟迟不关。
2. `server.closeIdleConnections()` 可以多次调用；想想在途请求的响应结束后，连接处于什么状态。
3. 把整个停机流程包在一个 `async` 函数里，用 `try/finally` 清理强制退出定时器，并缓存这个 promise。

## 运行命令

```bash
npm run lab -- graceful-shutdown
# 或
node labs/run.js graceful-shutdown
```

## 延伸思考

1. `drainDelayMs` 应该设成多少？它和就绪探针的 `periodSeconds`、`failureThreshold` 有什么关系？
2. 对于 WebSocket、SSE 这类长连接，优雅停机还需要额外做什么？
3. `timeoutMs` 与 Kubernetes 的 `terminationGracePeriodSeconds`、`preStop` 钩子应该如何配合？
