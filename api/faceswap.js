export const config = { runtime: "nodejs" };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

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

// 统一把可能的数组/单个文件对象标准化成 { filepath, mimetype, originalFilename, size }
function pickFile(f) {
  if (!f) return null;
  if (Array.isArray(f)) return f[0] || null;
  return f;
}

function echoSource(files, res, note = "") {
  try {
    const f = pickFile(files?.source) || pickFile(files?.target);
    if (!f) return res.status(400).json({ error: "No file received" });

    const filepath = f.filepath;
    if (!filepath || !fs.existsSync(filepath)) {
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
    multiples: true,        // 允许多个文件
    keepExtensions: true,   // 保留扩展名
    uploadDir: "/tmp"       // Vercel 的临时目录
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: "File upload error" });

    // 打印一点日志（在 Vercel Functions 日志里可见）
    try {
      console.log("fields:", Object.keys(fields || {}));
      console.log("files keys:", Object.keys(files || {}));
      console.log("source is array?", Array.isArray(files?.source));
      console.log("target is array?", Array.isArray(files?.target));
    } catch {}

    // 若无 Key 或开启回显模式，直接回显，先验证链路
    if (!process.env.OPENAI_API_KEY || process.env.USE_ECHO === "1") {
      return echoSource(files, res, "echo mode");
    }

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const src = pickFile(files.source);
      const tgt = pickFile(files.target);
      if (!src || !tgt) return res.status(400).json({ error: "Both source and target are required" });

      if (!fs.existsSync(src.filepath) || !fs.existsSync(tgt.filepath)) {
        return res.status(500).json({ error: "Temp file not found" });
      }

      const sourceStream = fs.createReadStream(src.filepath);
      const targetStream = fs.createReadStream(tgt.filepath);

      // 提示：不同 SDK 版本图像参数名可能有差异；如报 400，请查看日志并按文档调整
      const result = await client.images.generate({
        model: "gpt-image-1",
        prompt: "Swap the face in the first image with the face from the second image. Blend tone and lighting naturally.",
        image: [sourceStream, targetStream],
        size: "512x512",
        response_format: "b64_json" // 直接要 base64，更稳定
      });

      const b64 = result?.data?.[0]?.b64_json;
      if (!b64) return res.status(500).json({ error: "No image returned" });

      return res.status(200).json({ b64 });
    } catch (e) {
      console.error("faceswap error:", e?.message || e);
      // 兜底回显，保证页面能看到图像
      return echoSource(files, res, "OpenAI error fallback");
    }
  });
}
