# 内存泄漏与 CPU 飙高

## 内存泄漏

### 常见泄漏源

| 泄漏源 | 示例 | 修复 |
| --- | --- | --- |
| 无界缓存 | 模块级 `const cache = {}` 不断写入 | `lru-cache` 设 max/ttl |
| 事件监听未移除 | 每个请求 `emitter.on(...)` | `once`/`off`；注意 `MaxListenersExceededWarning` |
| 定时器未清除 | SSE/WebSocket 断开后 `setInterval` 仍在 | `close` 时清理 |
| 闭包持有大对象 | 回调引用了整个 `req` | 只保存需要的字段 |
| 请求级数据挂到全局 | SSR 中模块级 store | 每请求创建 |
| 未消费的响应体 | `await fetch()` 不读 body | 读取或 `res.body.cancel()`/`dump()` |
| Promise 永不 settle | 无超时的请求堆积 | 一切加超时 |
| 第三方库 | 老版本 agent、ORM 缓存 | 升级/替换 |

### 示例：一个真实的泄漏

```js
const subscribers = new EventEmitter()
app.get('/events', (req, res) => {
  const onMsg = (m) => res.write(`data: ${m}\n\n`)
  subscribers.on('msg', onMsg)
  // ❌ 缺少：req.on('close', () => subscribers.off('msg', onMsg))
})
```

### 定位步骤

1. **确认是泄漏**：`heapUsed` 在稳定负载下持续上升且 GC 后不回落（区分正常的缓存预热）。区分堆内（heapUsed）与堆外（external/arrayBuffers：Buffer 泄漏）。
2. **三次快照法**：启动 → 压测 → 快照 A → 继续压测 → 快照 B → 快照 C。
3. Chrome DevTools → Memory → 加载快照 → 选择 **Comparison** 视图，按 `# Delta` / `Size Delta` 排序。
4. 找持续增长的构造函数（如 `Closure`、`Array`、自定义类），查看 **Retainers** 引用链，找到根（全局变量/模块变量/监听器）。
5. 修复后再压测验证曲线平稳。

```bash
node --inspect app.js           # 本地：chrome://inspect
node --heapsnapshot-signal=SIGUSR2 app.js && kill -USR2 <pid>
```

### OOM 现象

- `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`：V8 堆满。
- 容器被 `OOMKilled`（exit code 137）但无上述日志：RSS 超过 limit，常因未设置 `--max-old-space-size` 或堆外内存泄漏。

## CPU 飙高 / 事件循环阻塞

### 常见原因

- 同步 API：`fs.readFileSync`、`crypto.pbkdf2Sync`、`zlib.gzipSync`。
- 大 JSON `JSON.parse/stringify`（几十 MB）。
- 灾难性正则回溯（ReDoS）。
- 大数组排序/深拷贝/循环中低效算法（O(n²)）。
- SSR `renderToString` 渲染巨型页面。
- 日志过多（同步写、序列化大对象）。
- GC 压力：短时间分配大量对象（看 `--trace-gc`）。

### 定位：CPU Profile + 火焰图

```bash
node --cpu-prof app.js          # 退出时生成 .cpuprofile，用 DevTools Performance 打开
npx clinic flame -- node app.js # 自动压测前后生成火焰图
npx 0x app.js
```

火焰图看法：横轴是采样占比（越宽越耗时），纵轴是调用栈；找**顶部宽平台**——那是自身耗时最高的函数。

### 修复

- 异步化 / 流式化；
- CPU 任务移到 `worker_threads`（piscina）或独立服务；
- 缓存计算结果；
- 分片执行，让出事件循环；
- 限制输入规模（分页、body 大小、正则输入长度）。

## 句柄 / 连接泄漏

- `EMFILE: too many open files`：文件/socket 未关闭，`lsof -p <pid> | wc -l` 查看。
- 大量 `CLOSE_WAIT`：本端未关闭连接（代码未消费/销毁响应流）。
- 大量 `TIME_WAIT`：短连接过多，开启 keepAlive 复用连接。
- 连接池耗尽：事务未提交/连接未释放（`finally { conn.release() }`）。

## 练习

运行 `examples/troubleshooting`：其中包含故意的内存泄漏和事件循环阻塞接口，按本章步骤定位并修复。
