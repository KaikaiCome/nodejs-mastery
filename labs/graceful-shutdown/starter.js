// 实验：优雅停机
// 目标：实现 createGracefulServer，详见同目录 README.md
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * @param {http.RequestListener} handler
 * @param {{
 *   onClose?: () => Promise<void>,   // 释放数据库连接池等资源
 *   drainDelayMs?: number,           // 标记未就绪后、停止接收连接前的等待时间
 *   timeoutMs?: number,              // 超过该时间仍未完成则调用 onForceExit
 *   onForceExit?: () => void,
 * }} [options]
 * @returns {{ server: http.Server, shutdown: () => Promise<void>, isReady: () => boolean }}
 */
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

  async function shutdown() {
    // TODO 1: 标记未就绪（isReady() 返回 false），等待 drainDelayMs
    // TODO 2: server.close() 停止接收新连接，并等待在途请求完成
    //         注意：server.close() 只会关闭“此刻空闲”的 keep-alive 连接！
    // TODO 3: 在途请求都结束、server 关闭后，再 await onClose()
    // TODO 4: 启动一个 unref 的强制退出定时器，超过 timeoutMs 调用 onForceExit()
    // TODO 5: 多次调用 shutdown() 应返回同一个 promise
    throw new Error('TODO: 实现 shutdown')
  }

  return { server, shutdown, isReady: () => ready }
}
