#!/usr/bin/env node
// 实验运行器：node labs/run.js --list | <name> [--solution] | --all [--solution]
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const LABS = [
  ['async-control', '异步流程控制：retry / pTimeout / mapLimit'],
  ['event-loop-yield', '事件循环让步：分片处理大任务，避免阻塞'],
  ['stream-upload', '流式上传：限制大小、计算哈希、失败清理'],
  ['http-server', '原生 HTTP 服务：路由、JSON、错误码与超时配置'],
  ['koa-timeout', 'Koa 超时中间件：AbortSignal + 504'],
  ['cache-singleflight', '缓存与 single-flight：防击穿、防穿透'],
  ['resilient-call', '弹性调用：deadline、单次超时与幂等重试'],
  ['graceful-shutdown', '优雅停机：排空请求、关闭 keep-alive、强制退出兜底'],
  ['security', '安全防护：原型链污染与 SSRF 校验'],
]

const labsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const useSolution = args.includes('--solution')
const positional = args.filter((a) => !a.startsWith('--'))

function printList() {
  console.log('可用实验：')
  for (const [name, title] of LABS) console.log(`  ${name.padEnd(20)} ${title}`)
}

function runLab(name, solution) {
  const file = path.join(labsDir, name, `${name}.test.js`)
  if (!existsSync(file)) {
    console.error(`找不到测试文件：${file}`)
    return 1
  }
  const env = { ...process.env }
  if (solution) env.LAB_TARGET = 'solution'
  else delete env.LAB_TARGET
  const result = spawnSync(process.execPath, ['--test', file], { stdio: 'inherit', env })
  if (result.error) {
    console.error(result.error)
    return 1
  }
  return result.status ?? 1
}

if (args.includes('--list') || args.length === 0) {
  printList()
  console.log('\n用法：node labs/run.js <name> [--solution] | --all [--solution]')
  process.exit(0)
}

if (args.includes('--all')) {
  const results = LABS.map(([name]) => {
    console.log(`\n========== ${name} (${useSolution ? 'solution' : 'starter'}) ==========`)
    return [name, runLab(name, useSolution)]
  })
  console.log('\n汇总：')
  for (const [name, code] of results) console.log(`  ${code === 0 ? '✔' : '✖'} ${name}`)
  const failed = results.filter(([, code]) => code !== 0).length
  console.log(`\n${results.length - failed}/${results.length} 个实验通过`)
  process.exit(failed ? 1 : 0)
}

const name = positional[0]
if (!LABS.some(([n]) => n === name)) {
  console.error(`未知实验：${name}\n`)
  printList()
  process.exit(1)
}

const code = runLab(name, useSolution)
if (code === 0) {
  console.log('\n✅ 实验通过，可以在课程页面勾选“实验已通过”')
} else {
  console.log(`\n❌ 还没通过：阅读 labs/${name}/README.md，修改 starter.js 后重试`)
}
process.exit(code)
