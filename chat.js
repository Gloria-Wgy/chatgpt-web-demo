export const config = {
  runtime: "nodejs",
};
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---- CORS 处理函数 ----
function setCors(req, res) {
  const origin = req.headers.origin;

  // 允许的域名白名单（你可以放多个）
  const allowed = [
    "https://gloria-wgy.github.io",
    "https://gloria-wgy.github.io/chatgpt-web-demo"
  ];

  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

// ---- 主函数 ----
export default async function handler(req, res) {
  if (setCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    // 调用 OpenAI Responses API
    const response = await client.responses.create({
      model: "gpt-4o-mini", // 你也可以换成 gpt-4o
      input: prompt,
    });

    res.status(200).json({ reply: response.output_text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Server error" });
  }
}