export const config = { runtime: "nodejs" };
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL);

export default async function handler(req, res) {
  const { token } = req.query;
  try {
    const { email } = jwt.verify(token, process.env.JWT_SECRET);
    const key = "free_used:" + crypto.createHash("sha256").update(email).digest("hex");
    const used = await redis.get(key);
    return res.status(200).json({ ok: true, email, used: used === "1" });
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}
