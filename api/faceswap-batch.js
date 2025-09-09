export const config = { runtime: "nodejs" };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL);

const ALLOWED_ORIGINS = [process.env.FRONTEND_ORIGIN]; // 例如 https://yourdomain.com
const SCENES = ["beach.jpg","office.jpg","classroom.jpg","kitchen.jpg","forest.jpg","gym.jpg","wedding.jpg","nightmarket.jpg","ski.jpg","scifi.jpg"];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}
const pickFile = f => (Array.isArray(f) ? f[0] : f) || null;
const readLocal = (...segs) => {
  const p = path.join(process.cwd(), ...segs);
  return fs.existsSync(p) ? fs.createReadStream(p) : null;
};

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error:"Only POST" });

  // 1) 校验 token + 免费次数
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error:"No token" });

  let email;
  try {
    ({ email } = jwt.verify(token, process.env.JWT_SECRET));
  } catch { return res.status(401).json({ error:"Invalid token" }); }

  const key = "free_used:" + crypto.createHash("sha256").update(email).digest("hex");
  const used = await redis.get(key);
  if (used === "1") return res.status(403).json({ error:"Free chance already used" });

  const form = formidable({ multiples: true, keepExtensions:true, uploadDir:"/tmp" });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error:"File upload error" });

    const src = pickFile(files.source);
    const tgt = pickFile(files.target);
    if (!src || !tgt) return res.status(400).json({ error:"Need two photos" });

    const results = [];
    const echoB64 = fs.readFileSync(src.filepath).toString("base64");

    // 2) 换脸：有 KEY 调 OpenAI，无 KEY/报错就回显
    const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

    for (const name of SCENES) {
      const scene = readLocal("scenes", name); // 或改成从 URL 拉取
      if (!scene) { results.push({ scene:name, b64: echoB64, note:"scene missing" }); continue; }

      if (!client || process.env.USE_ECHO === "1") {
        results.push({ scene:name, b64: echoB64, note:"echo" });
        continue;
      }
      try {
        // ⚠️ 部分 SDK 需要用 images.edits；这里给出 generate 写法，若 400 请换成 edits
        const r = await client.images.generate({
          model: "gpt-image-1",
          prompt: "Replace the main person's face in the scene with the person from the two reference photos. Natural blend, keep pose/body/lighting.",
          image: [scene, fs.createReadStream(src.filepath), fs.createReadStream(tgt.filepath)],
          size: "768x768",
          response_format: "b64_json"
        });
        results.push({ scene:name, b64: r?.data?.[0]?.b64_json || echoB64 });
      } catch (e) {
        console.error("openai fail", name, e?.message);
        results.push({ scene:name, b64: echoB64, note:"fallback" });
      }
    }

    // 3) 标记“已免费使用一次”
    await redis.set(key, "1", "EX", 60 * 60 * 24 * 365); // 1 年有效（按需调整）

    // 4) 清理上传临时文件（隐私）
    try { fs.unlinkSync(src.filepath); fs.unlinkSync(tgt.filepath); } catch {}

    return res.status(200).json({ images: results, email });
  });
}
