# 模块系统：CommonJS 与 ESM

## CommonJS 本质

Node 会把每个文件包进一个函数：

```js
(function (exports, require, module, __filename, __dirname) {
  // 你的代码
})
```

- `require` **同步**加载，结果被缓存在 `require.cache`（单例的来源）。
- `module.exports` 才是真正导出；`exports` 只是它的引用，重新赋值 `exports = {}` 无效。
- 循环依赖时拿到的是**未完成的** exports（部分对象）。

## ESM

```js
// package.json: { "type": "module" }
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const config = await import('./config.js') // 动态导入，支持顶层 await
```

| 对比 | CJS | ESM |
| --- | --- | --- |
| 加载 | 同步、运行时 | 异步、静态分析（可 tree-shaking） |
| 导出 | 值拷贝（对象是引用） | **实时绑定**（live binding） |
| `__dirname` | 有 | 用 `import.meta.dirname`（Node ≥ 20.11） |
| 互操作 | `require(esm)` 在 Node ≥ 22 可用（同步 ESM） | 可 `import` CJS（默认导出为 `module.exports`） |

## 包解析与 `exports` 字段

```json
{
  "name": "@corp/sdk",
  "type": "module",
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" },
    "./utils": "./dist/utils.js"
  }
}
```

`exports` 会**封装**包，未声明的子路径无法被引用——企业内部 SDK 推荐使用。

## 企业实践

- 新项目统一 **ESM + TypeScript**（`"module": "NodeNext"`），或 NestJS 默认 CJS 亦可，关键是**统一**。
- 一律使用 `node:` 前缀导入内置模块。
- 单例（DB 连接池、Redis 客户端）利用模块缓存在一个文件里创建并导出。
- monorepo 用 pnpm workspace 管理 BFF 与共享类型包（前后端共享 DTO 类型）。

## 练习

构造一个 CJS 循环依赖 `a.js ↔ b.js`，打印加载过程中拿到的对象，解释输出。
