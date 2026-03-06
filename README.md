# Mini Agent Scaffold (Admin + Public API)

## What You Get
- Admin page to edit Agent scaffold: role, objective, rules, workflow, output format, model, temperature.
- User page to chat with the configured Agent.
- Public API endpoint for third-party systems:
  - `POST /api/public/agent-chat`
  - Auth: `x-api-key: <PUBLIC_API_KEY>` or `Authorization: Bearer <PUBLIC_API_KEY>`

## Local Run
1. `cp .env.example .env`
2. Fill `LLM_API_KEY` and `PUBLIC_API_KEY`
3. `npm install`
4. `npm run dev`

## Deploy Free On Render
1. Create a GitHub repo and push this project.
2. Register/login on Render.
3. Click **New +** -> **Blueprint**.
4. Connect your GitHub repo and deploy (`render.yaml` is already prepared).
5. After deploy, set environment variables in Render dashboard:
   - `LLM_API_KEY`
   - `PUBLIC_API_KEY`
   - `OPENROUTER_SITE_URL` = your Render URL (optional but recommended)
6. Redeploy once.

You will get a public URL like `https://xxx.onrender.com`.

## API Example
```bash
curl -X POST "https://YOUR-APP.onrender.com/api/public/agent-chat" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_PUBLIC_API_KEY" \\
  -d '{"userInput":"给我一个新品发布会流程"}'
```
