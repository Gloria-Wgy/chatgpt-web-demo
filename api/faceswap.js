export const config = { runtime: "nodejs" };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

// 允许的前端域名
const ALLOWED_ORIGINS = ["https://gloria-wgy.github.io"];

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

// 回显上传的源图/目标图
function echoSource(files, res, note = "") {
  try {
    const file = files?.source || files?.target;
    if (!file) return res.status(400).json({ error: "No file received" });

    const filepath = file.filepath;
    if (!fs.existsSync(filepath)) {
      return res.status(500).json({ error: "Temp file not found" });
    }

    const buf = fs.readFileSync(filepath);
    const b64 = buf.toString("base64");
    return res.status(200).json({ b64, note });
  } catch (e) {
    console.error("echo error:", e);
    return res.status(500).json({ error: "Echo failed: " + e.message });
  }
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const form = formidable({
    multiples: true,
    keepExtensions: true,
    uploadDir: "/tmp"   // Vercel 临时目录
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: "File upload error" });

    // 如果没 Key 或 USE_ECHO=1 → 回显
    if (!process.env.OPENAI_API_KEY || process.env.USE_ECHO === "1") {
      return echoSource(files, res, "echo mode");
    }

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const source = fs.createReadStream(files.source.filepath);
      const target = fs.createReadStream(files.target.filepath);

      const result = await client.images.generate({
        model: "gpt-image-1",
        prompt: "Swap the face in the first image with the face from the second image. Blend naturally.",
        image: [source, target],
        size: "512x512",
        response_format: "b64_json"   // 推荐直接返回 base64
      });

      const b64 = result.data[0].b64_json;
      res.status(200).json({ b64 });
    } catch (e) {
      console.error("faceswap error:", e.message);
      return echoSource(files, res, "OpenAI error fallback");
    }
  });
}
