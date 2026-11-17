import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp } from './app.js'
import { UserRepository, UserService } from './user.js'

const newApp = () => createApp({ userService: new UserService(new UserRepository()), logger: {} })

test('creates and fetches a user', async () => {
  const app = newApp()
  const created = await request(app).post('/api/users').send({ email: 'a@b.com', name: 'A' }).expect(201)
  const got = await request(app).get(`/api/users/${created.body.id}`).expect(200)
  assert.equal(got.body.email, 'a@b.com')
})

test('rejects invalid body with 400', async () => {
  const res = await request(newApp()).post('/api/users').send({ email: 'nope' }).expect(400)
  assert.equal(res.body.code, 'VALIDATION_ERROR')
})

test('returns 409 on duplicate email', async () => {
  const app = newApp()
  await request(app).post('/api/users').send({ email: 'a@b.com', name: 'A' }).expect(201)
  const res = await request(app).post('/api/users').send({ email: 'a@b.com', name: 'B' }).expect(409)
  assert.equal(res.body.code, 'CONFLICT')
})

test('async errors reach the error handler (404)', async () => {
  const res = await request(newApp()).get('/api/users/999').expect(404)
  assert.equal(res.body.code, 'NOT_FOUND')
  assert.ok(res.body.requestId)
})
