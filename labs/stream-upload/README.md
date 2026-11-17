# 实验：stream-upload（流式上传）

## 目标

实现 `saveUpload`：以流的方式把上传内容写入磁盘，同时统计字节数、计算 SHA-256、限制最大体积，并在任何失败时清理半成品文件。

## 背景

把上传文件整个读进内存（`Buffer.concat` 全部 chunk）在小流量下没问题，但几个并发的大文件就能让进程 OOM。流式处理配合 `stream.pipeline` 能自动处理背压：磁盘写得慢时自动暂停读取网络数据。体积限制必须在**流动过程中**检查，而不是写完再看大小，否则攻击者可以用一个超大请求填满磁盘。失败时如果不删除半成品，磁盘上会堆积损坏的文件，后续逻辑还可能误把它们当成有效数据。

## 要实现的接口

```js
saveUpload(source /* Readable */, destPath, { maxBytes = Infinity }) => Promise<{ bytes, sha256 }>
```

- 超限错误：`err.code === 'PAYLOAD_TOO_LARGE'`、`err.status === 413`
- `sha256` 为小写十六进制字符串

## 验收标准

- 小文件：返回正确的 `bytes` 和 `sha256`，磁盘文件内容与输入一致
- 5MB 生成器数据流式写入，`bytes` 与 `sha256` 正确
- 超过 `maxBytes`：以 `PAYLOAD_TOO_LARGE` / 413 拒绝，目标文件被删除，源流被销毁且没有被读完
- 恰好等于 `maxBytes` 时成功
- 源流出错：以原错误拒绝，目标文件被删除

## 提示

1. 用 `node:stream/promises` 中的 `pipeline`，它会在任一环节出错时销毁整条链路上的流。
2. 在 `Transform` 的 `transform(chunk, encoding, callback)` 中用 `callback(err)` 终止整个管道。
3. 删除文件时用 `rm(path, { force: true })`，文件不存在也不会报错。

## 运行命令

```bash
npm run lab -- stream-upload
# 或
node labs/run.js stream-upload
```

## 延伸思考

1. 如果请求带了 `Content-Length` 且已经超过上限，还有必要开始读取请求体吗？
2. 如何做到“要么完整文件出现在最终路径，要么什么都没有”？（提示：先写临时文件再 `rename`）
3. 如果要同时上传到对象存储（如 S3）和计算哈希，背压如何在多个下游之间传递？
