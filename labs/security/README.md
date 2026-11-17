# 实验：security（原型链污染与 SSRF 防护）

## 目标

实现两个常见的安全防护函数：免疫原型链污染的深度合并 `safeMerge`，以及防御 SSRF 的 URL 白名单校验 `isAllowedUrl`。

## 背景

**原型链污染**：很多服务会把请求体 JSON 深度合并到配置或默认值里。`JSON.parse('{"__proto__":{"isAdmin":true}}')` 会产生一个自有属性名为 `__proto__` 的对象，朴素的递归合并会顺着 `target.__proto__` 写到 `Object.prototype` 上——从此进程里**所有**对象都有了 `isAdmin: true`，可能导致权限绕过甚至 RCE（lodash、jQuery 都出过此类 CVE）。
**SSRF**：服务端根据用户输入去请求 URL（Webhook、图片抓取、链接预览）时，攻击者可以让你的服务器去访问内网，例如云厂商元数据地址 `http://169.254.169.254/` 窃取临时凭证（Capital One 数据泄露事件即源于此）。用字符串 `includes`/`startsWith` 校验 URL 极易被绕过，必须用标准解析器解析后再做精确比较。

## 要实现的接口

```js
safeMerge(target, source) => target
isAllowedUrl(urlString, { allowedHosts: ['api.example.com', 'files.example.com:8443'] }) => boolean
```

## 验收标准

- `safeMerge`
  - 普通对象深度合并，数组直接覆盖，返回 `target`
  - `JSON.parse('{"__proto__":{"polluted":true}}')` 合并后 `({}).polluted === undefined`
  - `{"constructor":{"prototype":{...}}}` 载荷不污染原型
  - 嵌套层级中的 `__proto__` 同样被忽略
- `isAllowedUrl`
  - 仅允许 `http:` / `https:`；无法解析的字符串返回 `false`
  - 主机必须与白名单某一项**完全相等**（大小写不敏感），拒绝 `evil.com?x=api.example.com`、`api.example.com.evil.com`、`api.example.com@evil.com` 等伪装
  - 拒绝带用户名/密码的 URL
  - 非默认端口必须在白名单中显式写成 `host:port`；默认端口（80/443）写不写都行
  - 私有/回环/链路本地 IP（`127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`0.0.0.0`、`::1`、IPv4 映射地址等）即使出现在白名单里也拒绝
  - `2130706433`、`0x7f.0.0.1`、`127.1` 等 IP 变体写法同样被识别

## 提示

1. `Object.keys()` 只返回自有可枚举属性；`JSON.parse` 产生的 `__proto__` 恰好是自有属性，所以要显式跳过。
2. 读取 `target[key]` 时，如果 `key` 不是 `target` 的自有属性，可能会读到原型链上的东西——用 `Object.hasOwn` 判断。
3. WHATWG `URL` 会把各种 IP 写法规范化：试试 `new URL('http://2130706433/').hostname`。`url.host` 会自动去掉默认端口。
4. `node:net` 的 `isIPv4` / `isIPv6` 能帮你判断主机名是否为 IP 字面量。

## 运行命令

```bash
npm run lab -- security
# 或
node labs/run.js security
```

## 延伸思考

1. **DNS 重绑定**：本实验只校验了 URL 字符串。攻击者可以让白名单域名先解析到公网 IP 通过校验，真正连接时再解析到 `127.0.0.1`。完整防御需要在**建立连接时**解析 DNS 并校验实际 IP（例如自定义 `http.Agent` 的 `lookup`），本实验未实现。
2. 服务端跟随 3xx 重定向时，如何保证重定向目标同样经过校验？
3. 除了跳过危险 key，还有哪些方式能从根本上避免原型链污染？（`Object.create(null)`、`Map`、`Object.freeze(Object.prototype)`、`--disable-proto=delete`）
