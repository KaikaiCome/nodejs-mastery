// 实验：Koa 超时中间件
// 目标：实现 timeout(ms)，详见同目录 README.md

/**
 * @param {number} ms 超时时间
 * @returns {(ctx: object, next: () => Promise<void>) => Promise<void>}
 */
export function timeout(ms) {
  return async function timeoutMiddleware(ctx, next) {
    // TODO: 创建 AbortController，把 signal 挂到 ctx.signal 上供下游使用
    // TODO: 让 next() 与一个 ms 毫秒的定时器赛跑
    // TODO: 超时：abort signal，并设置 ctx.status = 504、ctx.body = { code: 'GATEWAY_TIMEOUT' }
    // TODO: 无论成功、失败还是超时，都要清除定时器；下游的错误要原样抛出
    throw new Error('TODO: 实现 timeout 中间件')
  }
}
