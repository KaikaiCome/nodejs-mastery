// 参考实现：Koa 风格的超时中间件
const TIMED_OUT = Symbol('timed out')

export function timeout(ms) {
  return async function timeoutMiddleware(ctx, next) {
    const controller = new AbortController()
    ctx.signal = controller.signal

    let timer
    const timer$ = new Promise((resolve) => {
      timer = setTimeout(resolve, ms, TIMED_OUT)
    })
    const downstream = next()
    // 超时后下游可能才失败，提前挂上 catch 避免 unhandledRejection
    downstream.catch(() => {})

    try {
      const winner = await Promise.race([downstream, timer$])
      if (winner === TIMED_OUT) {
        const reason = new Error(`请求处理超过 ${ms}ms`)
        reason.name = 'TimeoutError'
        controller.abort(reason)
        ctx.status = 504
        ctx.body = { code: 'GATEWAY_TIMEOUT' }
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
