# 实验：cache-singleflight（缓存与 single-flight）

## 目标

实现一个进程内缓存 `createCache`：支持 TTL、并发请求合并（single-flight）、负缓存，以及“错误不缓存”。

## 背景

热点 key 过期的瞬间，成百上千个并发请求同时发现缓存未命中并一起打到数据库，这就是**缓存击穿**，可能直接把数据库压垮；single-flight 让同一个 key 同一时刻只有一次真实加载，其余请求等待同一个结果。攻击者或 bug 反复查询不存在的数据，每次都穿透到数据库，这是**缓存穿透**；把“不存在”（`null`）也缓存一段时间即可缓解。反过来，如果把一次偶发的加载失败缓存起来，故障恢复后用户仍会持续看到错误，所以错误绝不能进缓存。

## 要实现的接口

```js
const cache = createCache({
  load: async (key) => value,   // 真实数据源
  ttlMs: 1000,
  now: () => Date.now(),        // 可注入，便于测试
})

await cache.get(key)  // => value
cache.delete(key)
```

## 验收标准

- 100 个并发 `get('a')`（未缓存）只调用一次 `load`，所有调用者拿到同一个结果
- 不同 key 互不影响
- TTL 内命中缓存不调用 `load`；`now() >= 写入时间 + ttlMs` 后重新加载
- `null` / `undefined` 结果同样被缓存
- `load` 失败时所有并发等待者收到同一个错误；错误不缓存，下一次 `get` 重新加载
- `delete(key)` 后下一次 `get` 重新加载

## 提示

1. 需要两张表：一张存已完成的结果（带过期时间），一张存进行中的 promise。
2. 判断命中不能用 `if (value)` 或 `if (cache.get(key))`——`null`、`0`、`''` 都是合法的缓存值，应该判断“条目是否存在”。
3. 把“进行中的 promise”放进表里这一步必须是**同步**的，否则并发调用之间仍有空隙。

## 运行命令

```bash
npm run lab -- cache-singleflight
# 或
node labs/run.js cache-singleflight
```

## 延伸思考

1. 多实例部署时，进程内的 single-flight 还能防住击穿吗？分布式锁或“逻辑过期 + 后台刷新”如何取舍？
2. 负缓存的 TTL 应该和正常 TTL 一样长吗？为什么？
3. 大量 key 同时过期（缓存雪崩）该怎么办？给 TTL 加随机抖动有什么作用？
