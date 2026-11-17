// 优雅关闭：摘流量 → 停止接收新连接并等待在途请求 → 关闭依赖 → 退出。
// 顺序很重要：如果先关数据库，仍在处理的请求会失败。
export function createLifecycle({ logger, drainDelayMs = 0, timeoutMs = 10_000, onForceExit = () => process.exit(1) } = {}) {
  const servers = []
  const cleanups = []
  let state = 'running'
  let shutdownPromise = null

  return {
    addServer(server) { servers.push(server); return server },
    // 后注册的先关闭：通常上层（后台任务）依赖下层（数据库）
    onShutdown(fn) { cleanups.unshift(fn) },
    isReady: () => state === 'running',
    isShuttingDown: () => state !== 'running',

    shutdown(reason = 'manual') {
      if (shutdownPromise) return shutdownPromise
      state = 'draining'
      logger?.info('shutdown started', { reason })
      const timer = setTimeout(() => {
        logger?.error('shutdown timed out, forcing exit', { timeoutMs })
        onForceExit()
      }, timeoutMs)
      timer.unref()

      shutdownPromise = (async () => {
        // 1. readiness 已返回 503；给负载均衡器时间把本实例摘除（K8s 中 endpoints 传播有延迟）
        if (drainDelayMs > 0) await new Promise(r => setTimeout(r, drainDelayMs))
        // 2. 不再接收新连接，等待在途请求结束。
        // server.close() 只会关闭“此刻空闲”的 keep-alive 连接；在途请求结束后才变空闲的连接
        // 要再次清理，否则会一直挂到 keepAliveTimeout（本项目是 65 秒）。
        state = 'closing'
        await Promise.all(servers.map(server => new Promise(resolve => {
          const sweep = setInterval(() => server.closeIdleConnections(), 50)
          server.close(() => { clearInterval(sweep); resolve() })
          server.closeIdleConnections()
        })))
        // 3. 在途请求都结束后，再关闭后台任务与资源
        for (const fn of cleanups) await fn()
        state = 'stopped'
        clearTimeout(timer)
        logger?.info('shutdown complete')
      })()
      return shutdownPromise
    },

    installSignalHandlers({ exit = code => process.exit(code) } = {}) {
      const handler = signal => this.shutdown(signal).then(() => exit(0), err => {
        logger?.error('shutdown failed', { err })
        exit(1)
      })
      process.once('SIGTERM', handler)
      process.once('SIGINT', handler)
    }
  }
}
