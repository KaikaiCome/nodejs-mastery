# 常见报错速查

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `Error: listen EADDRINUSE :::3000` | 端口被占用（旧进程未退出） | 结束旧进程；检查优雅关闭 |
| `ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent` | 重复响应 | 响应后 `return`；检查 `next()` 后又响应 |
| `ECONNREFUSED` | 下游未启动/地址错误/容器内 `localhost` 指向自身 | 检查服务名、端口、网络 |
| `ECONNRESET` / `socket hang up` | 对端关闭了连接：keepAlive 超时不匹配、下游崩溃、代理超时 | 客户端 keepAliveTimeout < 服务端；重试幂等请求 |
| `ETIMEDOUT` / `UND_ERR_CONNECT_TIMEOUT` | 网络不通、下游过载 | 超时 + 熔断；检查安全组/DNS |
| `UND_ERR_HEADERS_TIMEOUT` | 下游响应头超时 | 调整超时或优化下游 |
| `EMFILE: too many open files` | 句柄泄漏或 ulimit 太低 | 修复泄漏；`ulimit -n` |
| `ENOTFOUND` / `EAI_AGAIN` | DNS 解析失败 | 检查域名、DNS；`dns.lookup` 占用线程池，可加 DNS 缓存（`cacheable-lookup`） |
| `JavaScript heap out of memory` | 堆满 | 排查泄漏；设置合理 `--max-old-space-size` |
| `MaxListenersExceededWarning` | 同一事件监听器 > 10 | 通常是泄漏，检查重复 `on` |
| `UnhandledPromiseRejection` | Promise 未 catch，Node ≥ 15 会退出进程 | 加 `await`/`catch`；Express 4 用 asyncHandler |
| `ERR_REQUIRE_ESM` | `require()` 了纯 ESM 包 | 改用 ESM / 动态 `import()` / 升级 Node 22+ |
| `ERR_MODULE_NOT_FOUND`（ESM） | ESM 导入相对路径缺扩展名 | 写 `./a.js`（TS 中也写 `.js`） |
| `Cannot use import statement outside a module` | 未声明 `"type": "module"` | 修改 package.json 或改 `.mjs` |
| `self signed certificate` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | 内部 CA 证书 | `NODE_EXTRA_CA_CERTS=ca.pem`，**不要**设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| `413 Payload Too Large` | body 超过限制 | 调整 `limit` 或改为直传对象存储 |
| `PayloadTooLargeError`/`request aborted` | 客户端中途断开 | 一般可忽略，降级为 debug 日志 |
| 502 Bad Gateway（偶发） | keepAliveTimeout < LB 空闲超时；发版时未优雅关闭 | `keepAliveTimeout=65s`；preStop + SIGTERM 处理 |
| 504 Gateway Timeout | 处理时间超过网关超时 | 优化/异步化；对齐超时链路 |
| `Too many connections`（MySQL） | 实例数 × 池大小过大，或连接未释放 | 计算池大小；`finally release` |
| `ERR_STREAM_PREMATURE_CLOSE` | 流在完成前被关闭（客户端断开） | 使用 `pipeline` 并正确处理错误 |
| `Error: write EPIPE` | 向已关闭的连接写数据 | 写之前检查 `res.writableEnded`/监听 `close` |
| 时间差 8 小时 | 时区：DB/容器为 UTC | 存储一律 UTC，展示层转换；设置 `TZ` |
| 金额精度错误 `0.1+0.2` | 浮点数 | 以“分”为整数存储，或 `decimal.js` |
| 大整数 ID 精度丢失 | 超过 `2^53` 的 ID 被 `JSON.parse` 截断 | 下游以字符串返回 ID；BFF 中转为字符串 |

## 疑难案例

### 案例 1：发版时总有少量 502

**根因**：Pod 收到 SIGTERM 后立即退出，但 Endpoint 摘除有延迟，仍有流量进入。
**修复**：`preStop sleep 5` + 处理 SIGTERM（停止接收新连接、等待在途请求完成）+ `terminationGracePeriodSeconds` 大于关闭耗时。

### 案例 2：压测时 BFF P99 很高，但下游都很快

**根因**：未复用连接，每次请求新建 TCP + TLS；或 undici 每 origin 连接数不足，请求在本地排队。
**修复**：配置全局 Agent 连接池；观察 `pool queued` 指标。

### 案例 3：服务运行几天后变慢，重启恢复

**根因**：内存泄漏导致 GC 频繁（GC 占用 CPU），最终 OOM。
**修复**：[内存泄漏排查](./memory-cpu)。

### 案例 4：加密接口在高峰期全部变慢

**根因**：`bcrypt`/`pbkdf2` 使用 libuv 线程池（默认 4），与 `fs`、`dns.lookup` 争抢线程。
**修复**：`UV_THREADPOOL_SIZE=16`；DNS 缓存；把密码哈希拆到独立服务。

### 案例 5：一个用户看到了另一个用户的数据

**根因**：进程内缓存 key 没有包含 userId，或 DataLoader/SSR store 被定义在模块级跨请求共享。
**修复**：请求级对象每请求创建；缓存 key 显式包含用户维度；增加跨用户数据隔离测试。
