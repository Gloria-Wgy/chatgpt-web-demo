export const config = { runtime: "nodejs" };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import path from "path";

// 允许的前端域名（你的 GitHub Pages）
const ALLOWED_ORIGINS = ["https://gloria-wgy.github.io"];

// 你要批量处理的场景文件名（放在 /scenes 下）
const SCENES = [
  "beach.jpg","office.jpg","classroom.jpg","kitchen.jpg","forest.jpg",
  "gym.jpg","wedding.jpg","nightmarket.jpg","ski.jpg","scifi.jpg"
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

// 兼容 formidable 返回的数组/单对象
const pickFile = (f) => (Array.isArray(f) ? f[0] : f) || null;

// 读取项目内静态文件（Vercel 部署包是可读的）
function tryReadLocalFile(...segments) {
  const p = path.join(process.cwd(), ...segments);
  if (fs.existsSync(p)) return fs.createReadStream(p);
  return null;
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const form = formidable({ multiples: true, keepExtensions: true, uploadDir: "/tmp" });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: "File upload error" });
    try {
      const src = pickFile(files.source);
      const tgt = pickFile(files.target);
      if (!src || !tgt) return res.status(400).json({ error: "Need two source photos: source & target" });

      // 没额度时可设置 USE_ECHO=1，直接回显第一张源脸，便于链路验证
      if (!process.env.OPENAI_API_KEY || process.env.USE_ECHO === "1") {
        const b64 = fs.readFileSync(src.filepath).toString("base64");
        return res.status(200).json({ images: SCENES.map(name => ({ scene: name, b64, note: "echo" })) });
      }

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // 用第一张源脸做参考（也可把两张都传入，提示里说明融合）
      const sourceFaceStream = fs.createReadStream(src.filepath);
      const secondFaceStream = fs.createReadStream(tgt.filepath);

      const results = [];

      // 逐张处理（也可以 Promise.all 并发，但容易触发限速/配额）
      for (const sceneName of SCENES) {
        const sceneStream = tryReadLocalFile("scenes", sceneName);
        if (!sceneStream) {
          // 找不到场景文件，就用回显兜底
          const b64 = fs.readFileSync(src.filepath).toString("base64");
          results.push({ scene: sceneName, b64, note: "scene missing, echo" });
          continue;
        }

        // 可选 mask（与场景同名）
        const maskStream = tryReadLocalFile("masks", sceneName.replace(path.extname(sceneName), ".png"));

        try {
          // 注意：不同 SDK 版本图像编辑参数名可能有差异：
          // 有的用 images.generate(image:[...])，有的用 images.edits(image, mask, prompt)。
          // 下面写法基于较新的 'images.generate' 语义；若报 400，请改用 images.edits。
          const resp = await client.images.generate({
            model: "gpt-image-1",
            // 把参考脸（sourceFaceStream/secondFaceStream）作为“参考输入”，并让模型把场景里主要人物的脸替换为参考脸
            prompt: "Replace the main person's face in the first scene image with the person from the reference photos. Preserve pose/body, blend skin tone and lighting naturally. High fidelity.",
            // 传入顺序：场景图 + 两张参考脸
            image: maskStream
              ? [sceneStream, sourceFaceStream, secondFaceStream, maskStream]  // 带 mask（有些版本不支持 image[] + mask，请改用 edits）
              : [sceneStream, sourceFaceStream, secondFaceStream],
            size: "768x768",
            response_format: "b64_json"
          });

          const b64 = resp?.data?.[0]?.b64_json;
          if (!b64) {
            // 没返回就兜底回显
            const fallback = fs.readFileSync(src.filepath).toString("base64");
            results.push({ scene: sceneName, b64: fallback, note: "no image returned, echo" });
          } else {
            results.push({ scene: sceneName, b64 });
          }
        } catch (e) {
          console.error("scene fail:", sceneName, e?.message || e);
          const fallback = fs.readFileSync(src.filepath).toString("base64");
          results.push({ scene: sceneName, b64: fallback, note: "error fallback" });
        }
      }

      return res.status(200).json({ images: results });
    } catch (e) {
      console.error("batch error:", e);
      return res.status(500).json({ error: e?.message || "Server error" });
    }
  });
}
