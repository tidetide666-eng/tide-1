const CONFIG_KEY = "agent-config";

function defaultAgentConfig(env) {
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
    model: env.MODEL_NAME || "openrouter/auto",
    temperature: 0.7
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
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

function sanitizeAgentConfig(input = {}, env) {
  const defaults = defaultAgentConfig(env);
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

async function getAgentConfig(env) {
  if (!env.AGENT_KV) {
    throw new Error("Missing KV binding: AGENT_KV");
  }

  const raw = await env.AGENT_KV.get(CONFIG_KEY);
  if (!raw) {
    const defaults = defaultAgentConfig(env);
    await env.AGENT_KV.put(CONFIG_KEY, JSON.stringify(defaults));
    return defaults;
  }

  return sanitizeAgentConfig(JSON.parse(raw), env);
}

async function saveAgentConfig(env, input) {
  if (!env.AGENT_KV) {
    throw new Error("Missing KV binding: AGENT_KV");
  }

  const cfg = sanitizeAgentConfig(input, env);
  await env.AGENT_KV.put(CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  return atob((str + pad).replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmacSign(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const bytes = new Uint8Array(sig);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return b64urlEncode(str);
}

async function createAdminToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "admin",
    iat: now,
    exp: now + 60 * 60 * 24 * 7
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(payloadStr);
  const sig = await hmacSign(env.ADMIN_TOKEN_SECRET, payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifyAdminToken(env, token) {
  if (!token || !env.ADMIN_TOKEN_SECRET) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmacSign(env.ADMIN_TOKEN_SECRET, payloadB64);
  if (sig !== expectedSig) return false;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload?.sub === "admin" && Number(payload?.exp || 0) > now;
}

function readAdminToken(request) {
  const auth = String(request.headers.get("authorization") || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return String(request.headers.get("x-admin-token") || "").trim();
}

function readPublicApiKey(request) {
  const xApiKey = String(request.headers.get("x-api-key") || "").trim();
  if (xApiKey) return xApiKey;

  const auth = String(request.headers.get("authorization") || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  return "";
}

function parseRequestJson(request) {
  return request.json().catch(() => ({}));
}

function withCors(request, response) {
  const origin = request.headers.get("origin") || "*";
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, Authorization, x-api-key, x-admin-token");
  headers.set("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

async function runAgent(env, userInput) {
  const cfg = await getAgentConfig(env);
  const systemPrompt = buildSystemPrompt(cfg);

  const llmApiKey = String(env.LLM_API_KEY || "").trim();
  if (!llmApiKey) {
    throw new Error("Missing LLM_API_KEY");
  }

  const base = String(env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const url = `${base}/chat/completions`;

  const headers = {
    Authorization: `Bearer ${llmApiKey}`,
    "Content-Type": "application/json"
  };

  if (base.includes("openrouter.ai")) {
    headers["X-Title"] = String(env.OPENROUTER_APP_NAME || "mini-agent-scaffold");
    if (env.OPENROUTER_SITE_URL) {
      headers["HTTP-Referer"] = String(env.OPENROUTER_SITE_URL);
    }
  }

  const payload = {
    model: cfg.model || env.MODEL_NAME || "openrouter/auto",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput }
    ],
    temperature: cfg.temperature
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  if (!resp.ok) {
    const message = data?.error?.message || data?.error || "模型调用失败";
    throw new Error(String(message));
  }

  const answer = data?.choices?.[0]?.message?.content || "";

  return {
    answer,
    agentName: cfg.agentName,
    usedModel: cfg.model || env.MODEL_NAME || "openrouter/auto",
    usedPrompt: systemPrompt
  };
}

async function handleApi(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return json({ ok: true });
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, service: "mini-agent-backend-workers" });
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    const body = await parseRequestJson(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();

    if (!env.ADMIN_TOKEN_SECRET) {
      return json({ error: "服务端未配置 ADMIN_TOKEN_SECRET" }, 500);
    }

    if (username !== String(env.ADMIN_USERNAME || "admin") || password !== String(env.ADMIN_PASSWORD || "123456")) {
      return json({ error: "账号或密码错误" }, 401);
    }

    const token = await createAdminToken(env);
    return json({ ok: true, token });
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    return json({ ok: true });
  }

  if (url.pathname === "/api/admin/agent-config" && request.method === "GET") {
    const token = readAdminToken(request);
    const ok = await verifyAdminToken(env, token);
    if (!ok) return json({ error: "未登录或无权限" }, 401);

    const cfg = await getAgentConfig(env);
    return json({ ...cfg, compiledPrompt: buildSystemPrompt(cfg) });
  }

  if (url.pathname === "/api/admin/agent-config" && request.method === "PUT") {
    const token = readAdminToken(request);
    const ok = await verifyAdminToken(env, token);
    if (!ok) return json({ error: "未登录或无权限" }, 401);

    const body = await parseRequestJson(request);
    const cfg = sanitizeAgentConfig(body, env);
    if (!cfg.rolePrompt) return json({ error: "角色设定不能为空" }, 400);

    const saved = await saveAgentConfig(env, cfg);
    return json({ ...saved, compiledPrompt: buildSystemPrompt(saved) });
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    const body = await parseRequestJson(request);
    const userInput = String(body.userInput || "").trim();
    if (!userInput) return json({ error: "userInput 不能为空" }, 400);

    try {
      const result = await runAgent(env, userInput);
      return json(result);
    } catch (err) {
      return json({ error: err.message || "模型调用失败" }, 500);
    }
  }

  if (url.pathname === "/api/public/agent-chat" && request.method === "POST") {
    const publicKey = String(env.PUBLIC_API_KEY || "").trim();
    if (!publicKey) return json({ error: "服务端未配置 PUBLIC_API_KEY" }, 503);

    const incoming = readPublicApiKey(request);
    if (incoming !== publicKey) return json({ error: "API Key 无效" }, 401);

    const body = await parseRequestJson(request);
    const userInput = String(body.userInput || "").trim();
    if (!userInput) return json({ error: "userInput 不能为空" }, 400);

    try {
      const result = await runAgent(env, userInput);
      return json(result);
    } catch (err) {
      return json({ error: err.message || "模型调用失败" }, 500);
    }
  }

  return json({ error: "Not Found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const response = await handleApi(request, env);
      return withCors(request, response);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
