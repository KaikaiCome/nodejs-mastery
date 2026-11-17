# 前端协作：把可靠性延伸到浏览器

> 代码：`examples/shop/web/api.js`、`web/app.js` · 测试：`test/web-api.test.js`

后端做了幂等、降级、错误码，前端如果不配合，这些设计就落不了地。这一章从前端视角看同一个系统——这也是全栈工程师相对“只做后端”的优势所在。

## 1. 下单按钮的正确写法

`createCheckout()` 是一个不依赖 DOM 的小状态机，可以直接在 Node 中测试：

```js
const fp = fingerprint(items)
if (inflight && inflight.fp === fp) return inflight.promise   // 1. 双击：复用进行中的请求
if (fp !== fingerprint || !key) key = newKey()                  // 2. 购物车变了：新的意图，新的键
for (let i = 1; ; i++) {
  try {
    const order = await api.createOrder(items, key)
    key = null                                                  // 3. 成功：下一次下单是新的意图
    return order
  } catch (err) {
    if (!isRetriable(err) || i >= maxAttempts) throw err        // 4. 业务错误不重试
    await wait(200 * 2 ** (i - 1))                              // 5. 结果未知：同一个键重试
  }
}
```

| 场景 | 行为 | 测试 |
| --- | --- | --- |
| 网络错误 / 502 / 503 / 504 | 结果未知，用**同一个键**重试 | “结果未知（网络错误 / 503）时用同一个幂等键重试” |
| 409 库存不足 | 不重试，提示用户；再次提交仍用同一个键 | “业务错误不重试” |
| 购物车变化 | 生成新键 | “购物车变化或下单成功后换新键” |
| 用户连点两次 | 只发一个请求 | “重复点击合并为同一个请求” |

::: tip 为什么“禁用按钮”不够？
禁用按钮能防双击，但防不了：网络超时后用户刷新页面重新提交、移动端弱网下请求实际成功但响应超时、浏览器自动重发。**幂等键才是根本保证，按钮禁用只是体验优化。**
:::

### 幂等键存在哪里？

本项目放在内存中，刷新页面就丢失。更稳妥的做法是在进入结算页时生成，存入 `sessionStorage`，下单成功后清除——这样“刷新后重新提交”也能被识别为同一次下单。这是本章练习之一。

## 2. 统一的错误模型

所有错误都转换为 `ApiError { status, code, message, requestId }`，网络异常的 `status` 为 0：

- **用 `code` 做逻辑判断**，不要用 `message`（文案会改、会翻译）。
- **展示 `requestId`**：“下单失败（requestId: 9f0a…）”。用户截图反馈后，后端可以直接在日志中定位。
- `401` 统一跳转登录；`degraded` 非空时显示提示条。

## 3. 防 XSS：只用 textContent

```js
function h(tag, props, ...children) {
  ...
  el.append(c instanceof Node ? c : document.createTextNode(String(c)))
}
```

整个前端没有一处 `innerHTML`。商品名、通知文本即使包含 `<script>`，也只会显示为文本。再加上 BFF 返回的 CSP `default-src 'self'`，即使出现注入点，内联脚本也无法执行。

React/Vue 默认转义插值，但 `dangerouslySetInnerHTML` / `v-html`、`href="javascript:..."`、SSR 中把状态序列化进 `<script>` 时仍需格外小心。

## 4. 同源部署与 Cookie

前端由 BFF 同源提供（`/` 和 `/static/*`），所以：

- 不需要 CORS。
- 会话 Cookie 可以是 `HttpOnly`，前端 JS 根本读不到会话凭证——XSS 也偷不走它。
- `fetch` 默认 `credentials: 'same-origin'`，浏览器自动携带 Cookie 和 `Origin` 头，BFF 据此做 CSRF 校验。

如果前端部署在 CDN 的另一个域名，你需要处理 CORS、`SameSite=None; Secure`、以及更严格的 CSRF 方案。这就是为什么 [BFF 章节](../bff/auth)推荐同源部署。

## 破坏实验

1. 把 `createCheckout` 改成每次 `submit` 都生成新键。运行 `web-api` 测试；然后启动服务，用 `stack.faults.order.dropNextCommitResponses = 1` 的思路（或在浏览器 DevTools 中把网络设为离线后立刻恢复）分析会出现什么问题。
2. 在 `app.js` 的通知列表中改用 `innerHTML = n.text`，并手动插入一条文本为 `<img src=x onerror=alert(1)>` 的通知（直接写入 notifications 数据库）。观察 CSP 是否拦截，以及控制台报了什么。

## 练习

1. 把幂等键持久化到 `sessionStorage`，并为“刷新页面后重新提交”写测试（可以把存储抽象为可注入的接口）。
2. 订单列表实现“加载更多”的竞态保护：快速点击两次不能加载重复数据；切换用户后，旧请求的响应不能渲染到新页面上（提示：`AbortController` 或请求序号）。
3. 用你熟悉的框架（React/Vue）重写 `web/`，保持 `api.js` 不变，并说明框架帮你解决了哪些问题、又引入了哪些需要注意的点。
