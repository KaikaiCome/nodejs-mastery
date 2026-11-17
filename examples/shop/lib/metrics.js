import { monitorEventLoopDelay } from 'node:perf_hooks'

// 零依赖的 Prometheus 文本格式指标。生产中使用 prom-client，原理相同。
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]

const escape = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
const labelText = labels => {
  const entries = Object.entries(labels)
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${escape(v)}"`).join(',')}}` : ''
}
const keyOf = labels => JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))

export function createMetrics() {
  const families = new Map()

  function seriesOf(name, labels, init) {
    const f = families.get(name)
    const k = keyOf(labels)
    if (!f.series.has(k)) f.series.set(k, { labels, ...init() })
    return f.series.get(k)
  }

  function counter(name, help) {
    if (!families.has(name)) families.set(name, { name, help, type: 'counter', series: new Map() })
    return {
      inc: (labels = {}, value = 1) => { seriesOf(name, labels, () => ({ value: 0 })).value += value },
      get: (labels = {}) => families.get(name).series.get(keyOf(labels))?.value ?? 0
    }
  }

  function histogram(name, help, buckets = DEFAULT_BUCKETS) {
    if (!families.has(name)) families.set(name, { name, help, type: 'histogram', buckets, series: new Map() })
    return {
      observe: (labels, seconds) => {
        const s = seriesOf(name, labels, () => ({ counts: buckets.map(() => 0), sum: 0, count: 0 }))
        buckets.forEach((le, i) => { if (seconds <= le) s.counts[i]++ })
        s.sum += seconds
        s.count++
      }
    }
  }

  function gauge(name, help, collect) {
    families.set(name, { name, help, type: 'gauge', collect, series: new Map() })
  }

  function render() {
    const lines = []
    for (const f of families.values()) {
      lines.push(`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} ${f.type}`)
      if (f.type === 'gauge') {
        lines.push(`${f.name} ${f.collect()}`)
        continue
      }
      for (const s of f.series.values()) {
        if (f.type === 'counter') {
          lines.push(`${f.name}${labelText(s.labels)} ${s.value}`)
          continue
        }
        f.buckets.forEach((le, i) => lines.push(`${f.name}_bucket${labelText({ ...s.labels, le })} ${s.counts[i]}`))
        lines.push(`${f.name}_bucket${labelText({ ...s.labels, le: '+Inf' })} ${s.count}`)
        lines.push(`${f.name}_sum${labelText(s.labels)} ${s.sum}`, `${f.name}_count${labelText(s.labels)} ${s.count}`)
      }
    }
    return lines.join('\n') + '\n'
  }

  return { counter, histogram, gauge, render }
}

// 运行时指标：事件循环延迟与内存。返回停止函数，便于测试与优雅关闭。
export function registerRuntimeMetrics(metrics) {
  const h = monitorEventLoopDelay({ resolution: 20 })
  h.enable()
  metrics.gauge('nodejs_eventloop_delay_p99_seconds', 'Event loop delay p99 since start', () => h.percentile(99) / 1e9)
  metrics.gauge('process_resident_memory_bytes', 'Resident set size', () => process.memoryUsage.rss())
  metrics.gauge('nodejs_heap_used_bytes', 'V8 heap used', () => process.memoryUsage().heapUsed)
  return () => h.disable()
}
