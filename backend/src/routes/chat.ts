import { Router, Request, Response } from "express";
import { handleMessage } from "../flows/session";

export const chatRouter = Router();

/**
 * POST /api/chat
 * Body: { sessionId: string, message: string, phone?: string }
 *
 * Identificação (sem login): a sessão nasce no estado "awaiting_phone" e o
 * bot pede o telefone. O que o cliente DIGITA é consultado na IXC; se o
 * canal (ex.: WhatsApp) mandar o número no campo opcional `phone`, a
 * identificação pode ser automática. A sessão é mantida por sessionId.
 */
chatRouter.post("/", async (req: Request, res: Response) => {
  const { sessionId, message, phone } = (req.body ?? {}) as { sessionId?: string; message?: string; phone?: string };

  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 64) {
    return res.status(400).json({ error: "sessionId é obrigatório" });
  }
  // MOTIVO (endurecimento mínimo): validar o phone opcional antes de usá-lo.
  // TERMOS: "phone" = número do canal (WhatsApp/webchat) usado na
  // identificação automática da primeira mensagem.
  // VULNERABILIDADE: sem validação, um phone gigante ou não-string vira uma
  // consulta externa à IXC (abuso de custo/rate limit).
  // COMO RESOLVER: aceitar apenas string com até 24 caracteres.
  if (phone !== undefined && (typeof phone !== "string" || !phone.trim() || phone.length > 24)) {
    return res.status(400).json({ error: "phone inválido" });
  }
  // MOTIVO (endurecimento mínimo): limitar o tamanho da mensagem.
  // TERMOS: "resource exhaustion" = esgotamento de recursos.
  // VULNERABILIDADE: cada mensagem livre é enviada à API Gemini (paga) e a
  // mensagem é gravada em memória (demandas/sessão). Uma mensagem gigante
  // permite abuso de custo (mensagens enormes = chamadas caras) e deixa o
  // servidor mais lento. Não há como o cliente precisar digitar mais que isso.
  // COMO RESOLVER: rejeitar com 400 mensagens acima de 500 caracteres.
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message é obrigatória" });
  }
  if (message.length > 500) {
    return res.status(400).json({ error: "message muito longa (máx. 500 caracteres)" });
  }

  try {
    const result = await handleMessage(sessionId, message, phone?.trim());
    return res.json(result);
  } catch (err) {
    console.error(`[chat] erro: ${(err as Error).message}`);
    return res.status(500).json({
      messages: [{ type: "text", text: "Ocorreu um erro interno. Tente novamente em instantes." }],
      state: "error",
    });
  }
});