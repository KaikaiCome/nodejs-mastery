// 实验：原生 HTTP 服务
// 目标：实现 createApp，详见同目录 README.md
import http from 'node:http'

/**
 * 创建（但不 listen）一个 node:http Server：
 * - GET  /health → 200 {"ok":true}
 * - POST /echo   → 200 原样返回 JSON 请求体
 * - 请求体 > 1024 字节 → 413 {"code":"PAYLOAD_TOO_LARGE"}
 * - 非法 JSON → 400 {"code":"INVALID_JSON"}
 * - 未知路径 → 404 {"code":"NOT_FOUND"}
 * - 已知路径但方法不对 → 405，带 Allow 响应头
 * @returns {http.Server}
 */
export function createApp() {
  // TODO: 用 http.createServer 创建服务并实现上面的路由
  // TODO: 所有 JSON 响应的 content-type 为 'application/json; charset=utf-8'
  // TODO: 设置 server.keepAliveTimeout = 65000 和 server.headersTimeout = 66000
  throw new Error('TODO: 实现 createApp')
}
