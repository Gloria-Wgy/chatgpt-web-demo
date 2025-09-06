export const config = { runtime: "nodejs" };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

// 允许的前端域名（GitHub Pages）
const ALLOWED_ORIGINS = ["https://gloria-wgy.github.io"];

// CORS
function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
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

// 把上传的源图回显为 base64（fallback）
function echoSource(files, res, note = "") {
  try {
    const file = files?.source || files?.target;
    if (!file) return res.status(400).json({ error: "No file received" });
    const buf = fs.readFileSync(file.filepath);
    const b64 = buf.toString("base64");
    // 前端会同时兼容 url 和 b64，这里返回 b64
    return res.status(200).json({ b64, note: note || "echo" });
  } catch (e) {
    console.error("echo error:", e);
    return res.status(500).json({ error: "Echo failed" });
  }
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const form = formidable({ multiples: true, keepExtensions: true });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: "File upload error" });

    // 若没 Key 或设置了强制回显模式，则直接回显
    if (!process.env.OPENAI_API_KEY || process.env.USE_ECHO === "1") {
      return echoSource(files, res, "no key or echo mode");
    }

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const source = fs.createReadStream(files.source.filepath);
      const target = fs.createReadStream(files.target.filepath);

      // ⚠️ 不同 SDK 版本的图像参数名可能不同，如果报 400 可改为 images / image 等
      const result = await client.images.generate({
        model: "gpt-image-1",
        prompt:
          "Swap the face in the first image with the face from the second image. Blend tone/lighting naturally.",
        image: [source, target],
        size: "512x512",
        // 可改为 "b64_json" 更稳：然后返回 { b64: r.data[0].b64_json }
        // response_format: "b64_json"
      });

      // 默认返回 URL；若改成 b64_json，请相应调整
      const url = result?.data?.[0]?.url;
      if (!url) {
        // 没拿到图就回显
        return echoSource(files, res, "no url from OpenAI");
      }
      return res.status(200).json({ url });
    } catch (e) {
      // 配额/认证等报错统一兜底回显
      const msg = String(e?.message || e);
      console.error("faceswap OpenAI error:", msg);
      if (msg.includes("quota") || msg.includes("429") || msg.includes("billing")) {
        return echoSource(files, res, "quota/billing fallback");
      }
      return echoSource(files, res, "generic fallback"); // 任何异常都回显
    }
  });
}
