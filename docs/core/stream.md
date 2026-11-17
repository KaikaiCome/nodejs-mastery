# Buffer 与 Stream

## Buffer

- 二进制数据容器，内存在 V8 堆外（`external`）。
- `Buffer.alloc(n)` 安全清零；`Buffer.allocUnsafe(n)` 快但可能含旧数据。
- 字符串拼接 Buffer 时注意多字节字符被截断：用 `StringDecoder` 或 `setEncoding('utf8')`。

## 为什么要 Stream

```js
// ❌ 1GB 文件全部读入内存，并发 10 个就 OOM
app.get('/download', async (req, res) => res.end(await fs.promises.readFile('big.zip')))

// ✅ 常数内存
const { pipeline } = require('node:stream/promises')
app.get('/download', async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'application/zip')
    await pipeline(fs.createReadStream('big.zip'), res)
  } catch (err) { next(err) }
})
```

## 四种流

| 类型 | 例子 |
| --- | --- |
| Readable | `fs.createReadStream`、`req`（服务端） |
| Writable | `fs.createWriteStream`、`res` |
| Duplex | `net.Socket` |
| Transform | `zlib.createGzip()`、自定义转换 |

## 背压（Backpressure）

写入方 `write()` 返回 `false` 表示内部缓冲已满（超过 `highWaterMark`），应等待 `drain`。**`pipeline` 自动处理背压与错误/销毁**，永远优先用它，而不是 `.pipe()`（`.pipe()` 出错时不会销毁其他流，容易泄漏文件句柄）。

```js
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const toUpper = new Transform({
  transform(chunk, enc, cb) { cb(null, chunk.toString().toUpperCase()) }
})
await pipeline(fs.createReadStream('in.txt'), toUpper, zlib.createGzip(), fs.createWriteStream('out.gz'))
```

## BFF 场景：流式透传与 SSE

```js
// 把下游大响应直接流给前端，不在 BFF 缓存
const { Readable } = require('node:stream')
app.get('/proxy/export', async (req, res, next) => {
  try {
    const up = await fetch(EXPORT_URL)
    res.status(up.status).setHeader('content-type', up.headers.get('content-type'))
    await pipeline(Readable.fromWeb(up.body), res)
  } catch (e) { next(e) }
})

// SSE：AI 流式输出、进度推送
app.get('/sse', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const t = setInterval(() => res.write(`data: ${JSON.stringify({ now: Date.now() })}\n\n`), 1000)
  req.on('close', () => clearInterval(t)) // 必须清理，否则泄漏
})
```

## 逐行处理大文件

```js
const readline = require('node:readline')
const rl = readline.createInterface({ input: fs.createReadStream('access.log') })
for await (const line of rl) { /* 统计 */ }
```

## 练习

实现一个上传接口：把 multipart 文件流式写盘并计算 sha256，内存占用保持在常数（提示：`busboy` + `crypto.createHash` 作为 Transform 旁路）。
