import { Router } from "express";
import { z } from "zod";
import * as ai from "../lib/ai.js";

const router = Router();

router.post("/chat", async (req, res) => {
  const schema = z.object({
    messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() })),
    model: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "messages array with role+content required" }); return; }

  const reply = await ai.chatCompletion(parsed.data.messages, parsed.data.model).catch((e: Error) => {
    res.status(503).json({ error: "AI service unavailable", details: e.message, setup: "Set OPENAI_API_KEY or configure Replit AI integration" });
    return null;
  });
  if (reply === null) return;

  res.json({ success: true, reply, model: parsed.data.model || "gpt-4o-mini" });
});

router.post("/generate", async (req, res) => {
  const { prompt, model } = req.body;
  if (!prompt) { res.status(400).json({ error: "prompt is required" }); return; }

  const text = await ai.generateText(prompt, model).catch((e: Error) => {
    res.status(503).json({ error: "AI service unavailable", details: e.message }); return null;
  });
  if (text === null) return;

  res.json({ success: true, text, prompt });
});

router.post("/summarize", async (req, res) => {
  const { text } = req.body;
  if (!text) { res.status(400).json({ error: "text is required" }); return; }
  if (text.length > 50000) { res.status(400).json({ error: "Text too long (max 50000 chars)" }); return; }

  const summary = await ai.summarizeText(text).catch((e: Error) => {
    res.status(503).json({ error: "AI service unavailable", details: e.message }); return null;
  });
  if (summary === null) return;

  res.json({ success: true, summary, originalLength: text.length });
});

router.post("/image-describe", async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) { res.status(400).json({ error: "imageUrl is required" }); return; }

  const description = await ai.describeImage(imageUrl).catch((e: Error) => {
    res.status(503).json({ error: "AI service unavailable", details: e.message }); return null;
  });
  if (description === null) return;

  res.json({ success: true, description, imageUrl });
});

router.post("/translate", async (req, res) => {
  const schema = z.object({ text: z.string().min(1), targetLanguage: z.string().min(2) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "text and targetLanguage required" }); return; }

  const translation = await ai.translateText(parsed.data.text, parsed.data.targetLanguage).catch((e: Error) => {
    res.status(503).json({ error: "AI service unavailable", details: e.message }); return null;
  });
  if (translation === null) return;

  res.json({ success: true, translation, originalText: parsed.data.text, targetLanguage: parsed.data.targetLanguage });
});

router.post("/code", async (req, res) => {
  const schema = z.object({ prompt: z.string().min(1), language: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "prompt is required" }); return; }

  const code = await ai.generateCode(parsed.data.prompt, parsed.data.language || "javascript").catch((e: Error) => {
    res.status(503).json({ error: "AI service unavailable", details: e.message }); return null;
  });
  if (code === null) return;

  res.json({ success: true, code, language: parsed.data.language || "javascript", prompt: parsed.data.prompt });
});

export default router;
