// 模拟三个下游服务：用户（稳定）、订单（稳定）、推荐（随机慢/失败）
import http from 'node:http'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

export function startUpstreams({ recFailRate = 0.3, recSlowRate = 0.2, recSlowMs = 1500 } = {}) {
  const users = http.createServer((req, res) => {
    const id = req.url.split('/').pop()
    if (id === '404') return json(res, 404, { message: 'user not found' })
    json(res, 200, { id, nickname: `user-${id}`, avatar: `https://i.pravatar.cc/80?u=${id}`, email: `u${id}@corp.com`, passwordHash: 'should-never-reach-frontend', createdAt: '2024-01-01' })
  })

  const orders = http.createServer(async (req, res) => {
    await sleep(30)
    json(res, 200, [
      { id: 'o1', amountCents: 12990, status: 'PAID', productId: 'p1' },
      { id: 'o2', amountCents: 5900, status: 'SHIPPED', productId: 'p2' }
    ])
  })

  const rec = http.createServer(async (req, res) => {
    const r = Math.random()
    if (r < recFailRate) return json(res, 500, { message: 'rec engine error' })
    if (r < recFailRate + recSlowRate) await sleep(recSlowMs)
    json(res, 200, [{ id: 'p9', name: 'Mechanical Keyboard', priceCents: 39900 }, { id: 'p7', name: 'USB-C Hub', priceCents: 12900 }])
  })

  const servers = [users, orders, rec]
  servers.forEach(s => s.listen(0))
  const url = s => `http://127.0.0.1:${s.address().port}`
  return {
    urls: { users: url(users), orders: url(orders), rec: url(rec) },
    close: () => servers.forEach(s => { s.closeAllConnections(); s.close() })
  }
}
