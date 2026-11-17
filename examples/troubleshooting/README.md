# 排障练习

```bash
node --inspect examples/troubleshooting/server.js
```

## 练习步骤

1. 打开 `chrome://inspect` → 选择进程 → Memory → 拍快照 A。
2. 执行 20 次 `curl "http://localhost:3001/leak?n=1000"`，拍快照 B；再执行 20 次，拍快照 C。
3. 在快照 C 选择 Comparison（对比 B），按 Size Delta 排序，查看 `Object`/`Closure` 的 Retainers。
4. 另开终端循环请求 `/ping`，同时请求 `/block?ms=3000`，观察 `/ping` 被卡住；访问 `/stats` 查看事件循环延迟。
5. Performance 面板录制 CPU profile，找到 `blockFor`。

## 答案

| 问题 | 修复 |
| --- | --- |
| `requestCache` 无界增长，且保存了整个 headers | 使用 LRU（max + ttl），只保存需要的字段 |
| 每次请求 `bus.on('tick')` 且不移除 | 监听器在模块初始化时注册一次；请求级监听在请求结束时 `off` |
| `blockFor` 同步忙等阻塞事件循环 | 改为异步（`await setTimeout(ms)`）或移到 worker_threads |
| `setMaxListeners(0)` 掩盖告警 | 移除；把 `MaxListenersExceededWarning` 视为泄漏信号 |
