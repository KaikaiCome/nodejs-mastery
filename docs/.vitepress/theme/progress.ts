// 章节页面 → 对应的自动判分实验（labs/<name>）
export const LABS: Record<string, string> = {
  '/core/async': 'async-control',
  '/core/event-loop': 'event-loop-yield',
  '/core/stream': 'stream-upload',
  '/core/http': 'http-server',
  '/framework/koa': 'koa-timeout',
  '/engineering/database': 'cache-singleflight',
  '/bff/resilience': 'resilient-call',
  '/core/process': 'graceful-shutdown',
  '/engineering/security': 'security'
}

export const READ_KEY = 'nodejs-mastery-progress'
export const LAB_KEY = 'nodejs-mastery-labs'

export function load(key: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

export function toggle(key: string, id: string) {
  const data = load(key)
  if (data[id]) delete data[id]
  else data[id] = Date.now()
  localStorage.setItem(key, JSON.stringify(data))
}
