# 框架选型：Express / Koa / Fastify / NestJS

| 框架 | 定位 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- | --- |
| Express | 极简、线性中间件 | 生态最大、人人会 | 性能一般、结构全靠自律 | 小中型服务、快速原型 |
| Koa | 洋葱模型、async 原生 | 中间件优雅、轻量 | 什么都要自己选 | BFF、网关、需高度定制 |
| Fastify | 高性能、Schema 驱动 | 快（JSON 序列化优化）、插件封装、内建校验 | 生态较小 | 高吞吐 API |
| NestJS | 企业级、IoC、装饰器 | 模块化、DI、规范统一、GraphQL/微服务一体 | 学习曲线、抽象多 | 大团队、复杂业务 |
| Egg/Midway | 国内企业约定框架 | 多进程、插件、规范 | 社区国际化弱 | 国内中大型团队 |

## 选型思路（后端思维）

1. **团队规模**：>5 人长期维护 → 倾向 NestJS/Midway（约束带来一致性）。
2. **业务复杂度**：主要是转发聚合 → Koa/Fastify；复杂领域逻辑 → NestJS 分层 + DDD。
3. **性能要求**：极致吞吐 → Fastify。
4. **已有基建**：公司已有 Egg 插件体系就别另起炉灶。

## NestJS 速览

```ts
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) { return this.users.findOne(id) }
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}
  findOne(id: number) { return this.repo.findOneByOrFail({ id }) }
}
```

请求链路：Middleware → Guard（鉴权）→ Interceptor（前）→ Pipe（校验转换）→ Controller → Interceptor（后）→ Exception Filter。它本质上是 Express/Fastify 之上的**架构框架**，理解了 Express/Koa 的中间件机制再学 Nest 会很快。

## Fastify 速览

```js
const app = require('fastify')({ logger: true })
app.get('/users/:id', {
  schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } }
}, async (req) => ({ id: req.params.id }))
app.listen({ port: 3000 })
```

## 建议

先精通 Express 与 Koa（理解原理），在项目中用 **NestJS（复杂业务）或 Koa/Fastify（轻量 BFF）**。
