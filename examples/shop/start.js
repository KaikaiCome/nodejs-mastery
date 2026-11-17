import { fileURLToPath } from 'node:url'
import { startStack, DEFAULT_PORTS } from './stack.js'

const env = process.env
const serviceToken = env.SERVICE_TOKEN ?? 'dev-service-token'
if (env.NODE_ENV === 'production' && serviceToken === 'dev-service-token') {
  console.error('拒绝启动：生产环境必须设置 SERVICE_TOKEN')
  process.exit(1)
}

const stack = await startStack({
  dataDir: env.SHOP_DATA_DIR ?? fileURLToPath(new URL('./.data', import.meta.url)),
  ports: {
    bff: Number(env.PORT ?? DEFAULT_PORTS.bff),
    order: Number(env.ORDER_PORT ?? DEFAULT_PORTS.order),
    notification: Number(env.NOTIFICATION_PORT ?? DEFAULT_PORTS.notification),
    rec: Number(env.REC_PORT ?? DEFAULT_PORTS.rec)
  },
  serviceToken,
  logLevel: env.LOG_LEVEL ?? 'info',
  secureCookies: env.NODE_ENV === 'production',
  recSettings: { latencyMs: Number(env.REC_LATENCY_MS ?? 0), failRate: Number(env.REC_FAIL_RATE ?? 0) },
  drainDelayMs: Number(env.DRAIN_DELAY_MS ?? 0)
})

stack.lifecycle.installSignalHandlers()
console.log(`
Node Shop 已启动
  Web/BFF       ${stack.urls.bff}        （alice / alice123）
  order-service ${stack.urls.order}
  notification  ${stack.urls.notification}
  rec-service   ${stack.urls.rec}
  指标          ${stack.urls.bff}/metrics
试试：REC_LATENCY_MS=500 npm run shop  → 首页推荐超时降级
`)
