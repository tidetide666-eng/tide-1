# Mini Agent on Cloudflare Workers

这是“前端 + 后端 API”都部署在同一个 `workers.dev` 地址的版本。

## 你只需要做一次的步骤

### 1) 登录 Cloudflare
```bash
npm install
npx wrangler login
```

### 2) 在 Cloudflare Dashboard 绑定资源
- 在 Worker 的 `Bindings` 中添加：
  - `KV namespace` 绑定：变量名 `AGENT_KV`，命名空间选你创建的 `agent-config`
  - `Workers AI` 绑定：变量名 `AI`

### 3) 设置服务端密钥（在线环境）
```bash
npx wrangler secret put PUBLIC_API_KEY
npx wrangler secret put ADMIN_TOKEN_SECRET
npx wrangler secret put ADMIN_PASSWORD
```

说明：
- `PUBLIC_API_KEY`: 公开 API 的调用密钥（你自己定义）
- `ADMIN_TOKEN_SECRET`: 任意复杂字符串（建议 32 位以上）
- `ADMIN_PASSWORD`: 管理员密码（会覆盖默认值）

### 4) 部署上线
```bash
npx wrangler deploy
```
部署成功后会得到：
- `https://tide-1.<your-subdomain>.workers.dev`

## 在线地址
- 用户页: `https://...workers.dev/`
- 管理页: `https://...workers.dev/admin`
- 健康检查: `https://...workers.dev/api/health`
- 公开 API: `POST https://...workers.dev/api/public/agent-chat`

## 公开 API 示例
```bash
curl -X POST "https://YOUR-URL.workers.dev/api/public/agent-chat" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_PUBLIC_API_KEY" \\
  -d '{"userInput":"给我一个新品发布会执行方案"}'
```

## 管理后台默认账号
- 用户名: `admin`
- 密码: 由 `ADMIN_PASSWORD` secret 控制

## 说明
- 这是纯在线运行，不需要你在本地常驻 `npm run dev`。
- 只有改代码或改配置时，才需要再次执行 `npx wrangler deploy`。
- 默认模型为 Cloudflare Workers AI: `@cf/meta/llama-3.1-8b-instruct`。
