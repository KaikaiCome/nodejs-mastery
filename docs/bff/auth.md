# 鉴权与会话

## 方案对比

| 方案 | 说明 | 优点 | 缺点 |
| --- | --- | --- | --- |
| Session + Cookie | 服务端（Redis）存会话，Cookie 存 sid | 可随时吊销、Token 不暴露给 JS | 需共享存储 |
| JWT（前端持有） | 前端存 token，请求带 `Authorization` | 无状态 | 难吊销；存 localStorage 有 XSS 风险 |
| **BFF Token Handler** | 前端只有 HttpOnly Cookie；BFF 用 Session 映射内部 access/refresh token | 安全性最好，业界推荐 | BFF 有状态（Redis） |

**Web BFF 推荐：Cookie Session（HttpOnly + Secure + SameSite）+ BFF 换取/刷新下游 Token。**

## 登录流程（OAuth2/OIDC + BFF）

```
浏览器 ──/login──► BFF ──302──► SSO(授权页)
浏览器 ◄──302 code── SSO
浏览器 ──/callback?code=──► BFF ──code 换 token──► SSO
BFF: 存 {accessToken, refreshToken, user} 到 Redis，Set-Cookie: sid=xxx; HttpOnly
浏览器 ──/bff/home (Cookie)──► BFF ──Authorization: Bearer access──► 下游
```

使用 PKCE + `state` 防 CSRF；`openid-client` 库可完成 OIDC 流程。

## 会话中间件

```ts
export const auth = async (req, res, next) => {
  const sid = req.cookies?.sid
  if (!sid) return next(Errors.Unauthorized())
  const raw = await redis.get(`sess:${sid}`)
  if (!raw) return next(Errors.Unauthorized())
  const sess = JSON.parse(raw)
  if (sess.expiresAt - Date.now() < 60_000) {
    // 刷新 token，用分布式锁避免并发请求同时刷新
    await withLock(`refresh:${sid}`, async () => { sess.accessToken = await refresh(sess) ; await saveSession(sid, sess) })
  }
  await redis.expire(`sess:${sid}`, 7 * 86400) // 滑动过期
  req.user = sess.user
  req.accessToken = sess.accessToken
  next()
}
```

## JWT 要点（服务间或 App 端）

```ts
import jwt from 'jsonwebtoken'
const token = jwt.sign({ sub: user.id, roles: user.roles }, PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '15m', issuer: 'auth' })
jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'], issuer: 'auth' }) // 必须指定算法，防 alg=none 攻击
```

- access token 短（5~15 分钟），refresh token 长且可吊销（存服务端，轮换使用）。
- 不在 JWT 中放敏感信息（只是 base64）。
- 吊销：黑名单（Redis，TTL=剩余有效期）或 token 版本号。

## 授权（Authorization）

- **RBAC**：角色 → 权限；`requirePermission('order:refund')` 中间件。
- **数据权限**：查询附加 owner/tenant 条件（多租户必须在 Repository 层强制 `tenantId`）。
- BFF 做**粗粒度**拦截（登录、菜单权限），领域服务做**最终**授权判断，不能只依赖 BFF。

## 跨域与 Cookie

- 同站部署（`www.a.com` 与 `bff.a.com`）用 `SameSite=Lax` 即可；跨站需 `SameSite=None; Secure` + CORS `credentials`。
- 最佳实践：通过网关把 BFF 挂到同域路径 `/bff/*`，彻底避免跨域。

## 练习

实现：`POST /login`（模拟校验）→ Redis 会话 → `GET /me` → `POST /logout` 删除会话；为 `/admin/*` 增加角色校验中间件。
