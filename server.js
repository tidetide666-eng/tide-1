import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
const DEFAULT_MODEL_NAME =
  process.env.MODEL_NAME || process.env.OPENAI_MODEL || "openrouter/auto";

const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY || "";
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || "";
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || "mini-agent-scaffold";

const dataDir = path.join(__dirname, "data");
const configFile = path.join(dataDir, "agent-config.json");
const legacyPromptFile = path.join(dataDir, "prompt.json");

const client = new OpenAI({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL
});

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);
app.use(express.static(path.join(__dirname, "public")));

function defaultAgentConfig() {
  return {
    agentName: "Mini Agent",
    rolePrompt: "你是一名专业、可靠、执行力强的 AI 助手。",
    objective: "根据用户输入给出准确、可执行的回复。",
    guardrails: [
      "回答时先给结论，再补充关键依据。",
      "不知道时明确说不知道，不编造信息。",
      "默认使用简洁中文输出。"
    ],
    workflow: [
      "理解用户问题的目标和约束。",
      "给出可执行方案或答案。",
      "如果有风险或不确定点，直接标注。"
    ],
    outputFormat: "先给结论，再给步骤；必要时用编号列表。",
    model: DEFAULT_MODEL_NAME,
    temperature: 0.7
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeAgentConfig(input = {}) {
  const defaults = defaultAgentConfig();
  const temperatureNum = Number(input.temperature);

  return {
    agentName: String(input.agentName || defaults.agentName).trim(),
    rolePrompt: String(input.rolePrompt || defaults.rolePrompt).trim(),
    objective: String(input.objective || defaults.objective).trim(),
    guardrails: normalizeList(input.guardrails),
    workflow: normalizeList(input.workflow),
    outputFormat: String(input.outputFormat || defaults.outputFormat).trim(),
    model: String(input.model || defaults.model).trim(),
    temperature:
      Number.isFinite(temperatureNum) && temperatureNum >= 0 && temperatureNum <= 2
        ? temperatureNum
        : defaults.temperature
  };
}

function buildSystemPrompt(config) {
  const guardrailsText =
    config.guardrails.length > 0
      ? config.guardrails.map((rule, i) => `${i + 1}. ${rule}`).join("\n")
      : "1. 无额外规则";

  const workflowText =
    config.workflow.length > 0
      ? config.workflow.map((step, i) => `${i + 1}. ${step}`).join("\n")
      : "1. 直接根据用户输入回答";

  return [
    `你正在扮演 Agent：${config.agentName}`,
    "",
    "【角色】",
    config.rolePrompt,
    "",
    "【目标】",
    config.objective,
    "",
    "【执行规则】",
    guardrailsText,
    "",
    "【执行步骤】",
    workflowText,
    "",
    "【输出格式】",
    config.outputFormat
  ].join("\n");
}

function getProviderHeaders() {
  if (!LLM_BASE_URL.includes("openrouter.ai")) {
    return undefined;
  }

  const headers = {
    "X-Title": OPENROUTER_APP_NAME
  };

  if (OPENROUTER_SITE_URL) {
    headers["HTTP-Referer"] = OPENROUTER_SITE_URL;
  }

  return headers;
}

async function ensureConfigFile() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(configFile);
    return;
  } catch {
    // continue to create config
  }

  try {
    const rawLegacy = await fs.readFile(legacyPromptFile, "utf-8");
    const legacy = JSON.parse(rawLegacy);
    const migrated = defaultAgentConfig();

    if (typeof legacy.systemPrompt === "string" && legacy.systemPrompt.trim()) {
      migrated.rolePrompt = legacy.systemPrompt.trim();
    }

    await fs.writeFile(configFile, JSON.stringify(migrated, null, 2), "utf-8");
  } catch {
    const initial = defaultAgentConfig();
    await fs.writeFile(configFile, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readAgentConfig() {
  await ensureConfigFile();
  const raw = await fs.readFile(configFile, "utf-8");
  return sanitizeAgentConfig(JSON.parse(raw));
}

async function saveAgentConfig(cfg) {
  const next = sanitizeAgentConfig(cfg);
  await fs.writeFile(configFile, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

async function runAgent(userInput) {
  const cfg = await readAgentConfig();
  const systemPrompt = buildSystemPrompt(cfg);

  const completion = await client.chat.completions.create(
    {
      model: cfg.model || DEFAULT_MODEL_NAME,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput }
      ],
      temperature: cfg.temperature
    },
    {
      headers: getProviderHeaders()
    }
  );

  const answer = completion.choices?.[0]?.message?.content || "";

  return {
    answer,
    agentName: cfg.agentName,
    usedModel: cfg.model || DEFAULT_MODEL_NAME,
    usedPrompt: systemPrompt
  };
}

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: "未登录或无权限" });
}

function readPublicApiKey(req) {
  const xApiKey = String(req.headers["x-api-key"] || "").trim();
  const authHeader = String(req.headers.authorization || "");
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return xApiKey || bearer;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "mini-agent-backend" });
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: "账号或密码错误" });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/admin/agent-config", requireAdmin, async (_req, res) => {
  const cfg = await readAgentConfig();
  res.json({ ...cfg, compiledPrompt: buildSystemPrompt(cfg) });
});

app.put("/api/admin/agent-config", requireAdmin, async (req, res) => {
  const cfg = sanitizeAgentConfig(req.body || {});

  if (!cfg.rolePrompt) {
    return res.status(400).json({ error: "角色设定不能为空" });
  }

  const saved = await saveAgentConfig(cfg);
  return res.json({ ...saved, compiledPrompt: buildSystemPrompt(saved) });
});

app.post("/api/chat", async (req, res) => {
  try {
    const userInput = String(req.body?.userInput || "").trim();

    if (!userInput) {
      return res.status(400).json({ error: "userInput 不能为空" });
    }

    if (!LLM_API_KEY || LLM_API_KEY.includes("your_")) {
      return res.status(500).json({ error: "请先在 .env 配置 LLM_API_KEY" });
    }

    const result = await runAgent(userInput);
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "模型调用失败，请检查服务端日志" });
  }
});

app.post("/api/public/agent-chat", async (req, res) => {
  try {
    if (!PUBLIC_API_KEY) {
      return res.status(503).json({ error: "服务端未配置 PUBLIC_API_KEY" });
    }

    const incomingKey = readPublicApiKey(req);
    if (incomingKey !== PUBLIC_API_KEY) {
      return res.status(401).json({ error: "API Key 无效" });
    }

    const userInput = String(req.body?.userInput || "").trim();
    if (!userInput) {
      return res.status(400).json({ error: "userInput 不能为空" });
    }

    if (!LLM_API_KEY || LLM_API_KEY.includes("your_")) {
      return res.status(500).json({ error: "服务端未配置 LLM_API_KEY" });
    }

    const result = await runAgent(userInput);
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "模型调用失败" });
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

ensureConfigFile()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize agent config:", err);
    process.exit(1);
  });
