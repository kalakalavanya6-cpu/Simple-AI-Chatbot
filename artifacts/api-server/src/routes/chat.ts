import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";
import { StreamChatBody } from "@workspace/api-zod";

const router: IRouter = Router();

const CHAT_SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Give clear, accurate answers. If you are unsure, say so.";

router.post("/chat/stream", async (req, res): Promise<void> => {
  const parsed = StreamChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please send a valid chat message." });
    return;
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error:
        "Chat is not configured yet. Add a Google API key to this Replit project's Secrets to start chatting.",
    });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: parsed.data.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      config: {
        systemInstruction: CHAT_SYSTEM_PROMPT,
        maxOutputTokens: 8192,
      },
    });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    for await (const chunk of stream) {
      const content = chunk.text;
      if (res.destroyed) break;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Chat provider request failed");
    if (res.destroyed) return;
    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({ error: "The reply could not be completed. Please try again." })}\n\n`,
      );
      res.end();
      return;
    }
    res.status(502).json({
      error: "The AI service could not complete your request. Please try again.",
    });
  }
});

export default router;
