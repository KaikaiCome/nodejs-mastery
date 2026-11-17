import { test } from 'node:test'
import assert from 'node:assert/strict'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

const items = Array.from({ length: 10_000 }, (_, i) => i)

test('结果正确且与输入顺序一一对应，fn 收到 (item, index)', async () => {
  const result = await lab.processInChunks(['a', 'b', 'c'], (x, i) => `${i}${x}`, { chunkSize: 2 })
  assert.deepEqual(result, ['0a', '1b', '2c'])
})

test('处理过程中让出事件循环：提前排队的 setTimeout(0) 在中途执行', async () => {
  let processed = 0
  let processedWhenTimerFired = -1
  setTimeout(() => { processedWhenTimerFired = processed }, 0)
  const result = await lab.processInChunks(
    items,
    (x) => { processed++; return x * 2 },
    { chunkSize: 500, yieldFn: () => new Promise((resolve) => setTimeout(resolve, 0)) },
  )
  assert.equal(result.length, items.length)
  assert.equal(result[9_999], 19_998)
  assert.ok(processedWhenTimerFired > 0, '定时器应在处理开始后才触发')
  assert.ok(processedWhenTimerFired < items.length, `定时器应在处理完成前触发（实际在 ${processedWhenTimerFired} 时触发）`)
  assert.equal(processedWhenTimerFired % 500, 0, '让步应发生在分片边界')
})

test('默认 yieldFn 使用 setImmediate：提前排队的 setImmediate 在中途执行', async () => {
  let processed = 0
  let processedWhenImmediateFired = -1
  setImmediate(() => { processedWhenImmediateFired = processed })
  const result = await lab.processInChunks(items, (x) => { processed++; return x + 1 }, { chunkSize: 500 })
  assert.equal(result[0], 1)
  assert.equal(result[9_999], 10_000)
  assert.ok(processedWhenImmediateFired > 0 && processedWhenImmediateFired < items.length)
})

test('只在分片之间让步：10000 项 / 500 每片 = 让步 19 次', async () => {
  let yields = 0
  await lab.processInChunks(items, (x) => x, {
    chunkSize: 500,
    yieldFn: async () => { yields++ },
  })
  assert.equal(yields, 19)
})

test('空数组返回 []，且不调用 yieldFn', async () => {
  let yields = 0
  assert.deepEqual(await lab.processInChunks([], (x) => x, { yieldFn: async () => { yields++ } }), [])
  assert.equal(yields, 0)
})

test('非法 chunkSize 抛出 RangeError', async () => {
  await assert.rejects(lab.processInChunks([1], (x) => x, { chunkSize: 0 }), RangeError)
})

test('fn 抛错时 promise reject', async () => {
  await assert.rejects(
    lab.processInChunks(items, (x) => { if (x === 1234) throw new Error('bad item'); return x }, { chunkSize: 500 }),
    /bad item/,
  )
})
