import { Router, Request, Response } from "express";
import { handleMessage } from "../flows/session";

export const chatRouter = Router();

/**
 * POST /api/chat
 * Body: { sessionId: string, message: string }
 */
chatRouter.post("/", async (req: Request, res: Response) => {
  const { sessionId, message } = (req.body ?? {}) as { sessionId?: string; message?: string };

  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 64) {
    return res.status(400).json({ error: "sessionId é obrigatório" });
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message é obrigatória" });
  }

  if (message.length > 500) {
    return res.status(400).json({ error: "message muito longa (máx. 500 caracteres)" });
  }

  try {
    const result = await handleMessage(sessionId, message);
    return res.json(result);
  } catch (err) {
    console.error(`[chat] erro: ${(err as Error).message}`);
    return res.status(500).json({
      messages: [{ type: "text", text: "Ocorreu um erro interno. Tente novamente em instantes." }],
      state: "error",
    });
  }
});