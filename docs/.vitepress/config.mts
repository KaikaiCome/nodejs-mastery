import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Node.js 精通之路',
  description: '面向高级前端：Node.js 核心、Express/Koa、BFF、企业级架构与疑难排查',
  base: '/nodejs-mastery/',
  lastUpdated: true,
  cleanUrls: true,
  markdown: { lineNumbers: true },
  themeConfig: {
    nav: [
      { text: '学习路线', link: '/guide/roadmap' },
      { text: '核心原理', link: '/core/event-loop' },
      { text: 'Express/Koa', link: '/framework/express' },
      { text: 'BFF', link: '/bff/overview' },
      { text: '架构设计', link: '/architecture/backend-thinking' },
      { text: '疑难排查', link: '/troubleshooting/playbook' },
      { text: '实验', link: '/guide/labs' },
      { text: '主线项目', link: '/mainline/overview' },
      { text: '毕业项目', link: '/project/capstone' }
    ],
    sidebar: [
      {
        text: '0. 开始',
        items: [
          { text: '学习路线与精通标准', link: '/guide/roadmap' },
          { text: '前端到后端的思维转变', link: '/guide/mindset' },
          { text: '动手实验（自动判分）', link: '/guide/labs' }
        ]
      },
      {
        text: '1. Node.js 核心原理',
        items: [
          { text: '架构与事件循环', link: '/core/event-loop' },
          { text: '模块系统 CJS/ESM', link: '/core/modules' },
          { text: '异步编程与错误处理', link: '/core/async' },
          { text: 'Buffer 与 Stream', link: '/core/stream' },
          { text: 'HTTP 与网络', link: '/core/http' },
          { text: '进程、线程与集群', link: '/core/process' }
        ]
      },
      {
        text: '2. Web 框架',
        items: [
          { text: 'Express 原理与实战', link: '/framework/express' },
          { text: 'Koa 洋葱模型与实战', link: '/framework/koa' },
          { text: '框架选型：Fastify/NestJS', link: '/framework/compare' }
        ]
      },
      {
        text: '3. 企业级工程化',
        items: [
          { text: '项目结构与分层', link: '/engineering/structure' },
          { text: '配置、日志、错误、校验', link: '/engineering/foundation' },
          { text: '数据库与缓存', link: '/engineering/database' },
          { text: '测试体系', link: '/engineering/testing' },
          { text: '安全', link: '/engineering/security' }
        ]
      },
      {
        text: '4. BFF 专题',
        items: [
          { text: 'BFF 概览与边界', link: '/bff/overview' },
          { text: '接口聚合与裁剪', link: '/bff/aggregation' },
          { text: '鉴权与会话', link: '/bff/auth' },
          { text: '稳定性：超时/重试/熔断/降级', link: '/bff/resilience' },
          { text: 'GraphQL 与 SSR 网关', link: '/bff/graphql-ssr' }
        ]
      },
      {
        text: '5. 架构设计与后端思维',
        items: [
          { text: '后端开发思维', link: '/architecture/backend-thinking' },
          { text: '分层、DDD 与整洁架构', link: '/architecture/ddd' },
          { text: '高并发与一致性', link: '/architecture/high-concurrency' },
          { text: '微服务与网关', link: '/architecture/microservices' }
        ]
      },
      {
        text: '6. 部署与可观测性',
        items: [
          { text: 'Docker/PM2/K8s 部署', link: '/ops/deploy' },
          { text: '日志/指标/链路追踪', link: '/ops/observability' }
        ]
      },
      {
        text: '7. 疑难杂症',
        items: [
          { text: '故障排查手册', link: '/troubleshooting/playbook' },
          { text: '内存泄漏与 CPU 飙高', link: '/troubleshooting/memory-cpu' },
          { text: '常见报错速查', link: '/troubleshooting/errors' }
        ]
      },
      {
        text: '8. 全栈主线项目',
        items: [
          { text: '项目总览与学习方法', link: '/mainline/overview' },
          { text: '数据层：迁移与事务', link: '/mainline/data' },
          { text: '下单：防超卖与幂等', link: '/mainline/ordering' },
          { text: '状态机与并发更新', link: '/mainline/state-machine' },
          { text: 'Outbox 与至少一次投递', link: '/mainline/outbox' },
          { text: 'BFF 与服务外壳', link: '/mainline/bff' },
          { text: '前端协作', link: '/mainline/frontend' },
          { text: '上线与运维', link: '/mainline/operations' },
          { text: '进阶：走向资深', link: '/mainline/senior' }
        ]
      },
      {
        text: '9. 实战与检验',
        items: [
          { text: '毕业项目：企业级 BFF', link: '/project/capstone' },
          { text: '可运行示例说明', link: '/project/examples' },
          { text: '精通自检清单与面试题', link: '/project/checklist' }
        ]
      }
    ],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: { noResultsText: '没有结果', resetButtonTitle: '清除', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } }
        }
      }
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
    socialLinks: [{ icon: 'github', link: 'https://github.com/KaikaiCome/nodejs-mastery' }],
    footer: { message: 'MIT Licensed', copyright: 'Node.js 精通之路' }
  }
})
