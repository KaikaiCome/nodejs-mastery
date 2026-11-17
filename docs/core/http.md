# HTTP 与网络

## 原生 HTTP 服务器

框架都是对它的封装，必须会：

```js
const http = require('node:http')
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (req.method === 'POST' && url.pathname === '/echo') {
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(body)
  }
  res.statusCode = 404
  res.end('Not Found')
})
server.listen(3000)
```

## 关键超时参数（线上 502 的根源）

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| `server.keepAliveTimeout` | 5s | 空闲长连接多久关闭 |
| `server.headersTimeout` | 60s | 接收请求头的最长时间 |
| `server.requestTimeout` | 300s | 接收整个请求的最长时间 |

::: danger 经典 502
负载均衡（如 AWS ALB 默认 60s、Nginx upstream keepalive）复用到 Node 的长连接，若 **Node 的 keepAliveTimeout 小于 LB 的空闲超时**，Node 先关闭连接，LB 恰好在此时发请求 → `502/ECONNRESET`。
**修复**：`server.keepAliveTimeout = 65_000; server.headersTimeout = 66_000;`（大于 LB 超时）。
:::

## 作为客户端：连接池

BFF 大量调用下游，必须复用连接：

```js
// Node 18+ 全局 fetch 基于 undici
const { Agent, setGlobalDispatcher } = require('undici')
setGlobalDispatcher(new Agent({
  connections: 100,          // 每个 origin 最大连接
  keepAliveTimeout: 4_000,   // 小于下游服务的 keepAliveTimeout
  connect: { timeout: 2_000 }
}))
```

使用 `http.request` 时：`new http.Agent({ keepAlive: true, maxSockets: 100 })`。Node ≥ 19 默认 globalAgent 已开启 keepAlive。

## HTTP 语义速记（后端必须遵守）

- `GET` 安全幂等；`PUT/DELETE` 幂等；`POST` 非幂等（需要幂等键）。
- 状态码：`400` 参数错、`401` 未认证、`403` 无权限、`404`、`409` 冲突、`422` 语义错误、`429` 限流、`500` 内部错、`502` 网关收到坏响应、`503` 不可用、`504` 网关超时。
- 缓存：`Cache-Control`、`ETag` / `If-None-Match`、`Vary`。
- CORS：预检请求 `OPTIONS`、`Access-Control-Allow-Credentials` 不能与 `*` 同用。

## HTTP/2、HTTPS、WebSocket

- `node:http2` 支持多路复用，通常由网关（Nginx/Envoy）终止 TLS 与 HTTP/2，Node 内部走 HTTP/1.1。
- WebSocket 用 `ws` 或 `socket.io`；多实例部署需要 Redis adapter 广播与粘性会话。

## 练习

1. 不用框架实现：路由表、JSON body 解析（含 1MB 限制返回 413）、404。
2. 本地用 Nginx 反向代理 Node，设置 Node `keepAliveTimeout=1000`、Nginx `keepalive_timeout 60s`，压测复现 502，再修复。
