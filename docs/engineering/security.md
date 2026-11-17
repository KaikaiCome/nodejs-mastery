# 安全

以 OWASP Top 10 为纲，Node 服务必须做到：

## 清单

| 风险 | 防护 |
| --- | --- |
| 注入（SQL/NoSQL/命令） | 参数化查询；不拼接 SQL；`execFile` 替代 `exec`；Mongo 过滤 `$` 开头键 |
| 越权（IDOR） | 每个资源访问校验“当前用户是否拥有该资源”，不能只校验登录 |
| 认证缺陷 | 密码用 `bcrypt`/`argon2`；登录限流；JWT 短期有效 + 刷新机制 |
| 敏感数据泄露 | HTTPS；日志脱敏；错误不返回堆栈；响应字段白名单 |
| XSS | 输出编码；`helmet` 设置 CSP；Cookie `HttpOnly` |
| CSRF | Cookie `SameSite=Lax/Strict`；关键操作校验 CSRF token 或 Origin |
| SSRF | BFF 代理时**禁止透传任意 URL**；白名单域名；禁止访问内网/元数据地址 |
| 原型污染 | 不用不安全的深合并处理用户输入；`Object.create(null)`；校验 schema |
| 依赖漏洞 | `npm audit`、Dependabot/Renovate、锁定版本 |
| DoS | body 大小限制、限流、超时、正则避免 ReDoS |

## 关键代码

```js
app.use(helmet())
app.use(express.json({ limit: '100kb' }))

// 限流（多实例需 Redis store）
import rateLimit from 'express-rate-limit'
app.use('/api/login', rateLimit({ windowMs: 60_000, limit: 5 }))

// 越权：必须带上 owner 条件
const order = await db.order.findFirst({ where: { id: req.params.id, userId: req.user.id } })
if (!order) throw Errors.NotFound('order')

// 安全 Cookie
res.cookie('sid', sid, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7 * 864e5 })
```

## SSRF 示例

```js
// ❌ 攻击者传 url=http://169.254.169.254/latest/meta-data 读取云凭证
app.get('/proxy', async (req, res) => res.send(await (await fetch(req.query.url)).text()))

// ✅ 白名单
const ALLOW = new Set(['api.partner.com'])
const u = new URL(req.query.url)
if (u.protocol !== 'https:' || !ALLOW.has(u.hostname)) throw new AppError('FORBIDDEN', 'host not allowed', 403)
```

## ReDoS

```js
/^(a+)+$/.test('a'.repeat(30) + '!') // 指数级回溯，阻塞事件循环数秒
```

使用 `safe-regex` 检测、限制输入长度，或使用 RE2。

## 密钥管理

不提交 `.env`；使用 K8s Secret / Vault；定期轮换；`git-secrets`/gitleaks 扫描仓库。
