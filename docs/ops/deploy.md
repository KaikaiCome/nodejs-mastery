# Docker / PM2 / K8s 部署

## 生产 Dockerfile（多阶段）

```dockerfile
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--max-old-space-size=768", "dist/main.js"]
```

要点：多阶段减小体积；非 root 运行；`tini` 正确转发信号并回收僵尸进程；不要用 `npm start` 作为 CMD；`.dockerignore` 排除 `node_modules`、`.git`、`.env`。

## PM2（虚拟机部署）

```js
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'bff', script: 'dist/main.js',
    instances: 'max', exec_mode: 'cluster',
    max_memory_restart: '1G',
    kill_timeout: 10000,            // 给优雅关闭留时间
    env: { NODE_ENV: 'production' }
  }]
}
```

`pm2 reload bff` 实现零停机重载。

## Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: bff-web }
spec:
  replicas: 4
  strategy: { rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 } }
  template:
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: app
          image: registry/bff-web:1.4.2
          ports: [{ containerPort: 3000 }]
          resources:
            requests: { cpu: 500m, memory: 512Mi }
            limits: { cpu: "1", memory: 1Gi }
          readinessProbe: { httpGet: { path: /readyz, port: 3000 }, periodSeconds: 5 }
          livenessProbe: { httpGet: { path: /healthz, port: 3000 }, periodSeconds: 10, failureThreshold: 3 }
          lifecycle:
            preStop: { exec: { command: ["sleep", "5"] } } # 等待 Endpoint 摘除，避免关闭期间仍有流量进来
          envFrom: [{ secretRef: { name: bff-secrets } }, { configMapRef: { name: bff-config } }]
```

::: tip 探针设计
- `liveness` 只检查进程本身是否卡死，**不要检查下游**（否则下游故障会导致所有 BFF 被重启，雪崩）。
- `readiness` 可检查关键依赖（如 Redis），失败时摘流量但不重启。
:::

- HPA：基于 CPU 或自定义指标（QPS、事件循环延迟）自动扩缩容。
- `--max-old-space-size` 约为 memory limit 的 75%，否则 V8 不知道容器限制，可能被 OOMKilled。

## CI/CD 流水线

```
push → lint + typecheck + test → build image → 扫描漏洞 → 推送镜像
     → 部署 staging → 冒烟测试 → 灰度生产 10% → 观察指标 → 全量 / 回滚
```

## 发布原则

- 不可变镜像，同一镜像流转各环境，只改配置。
- 数据库迁移向后兼容。
- 回滚 = 部署上一个镜像版本，必须一分钟内可完成。
