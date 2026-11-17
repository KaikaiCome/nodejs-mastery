// 参考实现：分片处理 + 让出事件循环

const defaultYield = () => new Promise((resolve) => setImmediate(resolve))

export async function processInChunks(items, fn, { chunkSize = 1000, yieldFn = defaultYield } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('chunkSize 必须是 >= 1 的整数')
  }
  const results = new Array(items.length)
  for (let start = 0; start < items.length; start += chunkSize) {
    // 只在两个分片之间让步，第一个分片前和最后一个分片后都不需要
    if (start > 0) await yieldFn()
    const end = Math.min(start + chunkSize, items.length)
    for (let i = start; i < end; i++) results[i] = fn(items[i], i)
  }
  return results
}
