import { AsyncLocalStorage } from 'node:async_hooks'

// 请求上下文：让日志、下游调用自动带上 requestId，而不必层层传参
export const requestContext = new AsyncLocalStorage()

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

export function createLogger({ service, level = process.env.LOG_LEVEL ?? 'info', write = line => process.stdout.write(line + '\n') } = {}) {
  const min = LEVELS[level] ?? LEVELS.info
  const emit = lvl => (msg, fields = {}) => {
    if (LEVELS[lvl] < min) return
    const { err, ...rest } = fields
    const entry = { time: new Date().toISOString(), level: lvl, service, msg, requestId: requestContext.getStore()?.requestId, ...rest }
    if (err) entry.err = { name: err.name, message: err.message, code: err.code, stack: err.stack }
    write(JSON.stringify(entry))
  }
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }
}

export const silentLogger = createLogger({ level: 'silent' })
