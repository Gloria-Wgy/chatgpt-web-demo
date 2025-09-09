export const config = { runtime: "nodejs" };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// ====== 可选：Upstash REST 客户端（无需 REDIS_URL，仅需 REST_URL/REST_TOKEN） ======
// 如果你走“路 B”，取消下面这段注释，并在环境变量里配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// import { Redis } from "@upstash/redis";
// const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
//   ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
//   : null;

// ====== ioredis 版本（路 A）：要求 REDIS_URL 是 rediss://... TLS URL ======
import IORedis from "ioredis";
const redis = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : null;

const ALLOWED_ORIGINS = ["https://chatgpt-web-demo-alpha.vercel.app"];
const SCENES = [
  "Actor.png",
  "Artist.png",
  "Astronaut.png",
  "Athlete.png",
  "Doctor.png",
  "Firefighter.png",
  "Lawyer.png",
  "Musician.png",
  "Policeman.png",
  "Scientist.png"
];

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

  // 1) 校验 token
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error:"No token" });

  let email;
  try {
    ({ email } = jwt.verify(token, process.env.JWT_SECRET));
  } catch { return res.status(401).json({ error:"Invalid token" }); }

  // 2) 免费一次校验（如果没配置 Redis，则自动跳过限制，方便先联调）
  const key = "free_used:" + crypto.createHash("sha256").update(email).digest("hex");
  try {
    if (redis) {
      const used = await redis.get(key);
      if (used === "1") return res.status(403).json({ error:"Free chance already used" });
    }
  } catch (e) {
    console.warn("Redis check failed, skipping limit:", e?.message);
  }

  const form = formidable({ multiples: true, keepExtensions:true, uploadDir:"/tmp" });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error:"File upload error" });

    const src = pickFile(files.source);
    const tgt = pickFile(files.target);
    if (!src || !tgt) return res.status(400).json({ error:"Need two photos" });

    const results = [];
    const echoB64 = fs.readFileSync(src.filepath).toString("base64");

    // 3) 换脸：有 KEY 调 OpenAI，无 KEY/USE_ECHO 就回显
    const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

    for (const name of SCENES) {
      const scene = readLocal("scenes", name);
      if (!scene) { results.push({ scene:name, b64: echoB64, note:"scene missing" }); continue; }

      if (!client || process.env.USE_ECHO === "1") {
        results.push({ scene:name, b64: echoB64, note:"echo" });
        continue;
      }
      try {
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

    // 4) 标记“已用一次免费”（如果有 Redis 才写入）
    try {
      if (redis) {
        await redis.set(key, "1", "EX", 60 * 60 * 24 * 365); // 1年
      }
    } catch (e) {
      console.warn("Redis set failed:", e?.message);
    }

    // 5) 清理临时文件
    try { fs.unlinkSync(src.filepath); fs.unlinkSync(tgt.filepath); } catch {}

    return res.status(200).json({ images: results, email });
  });
}
