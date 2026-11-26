// server.js — AI Council, built to run on Glitch (no GitHub / Vercel needed).
// Secrets GEMINI_API_KEY and OPENROUTER_API_KEY are read from Glitch's .env file
// (Tools -> .env in the Glitch editor), which stays private even if the project
// is shared or remixed.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const OPENROUTER_MODELS = {
  gptoss:   "openai/gpt-oss-20b:free",
  deepseek: "deepseek/deepseek-chat-v3.1:free",
  llama:    "meta-llama/llama-3.3-70b-instruct:free",
  qwen:     "qwen/qwen-2.5-72b-instruct:free",
};

async function askGemini(question) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "GEMINI_API_KEY not set (add it in Glitch's .env file)" };
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: question }] }] }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data?.error?.message || `Gemini error ${resp.status}` };
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
    if (!text) return { ok: false, error: "Empty response from Gemini" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function askOpenRouter(modelId, question) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, error: "OPENROUTER_API_KEY not set (add it in Glitch's .env file)" };
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: question }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data?.error?.message || `OpenRouter error ${resp.status}` };
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) return { ok: false, error: "Empty response" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

app.post("/api/ask", async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question (string) is required" });
    return;
  }

  const [gemini, gptoss, deepseek, llama, qwen] = await Promise.all([
    askGemini(question),
    askOpenRouter(OPENROUTER_MODELS.gptoss, question),
    askOpenRouter(OPENROUTER_MODELS.deepseek, question),
    askOpenRouter(OPENROUTER_MODELS.llama, question),
    askOpenRouter(OPENROUTER_MODELS.qwen, question),
  ]);

  res.json({ results: { gemini, gptoss, deepseek, llama, qwen } });
});

app.post("/api/judge", async (req, res) => {
  const { question, answers } = req.body || {};
  if (!question || !answers || typeof answers !== "object") {
    res.status(400).json({ error: "question and answers are required" });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.json({ ok: false, text: "GEMINI_API_KEY not set" });
    return;
  }

  const labels = {
    gemini: "Gemini 2.5 Flash (Google)",
    gptoss: "GPT-OSS 20B (OpenAI, open-weight)",
    deepseek: "DeepSeek V3.1",
    llama: "Llama 3.3 70B (Meta)",
    qwen: "Qwen 2.5 72B (Alibaba)",
  };

  const panelText = Object.entries(answers)
    .map(([id, text]) => `### ${labels[id] || id}\n${text}`)
    .join("\n\n");

  const prompt =
    `Sawaal: "${question}"\n\n` +
    `Neeche alag-alag AI models ke jawab hain:\n\n${panelText}\n\n` +
    `Ek short Hinglish analysis likho (max 120 words): har jawab mein kya accha hai, ` +
    `kahan farak hai, kaunsa sabse zyada accurate/complete lag raha hai aur kyun. ` +
    `Final decision user khud lega, isliye ise ek neutral comparison ki tarah likho, ` +
    `ek "guaranteed correct" verdict ki tarah nahi.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      res.json({ ok: false, text: data?.error?.message || "Analysis failed" });
      return;
    }
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
    res.json({ ok: Boolean(text), text: text || "Analysis empty" });
  } catch (e) {
    res.json({ ok: false, text: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI Council running on port ${PORT}`));
