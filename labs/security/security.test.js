import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

// 防止错误实现污染原型后影响其他用例
afterEach(() => {
  delete Object.prototype.polluted
})

describe('safeMerge', () => {
  test('深度合并普通对象并返回 target', () => {
    const target = { a: 1, nested: { x: 1, keep: true } }
    const result = lab.safeMerge(target, { b: 2, nested: { x: 2, y: 3 }, list: [1, 2] })
    assert.equal(result, target)
    assert.deepEqual(target, { a: 1, b: 2, nested: { x: 2, y: 3, keep: true }, list: [1, 2] })
  })

  test('JSON 中的 __proto__ 不会污染 Object.prototype', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"ok":1}')
    const result = lab.safeMerge({}, payload)
    assert.equal({}.polluted, undefined)
    assert.equal(result.ok, 1)
    assert.equal(Object.hasOwn(result, '__proto__'), false)
    assert.equal(Object.getPrototypeOf(result), Object.prototype)
  })

  test('constructor.prototype 载荷不会污染 Object.prototype', () => {
    lab.safeMerge({}, JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'))
    assert.equal({}.polluted, undefined)
  })

  test('嵌套层级中的 __proto__ 同样被忽略', () => {
    const result = lab.safeMerge({ a: {} }, JSON.parse('{"a":{"__proto__":{"polluted":true},"v":1}}'))
    assert.equal({}.polluted, undefined)
    assert.deepEqual(result, { a: { v: 1 } })
  })
})

describe('isAllowedUrl', () => {
  const allowedHosts = ['api.example.com', 'files.example.com:8443', '8.8.8.8']

  test('白名单内的 http/https 地址允许访问（主机名大小写不敏感，默认端口可写可不写）', () => {
    for (const url of [
      'https://api.example.com/v1/users?id=1',
      'http://api.example.com',
      'https://API.Example.com/x',
      'https://api.example.com:443/x',
      'https://files.example.com:8443/a.png',
      'http://8.8.8.8/dns',
    ]) {
      assert.equal(lab.isAllowedUrl(url, { allowedHosts }), true, url)
    }
  })

  test('拒绝非 http/https 协议与无法解析的字符串', () => {
    for (const url of [
      'ftp://api.example.com/x',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'gopher://api.example.com:70/_',
      'not a url',
      '//api.example.com/x',
      '',
    ]) {
      assert.equal(lab.isAllowedUrl(url, { allowedHosts }), false, url)
    }
  })

  test('拒绝各种主机名伪装技巧', () => {
    for (const url of [
      'https://evil.com?x=api.example.com',
      'https://evil.com/api.example.com',
      'https://evil.com#api.example.com',
      'https://api.example.com.evil.com/',
      'https://evilapi.example.com/',
      'https://sub.api.example.com/',
      'https://api.example.com@evil.com/',
      'https://user:pass@api.example.com/',
      'https://evil.com\\@api.example.com/',
    ]) {
      assert.equal(lab.isAllowedUrl(url, { allowedHosts }), false, url)
    }
  })

  test('非默认端口必须显式列入白名单', () => {
    assert.equal(lab.isAllowedUrl('https://api.example.com:8443/', { allowedHosts }), false)
    assert.equal(lab.isAllowedUrl('http://api.example.com:6379/', { allowedHosts }), false)
    assert.equal(lab.isAllowedUrl('https://files.example.com/a.png', { allowedHosts }), false)
  })

  test('私有/回环/链路本地 IP 即使在白名单中也拒绝', () => {
    const privateHosts = [
      '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '169.254.169.254', '0.0.0.0', '[::1]', '[::ffff:127.0.0.1]', '[fe80::1]', '[fd00::1]',
    ]
    for (const host of privateHosts) {
      assert.equal(lab.isAllowedUrl(`http://${host}/`, { allowedHosts: [...privateHosts, ...allowedHosts] }), false, host)
    }
  })

  test('IP 的变体写法（十进制、十六进制、简写）同样被识别', () => {
    const list = ['127.0.0.1', '2130706433', '0x7f.0.0.1', '127.1', '0177.0.0.1']
    for (const host of ['2130706433', '0x7f.0.0.1', '127.1', '0177.0.0.1']) {
      assert.equal(lab.isAllowedUrl(`http://${host}/`, { allowedHosts: list }), false, host)
    }
  })

  test('公网 IP 不在私有范围内：172.32.0.1 / 11.0.0.1 只要在白名单就允许', () => {
    assert.equal(lab.isAllowedUrl('http://172.32.0.1/', { allowedHosts: ['172.32.0.1'] }), true)
    assert.equal(lab.isAllowedUrl('http://11.0.0.1/', { allowedHosts: ['11.0.0.1'] }), true)
  })
})
