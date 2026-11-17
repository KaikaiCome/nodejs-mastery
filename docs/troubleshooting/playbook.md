# 故障排查手册

## 通用排查流程

```
1. 止血 —— 先恢复服务：回滚 / 扩容 / 降级 / 限流 / 重启（保留现场！）
2. 定界 —— 是 Node 自身？下游？网络？数据库？哪个版本开始？
3. 定位 —— 日志、指标、追踪、Profiling、Dump
4. 修复 —— 修改 + 验证 + 压测
5. 复盘 —— 时间线、根因、改进项（监控、预案、代码规范）
```

::: tip 重启前保留现场
先摘流量，再抓 heap snapshot / CPU profile / `kill -USR1` 打开 inspector，或至少保存日志与指标截图。
:::

## 症状 → 方向速查

| 症状 | 优先检查 |
| --- | --- |
| 所有接口变慢，CPU 高 | 事件循环阻塞：CPU profile、同步代码、大 JSON、正则 |
| 所有接口变慢，CPU 低 | 等待下游/连接池耗尽/DB 慢查询；看追踪与连接池指标 |
| 部分接口慢 | 该接口的下游，追踪瀑布图 |
| 内存持续上涨直至重启 | 内存泄漏：heap snapshot 对比 |
| 间歇性 502 | keepAliveTimeout、Pod 重启、优雅关闭不当 |
| 504 | 网关超时 < 实际处理时间；下游慢 |
| 偶发 ECONNRESET | 连接复用到被对端关闭的连接；客户端 keepAlive 超时 > 服务端 |
| 进程频繁重启 | OOMKilled（`kubectl describe pod`）、未捕获异常、liveness 探针失败 |
| 发版后出错 | 对比版本差异、配置差异、依赖升级（lockfile） |

## 工具箱

| 工具 | 用途 |
| --- | --- |
| `node --inspect` + Chrome DevTools | 调试、CPU profile、heap snapshot |
| `node --cpu-prof` / `--heap-prof` | 生成 profile 文件 |
| `node --heapsnapshot-signal=SIGUSR2` | 发信号即导出堆快照 |
| `v8.writeHeapSnapshot()` | 代码中导出（可做成受保护的管理接口） |
| clinic.js（doctor/flame/bubbleprof） | 自动诊断、火焰图 |
| 0x | 火焰图 |
| `process.report.writeReport()` / `--report-on-fatalerror` | 诊断报告：堆栈、句柄、资源 |
| `why-is-node-running` | 进程为何不退出 |
| autocannon / k6 | 压测复现 |
| `lsof -p`、`ss -s`、`netstat` | 文件句柄、连接状态（TIME_WAIT/CLOSE_WAIT） |

## 线上诊断开关示例

```ts
// 仅内网 + 鉴权可访问
admin.post('/debug/heapdump', requireAdmin, (req, res) => {
  const file = v8.writeHeapSnapshot(`/tmp/heap-${Date.now()}.heapsnapshot`)
  res.json({ file })
})
admin.post('/debug/profile', requireAdmin, async (req, res) => {
  const session = new inspector.Session(); session.connect()
  session.post('Profiler.enable'); session.post('Profiler.start')
  await sleep(30_000)
  session.post('Profiler.stop', (err, { profile }) => {
    fs.writeFileSync(`/tmp/${Date.now()}.cpuprofile`, JSON.stringify(profile))
    res.json({ ok: true })
  })
})
```

::: warning
写堆快照会**阻塞进程**且需要约 2 倍堆内存，务必先摘流量。
:::

## 下一步

- [内存泄漏与 CPU 飙高](./memory-cpu)
- [常见报错速查](./errors)
