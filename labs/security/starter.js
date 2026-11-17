// 实验：安全防护（原型链污染 + SSRF）
// 目标：实现 safeMerge 与 isAllowedUrl，详见同目录 README.md

/**
 * 深度合并 source 到 target（会修改并返回 target），必须免疫原型链污染。
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
export function safeMerge(target, source) {
  // TODO: 遍历 source 自身的可枚举 key
  // TODO: 跳过 '__proto__'、'constructor'、'prototype'
  // TODO: 值是普通对象时递归合并，否则直接赋值
  throw new Error('TODO: 实现 safeMerge')
}

/**
 * SSRF 防护：判断服务端是否可以请求该 URL。
 * @param {string} urlString
 * @param {{ allowedHosts: string[] }} options 例如 ['api.example.com', 'files.example.com:8443']
 * @returns {boolean}
 */
export function isAllowedUrl(urlString, { allowedHosts = [] } = {}) {
  // TODO: 用 new URL() 解析（解析失败返回 false），不要用正则或 includes 匹配字符串
  // TODO: 只允许 http: / https:，拒绝带用户名密码的 URL
  // TODO: 拒绝私有、回环、链路本地等 IP 字面量（即使出现在白名单里）
  // TODO: 主机（含非默认端口）必须与白名单中某一项完全相等
  throw new Error('TODO: 实现 isAllowedUrl')
}
