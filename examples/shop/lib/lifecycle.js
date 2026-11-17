// 优雅关闭：摘流量 → 停止接收新连接并等待在途请求 → 关闭依赖 → 退出。
// 顺序很重要：如果先关数据库，仍在处理的请求会失败。

// 自己统计每条连接上的在途请求数，返回“关闭所有没有在途请求的连接”的函数。
// 不能只用 server.closeIdleConnections()：它不会关闭“已建立但还没发出任何请求”的连接
// （fetch/undici 会预先建立这种备用连接），这种连接要等 headersTimeout（本项目 66 秒）才断开。
function trackConnections(server) {
  const inflight = new Map()
  server.on('connection', socket => {
    inflight.set(socket, 0)
    socket.once('close', () => inflight.delete(socket))
  })
  server.on('request', (req, res) => {
    const socket = req.socket
    inflight.set(socket, (inflight.get(socket) ?? 0) + 1)
    res.once('close', () => { if (inflight.has(socket)) inflight.set(socket, inflight.get(socket) - 1) })
  })
  return () => { for (const [socket, n] of inflight) if (n === 0) socket.destroy() }
}

export function createLifecycle({ logger, drainDelayMs = 0, timeoutMs = 10_000, onForceExit = () => process.exit(1) } = {}) {
  const servers = []
  const cleanups = []
  let state = 'running'
  let shutdownPromise = null

  return {
    addServer(server) { servers.push({ server, closeIdle: trackConnections(server) }); return server },
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
        // server.close() 只会关闭“此刻空闲”的连接；在途请求结束后才变空闲的连接要反复清理，
        // 否则会一直挂到 keepAliveTimeout（本项目是 65 秒）。
        state = 'closing'
        await Promise.all(servers.map(({ server, closeIdle }) => new Promise(resolve => {
          const sweep = setInterval(closeIdle, 50)
          server.close(() => { clearInterval(sweep); resolve() })
          closeIdle()
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
