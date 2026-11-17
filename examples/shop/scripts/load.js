// 零依赖压测：node examples/shop/scripts/load.js [url] [并发] [秒数]
// 先启动 npm run shop。生产压测建议使用 autocannon / k6，原理相同。
const [base = 'http://127.0.0.1:4000', concurrencyArg = '20', secondsArg = '10'] = process.argv.slice(2)
const concurrency = Number(concurrencyArg)
const seconds = Number(secondsArg)
const path = '/bff/pages/home'

const login = await fetch(`${base}/bff/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ username: 'alice', password: 'alice123' })
})
if (!login.ok) throw new Error(`login failed: ${login.status}`)
const cookie = login.headers.get('set-cookie').split(';')[0]

const latencies = []
const statuses = new Map()
const end = performance.now() + seconds * 1000

async function worker() {
  while (performance.now() < end) {
    const start = performance.now()
    let status = 'ERR'
    try {
      const res = await fetch(base + path, { headers: { cookie } })
      await res.arrayBuffer()
      status = res.status
    } catch {}
    latencies.push(performance.now() - start)
    statuses.set(status, (statuses.get(status) ?? 0) + 1)
  }
}

await Promise.all(Array.from({ length: concurrency }, worker))
latencies.sort((a, b) => a - b)
const pct = p => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))].toFixed(1)
console.log(`GET ${path}  并发 ${concurrency}  持续 ${seconds}s`)
console.log(`请求 ${latencies.length}  RPS ${(latencies.length / seconds).toFixed(0)}`)
console.log(`延迟 p50 ${pct(0.5)}ms  p95 ${pct(0.95)}ms  p99 ${pct(0.99)}ms`)
console.log('状态码', Object.fromEntries(statuses))
