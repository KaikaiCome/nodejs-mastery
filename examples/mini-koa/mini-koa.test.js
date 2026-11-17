import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose } from './compose.js'
import { MiniKoa } from './mini-koa.js'

test('compose runs middleware in onion order', async () => {
  const log = []
  await compose([
    async (ctx, next) => { log.push(1); await next(); log.push(6) },
    async (ctx, next) => { log.push(2); await next(); log.push(5) },
    async (ctx, next) => { log.push(3); await next(); log.push(4) }
  ])({})
  assert.deepEqual(log, [1, 2, 3, 4, 5, 6])
})

test('compose rejects when next() is called twice', async () => {
  const fn = compose([async (ctx, next) => { await next(); await next() }])
  await assert.rejects(fn({}), /multiple times/)
})

test('compose propagates sync errors as rejections', async () => {
  const fn = compose([() => { throw new Error('boom') }])
  await assert.rejects(fn({}), /boom/)
})

test('MiniKoa hides internal error messages but exposes 4xx', async () => {
  const app = new MiniKoa()
  app.use(async (ctx) => {
    if (ctx.path === '/bad') ctx.throw(400, 'bad input')
    if (ctx.path === '/crash') throw new Error('secret')
    ctx.body = { ok: true }
  })
  const server = app.listen(0)
  await new Promise(r => server.once('listening', r))
  const base = `http://localhost:${server.address().port}`
  const origError = console.error
  console.error = () => {}
  try {
    const ok = await fetch(`${base}/`)
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { ok: true })

    const bad = await fetch(`${base}/bad`)
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).message, 'bad input')

    const crash = await fetch(`${base}/crash`)
    assert.equal(crash.status, 500)
    assert.equal((await crash.json()).message, 'Internal Server Error')
  } finally {
    console.error = origError
    server.closeAllConnections()
    server.close()
  }
})
