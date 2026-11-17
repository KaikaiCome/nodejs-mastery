import { setTimeout as sleep } from 'node:timers/promises'
import { createRouter, createService, HttpError } from '../lib/http.js'

const CATALOG = ['p1', 'p2', 'p3', 'p4']

// 模拟一个“不稳定的非核心依赖”：可调延迟和失败率，用来练习超时与降级
export function createRecServer({ logger, metrics, lifecycle, settings = { latencyMs: 0, failRate: 0 }, random = Math.random }) {
  const router = createRouter().add('GET', '/recommendations', async ({ url }) => {
    if (settings.latencyMs > 0) await sleep(settings.latencyMs)
    if (random() < settings.failRate) throw new HttpError(503, 'REC_UNAVAILABLE', 'recommendation engine overloaded', { expose: true })
    const userId = url.searchParams.get('userId') ?? ''
    const offset = [...userId].reduce((n, c) => n + c.charCodeAt(0), 0) % CATALOG.length
    return { items: [0, 1].map(i => ({ productId: CATALOG[(offset + i) % CATALOG.length], reason: '看过类似商品的人也买了' })) }
  })
  return createService({ name: 'rec-service', router, logger, metrics, isReady: lifecycle?.isReady, isShuttingDown: lifecycle?.isShuttingDown })
}
