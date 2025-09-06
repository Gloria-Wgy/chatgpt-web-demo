export const config = { runtime: "nodejs" };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowed = ["https://gloria-wgy.github.io"]; // 允许 GitHub Pages 域名
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

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const form = formidable({ multiples: true });
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: "File upload error" });

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const source = fs.createReadStream(files.source.filepath);
      const target = fs.createReadStream(files.target.filepath);

      const result = await client.images.generate({
        model: "gpt-image-1",
        prompt: "Swap the face in the first image with the face from the second image. Blend naturally.",
        image: [source, target],
        size: "512x512"
      });

      res.status(200).json({ url: result.data[0].url });
    } catch (e) {
      console.error("faceswap error:", e);
      res.status(500).json({ error: e.message });
    }
  });
}
