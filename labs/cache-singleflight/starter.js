// 实验：缓存与 single-flight
// 目标：实现 createCache，详见同目录 README.md

/**
 * @param {{
 *   load: (key: string) => Promise<any>,
 *   ttlMs: number,
 *   now?: () => number,
 * }} options
 * @returns {{ get(key: string): Promise<any>, delete(key: string): void }}
 */
export function createCache({ load, ttlMs, now = Date.now }) {
  // TODO: 用一个 Map 存缓存条目 { value, expiresAt }
  // TODO: 再用一个 Map 存“正在加载中”的 promise，实现 single-flight
  return {
    get(key) {
      // TODO: 命中且未过期 → 直接返回缓存值（null/undefined 也算命中）
      // TODO: 已有同 key 的加载在进行 → 复用那个 promise
      // TODO: 否则调用 load(key)；失败时不要缓存错误
      throw new Error('TODO: 实现 get')
    },
    delete(key) {
      // TODO: 删除缓存条目
      throw new Error('TODO: 实现 delete')
    },
  }
}
