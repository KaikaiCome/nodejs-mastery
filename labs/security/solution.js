// 参考实现：原型链污染防护 + SSRF 校验
import net from 'node:net'

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function safeMerge(target, source) {
  if (!isPlainObject(source)) return target
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    const value = source[key]
    if (isPlainObject(value)) {
      // 只复用 target 自身的属性，绝不沿原型链往上找
      const existing = Object.hasOwn(target, key) ? target[key] : undefined
      target[key] = safeMerge(isPlainObject(existing) ? existing : {}, value)
    } else if (Array.isArray(value)) {
      target[key] = value.slice()
    } else {
      target[key] = value
    }
  }
  return target
}

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 回环
    (a === 169 && b === 254) || // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  )
}

function isPrivateIPv6(ip) {
  const addr = ip.toLowerCase()
  if (addr === '::' || addr === '::1') return true
  if (/^f[cd]/.test(addr)) return true // fc00::/7 唯一本地地址
  if (/^fe[89ab]/.test(addr)) return true // fe80::/10 链路本地
  // IPv4 映射地址，WHATWG URL 会规范化为 ::ffff:7f00:1 这种十六进制形式
  const mapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mapped) {
    const hi = parseInt(mapped[1], 16)
    const lo = parseInt(mapped[2], 16)
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  const dotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return isPrivateIPv4(dotted[1])
  return false
}

export function isAllowedUrl(urlString, { allowedHosts = [] } = {}) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false

  // URL 解析器已把 0x7f.1、2130706433 等写法规范化为点分十进制
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIPv4(hostname) && isPrivateIPv4(hostname)) return false
  if (net.isIPv6(hostname) && isPrivateIPv6(hostname)) return false

  // url.host 已去掉默认端口，所以 https://a.com:443 与 "a.com" 匹配；非默认端口必须显式列出
  const host = url.host.toLowerCase()
  return allowedHosts.some((entry) => entry.toLowerCase() === host)
}
