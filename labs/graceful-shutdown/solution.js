// 参考实现：优雅停机
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

export function createGracefulServer(
  handler,
  {
    onClose = async () => {},
    drainDelayMs = 0,
    timeoutMs = 5000,
    onForceExit = () => process.exit(1),
  } = {},
) {
  const server = http.createServer(handler)
  let ready = true
  let shutdownPromise

  function closeServer() {
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
      // server.close() 只关闭“此刻空闲”的连接；正在处理请求的 keep-alive 连接
      // 在响应结束后会重新变为空闲，需要反复清理，否则要等 keepAliveTimeout 才会关闭
      server.closeIdleConnections()
      const sweeper = setInterval(() => server.closeIdleConnections(), 10)
      server.once('close', () => clearInterval(sweeper))
    })
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise
    ready = false
    const forceTimer = setTimeout(() => onForceExit(), timeoutMs)
    forceTimer.unref()

    shutdownPromise = (async () => {
      try {
        // 先让就绪探针失败，等负载均衡器把本实例摘掉，再停止接收新连接
        if (drainDelayMs > 0) await delay(drainDelayMs)
        await closeServer()
        await onClose()
      } finally {
        clearTimeout(forceTimer)
      }
    })()
    return shutdownPromise
  }

  return { server, shutdown, isReady: () => ready }
}
