import { createApi, createCheckout } from './api.js'

const api = createApi()
const checkout = createCheckout(api)
const app = document.getElementById('app')
const banner = document.getElementById('banner')
const sessionBox = document.getElementById('session')
const cart = new Map()
let ordersCursor = null

// 只用 textContent / 属性赋值构建 DOM，从不拼接 innerHTML：服务端数据里即使有 <script> 也只会显示为文本
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (v !== false && v != null) el[k] = v
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return el
}

function notify(message, kind = 'info') {
  banner.hidden = !message
  banner.className = kind === 'error' ? 'error' : ''
  banner.textContent = message ?? ''
}

function describe(err) {
  const suffix = err.requestId ? `（requestId: ${err.requestId}）` : ''
  return `${err.message}${suffix}`
}

async function guarded(fn) {
  try {
    await fn()
  } catch (err) {
    if (err.status === 401) return renderLogin()
    notify(describe(err), 'error')
  }
}

function renderLogin() {
  sessionBox.replaceChildren()
  const username = h('input', { placeholder: '用户名', value: 'alice', autocomplete: 'username' })
  const password = h('input', { placeholder: '密码', type: 'password', value: 'alice123', autocomplete: 'current-password' })
  const form = h('form', {
    onsubmit: e => {
      e.preventDefault()
      guarded(async () => {
        await api.login(username.value, password.value)
        notify(null)
        await renderHome()
      })
    }
  }, h('div', { class: 'row' }, username, password, h('button', { class: 'primary', type: 'submit' }, '登录')))
  app.replaceChildren(h('section', {}, h('h2', {}, '登录'), h('p', { class: 'muted' }, '演示账号：alice / alice123，bob / bob123'), form))
}

function renderCart() {
  const lines = [...cart.entries()].map(([id, { name, qty }]) =>
    h('div', { class: 'row' }, `${name} × ${qty}`, h('button', { onclick: () => { cart.delete(id); renderCart() } }, '移除')))
  const submit = h('button', {
    class: 'primary',
    disabled: cart.size === 0,
    onclick: () => guarded(async () => {
      submit.disabled = true
      try {
        const order = await checkout.submit([...cart.entries()].map(([productId, { qty }]) => ({ productId, qty })))
        cart.clear()
        notify(`下单成功：${order.id.slice(0, 8)}，合计 ${order.total}`)
        await renderHome()
      } finally {
        submit.disabled = cart.size === 0
      }
    })
  }, '提交订单')
  document.getElementById('cart')?.replaceChildren(h('h2', {}, '购物车'), ...(lines.length ? lines : [h('p', { class: 'muted' }, '空')]), submit)
}

function productCard(p, extra) {
  return h('div', { class: 'card' },
    h('strong', {}, p.name),
    h('span', {}, p.price),
    extra ? h('span', { class: 'muted' }, extra) : null,
    h('span', { class: 'muted' }, `库存 ${p.available}`),
    h('button', {
      disabled: p.available === 0,
      onclick: () => {
        const line = cart.get(p.id) ?? { name: p.name, qty: 0 }
        line.qty = Math.min(5, line.qty + 1)
        cart.set(p.id, line)
        renderCart()
      }
    }, '加入购物车'))
}

function orderRow(o) {
  const act = (label, fn) => h('button', { onclick: () => guarded(async () => { await fn(o.id); await renderHome() }) }, label)
  return h('tr', {},
    h('td', {}, o.id.slice(0, 8)),
    h('td', {}, o.items.map(i => `${i.name}×${i.qty}`).join('，')),
    h('td', {}, o.total),
    h('td', {}, h('span', { class: `badge ${o.status}` }, o.statusText)),
    h('td', {}, o.canPay ? act('支付', api.pay) : null, ' ', o.canCancel ? act('取消', api.cancel) : null))
}

async function renderOrders(append = false) {
  const page = await api.orders(append ? ordersCursor : null)
  ordersCursor = page.nextCursor
  const tbody = document.getElementById('orders-body')
  if (!tbody) return
  if (!append) tbody.replaceChildren()
  tbody.append(...page.items.map(orderRow))
  document.getElementById('more').hidden = !ordersCursor
}

async function renderHome() {
  const data = await api.home()
  sessionBox.replaceChildren(
    h('span', {}, `你好，${data.user.name} `),
    h('span', { class: 'badge' }, `未读通知 ${data.notifications.unread}`), ' ',
    h('button', { onclick: () => guarded(async () => { await api.logout(); renderLogin() }) }, '退出'))
  if (data.degraded.length) notify(`部分内容暂不可用（${data.degraded.join('、')}），已降级展示`)

  app.replaceChildren(
    h('section', {}, h('h2', {}, '商品'), h('div', { class: 'grid' }, data.products.map(p => productCard(p)))),
    h('section', {}, h('h2', {}, '为你推荐'),
      data.recommendations.length
        ? h('div', { class: 'grid' }, data.recommendations.map(p => productCard(p, p.reason)))
        : h('p', { class: 'muted' }, '暂无推荐')),
    h('section', { id: 'cart' }),
    h('section', {}, h('h2', {}, '我的订单'),
      h('table', {}, h('thead', {}, h('tr', {}, ['订单', '商品', '金额', '状态', '操作'].map(t => h('th', {}, t)))), h('tbody', { id: 'orders-body' })),
      h('button', { id: 'more', hidden: true, onclick: () => guarded(() => renderOrders(true)) }, '加载更多')),
    h('section', {}, h('h2', {}, '通知'),
      data.notifications.items.length
        ? h('ul', {}, data.notifications.items.map(n => h('li', {}, n.text)))
        : h('p', { class: 'muted' }, '暂无通知')))
  renderCart()
  await renderOrders()
}

guarded(async () => {
  await api.me()
  await renderHome()
})
