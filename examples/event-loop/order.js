// 运行：node examples/event-loop/order.js
// 注意：本文件是 ESM，promise 会先于 nextTick 输出（CJS 中则相反），原因见 docs/core/event-loop.md
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

console.log('1 sync start')

setTimeout(() => console.log('timers: setTimeout 0'), 0)
setImmediate(() => console.log('check: setImmediate'))
process.nextTick(() => console.log('microtask: nextTick'))
Promise.resolve().then(() => console.log('microtask: promise'))

fs.readFile(fileURLToPath(import.meta.url), () => {
  console.log('poll: readFile callback')
  setTimeout(() => console.log('  inside I/O -> setTimeout (always after immediate)'), 0)
  setImmediate(() => console.log('  inside I/O -> setImmediate (always first)'))
})

console.log('2 sync end')
