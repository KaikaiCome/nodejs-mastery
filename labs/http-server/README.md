# 实验：http-server（原生 HTTP 服务）

## 目标

不借助任何框架，用 `node:http` 实现一个带路由、JSON 解析、请求体限制、规范错误码和正确超时配置的小服务。

## 背景

Express、Koa、Fastify 底层都是 `node:http`。理解原生 API 能帮你看懂框架在做什么、出问题时该去哪里找。生产服务必须限制请求体大小，否则一个超大请求就能耗尽内存；错误要以统一的 JSON 结构和正确的状态码返回，方便网关和前端处理；405 必须带 `Allow` 头（RFC 9110 要求）。另外，Node 的 `keepAliveTimeout` 默认只有 5 秒，而云负载均衡器（如 AWS ALB）的空闲超时通常是 60 秒——Node 先关闭连接时，LB 可能恰好往这条连接上转发请求，造成偶发的 502。

## 要实现的接口

```js
createApp() => http.Server   // 只创建，不要 listen
```

| 请求 | 响应 |
| --- | --- |
| `GET /health` | 200 `{"ok":true}` |
| `POST /echo`（JSON 请求体） | 200，原样返回 |
| 请求体 > 1024 字节 | 413 `{"code":"PAYLOAD_TOO_LARGE"}` |
| 请求体不是合法 JSON | 400 `{"code":"INVALID_JSON"}` |
| 未知路径 | 404 `{"code":"NOT_FOUND"}` |
| 已知路径、方法不对 | 405，响应头 `Allow` 列出允许的方法 |

所有 JSON 响应：`content-type: application/json; charset=utf-8`。

## 验收标准

- `createApp()` 返回未监听的 `http.Server`
- `GET /health`（含查询字符串）→ 200 `{ ok: true }`
- `POST /echo` 原样返回 JSON
- 请求体超过 1024 字节（无论有无 `Content-Length`）→ 413
- 非法 JSON → 400 `INVALID_JSON`
- 未知路径 → 404 `NOT_FOUND`
- `GET /echo` → 405 且 `Allow` 含 `POST`；`DELETE /health` → 405 且 `Allow` 含 `GET`
- 所有 JSON 响应的 `content-type` 正确
- `server.keepAliveTimeout === 65000`，`server.headersTimeout === 66000`

## 提示

1. 用 `new URL(req.url, 'http://localhost').pathname` 拿到不含查询字符串的路径。
2. 路由表可以设计成 `{ [path]: { [method]: handler } }`，404 和 405 自然就区分开了。
3. 不能只信任 `Content-Length`：分块传输时没有这个头，要在 `data` 事件中累计字节数。

## 运行命令

```bash
npm run lab -- http-server
# 或
node labs/run.js http-server
```

## 延伸思考

1. 返回 413 之后，客户端剩余的请求体怎么办？直接 `req.destroy()` 和继续排空各有什么代价？
2. 为什么 `headersTimeout` 要比 `keepAliveTimeout` 略大？
3. handler 抛出异常时，如果响应头已经发出，还能返回 500 吗？应该怎么处理？
