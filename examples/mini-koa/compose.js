export function compose(middleware) {
  if (!Array.isArray(middleware)) throw new TypeError('middleware must be an array')
  return function (ctx, next) {
    let index = -1
    function dispatch(i) {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      const fn = i === middleware.length ? next : middleware[i]
      if (!fn) return Promise.resolve()
      try {
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)))
      } catch (err) {
        return Promise.reject(err)
      }
    }
    return dispatch(0)
  }
}
