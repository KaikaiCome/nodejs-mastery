// 实验：事件循环让步（分片处理大任务）
// 目标：实现 processInChunks，详见同目录 README.md

const defaultYield = () => new Promise((resolve) => setImmediate(resolve))

/**
 * 把同步的 CPU 工作切成小块处理，块与块之间让出事件循环。
 * @param {any[]} items
 * @param {(item: any, index: number) => any} fn 同步函数
 * @param {{ chunkSize?: number, yieldFn?: () => Promise<void> }} [options]
 * @returns {Promise<any[]>} 与 items 一一对应的结果
 */
export async function processInChunks(items, fn, { chunkSize = 1000, yieldFn = defaultYield } = {}) {
  // TODO: 校验 chunkSize（必须是 >= 1 的整数，否则抛 RangeError）
  // TODO: 每处理完 chunkSize 个元素，await yieldFn() 一次，让定时器、I/O 回调有机会执行
  // 注意：仅仅 `await` 一个已完成的 promise 只会进入微任务队列，并不能让出事件循环！
  throw new Error('TODO: 实现 processInChunks')
}
