import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

let dir
before(async () => { dir = await mkdtemp(path.join(tmpdir(), 'lab-stream-upload-')) })
after(async () => { await rm(dir, { recursive: true, force: true }) })

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

test('保存小文件：返回正确的 bytes 与 sha256，文件内容一致', async () => {
  const parts = [Buffer.from('hello '), Buffer.from('stream '), Buffer.from('world')]
  const dest = path.join(dir, 'small.txt')
  const result = await lab.saveUpload(Readable.from(parts), dest, { maxBytes: 1024 })
  const all = Buffer.concat(parts)
  assert.deepEqual(result, { bytes: all.length, sha256: sha256(all) })
  assert.deepEqual(await readFile(dest), all)
})

test('流式处理 5MB 数据（来自生成器），哈希正确', async () => {
  const chunk = Buffer.alloc(64 * 1024)
  const total = 5 * 1024 * 1024
  const expected = createHash('sha256')
  async function* generate() {
    for (let i = 0; i < total / chunk.length; i++) {
      chunk.fill(i % 256)
      expected.update(chunk)
      yield Buffer.from(chunk)
    }
  }
  const dest = path.join(dir, 'big.bin')
  const result = await lab.saveUpload(Readable.from(generate()), dest)
  assert.equal(result.bytes, total)
  assert.equal(result.sha256, expected.digest('hex'))
  assert.equal((await readFile(dest)).length, total)
})

test('超过 maxBytes：以 PAYLOAD_TOO_LARGE / 413 拒绝，删除半成品并停止读取源', async () => {
  let produced = 0
  let sourceClosed = false
  async function* generate() {
    try {
      for (let i = 0; i < 1000; i++) {
        produced++
        yield Buffer.alloc(512, 1)
      }
    } finally {
      sourceClosed = true
    }
  }
  const dest = path.join(dir, 'too-large.bin')
  await assert.rejects(
    lab.saveUpload(Readable.from(generate()), dest, { maxBytes: 1024 }),
    (err) => err.code === 'PAYLOAD_TOO_LARGE' && err.status === 413,
  )
  assert.equal(existsSync(dest), false, '超限后必须删除写了一半的文件')
  assert.ok(sourceClosed, '源流应被销毁')
  assert.ok(produced < 1000, '超限后不应继续读完整个源')
})

test('恰好等于 maxBytes 时成功', async () => {
  const data = Buffer.alloc(1024, 7)
  const dest = path.join(dir, 'exact.bin')
  const result = await lab.saveUpload(Readable.from([data]), dest, { maxBytes: 1024 })
  assert.equal(result.bytes, 1024)
})

test('源流出错：透传错误并删除半成品', async () => {
  const boom = new Error('client disconnected')
  async function* generate() {
    yield Buffer.alloc(4096, 1)
    yield Buffer.alloc(4096, 2)
    throw boom
  }
  const dest = path.join(dir, 'broken.bin')
  await assert.rejects(lab.saveUpload(Readable.from(generate()), dest), (err) => err === boom)
  assert.equal(existsSync(dest), false, '出错后必须删除写了一半的文件')
})
