import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { chatRouter } from "./routes/chat";
import { boletoRouter } from "./routes/boleto";
import { listarDemandas } from "./flows/session";

/**
 * MOTIVO: separar a criação do app Express do `listen()` permite que os
 * testes de segurança subam o servidor em uma porta efêmera (porta 0) sem
 * conflitar com a porta 3000 de produção — e sem precisar subir o processo
 * real. É o padrão de "app factory" do Express.
 *
 * TERMOS: "app factory" = função que cria o aplicativo Express; "porta
 * efêmera" = porta aleatória escolhida pelo SO, usada só durante o teste.
 */
export function createApp() {
  const app = express();
  app.use(cors());
  // MOTIVO (endurecimento mínimo): limite de 10kb no corpo JSON.
  // TERMOS: "limit de body" = tamanho máximo aceito no corpo da requisição.
  // VULNERABILIDADE: sem limite, um atacante pode enviar corpos gigantes
  // (flood de payload) e esgotar memória/CPU do servidor (DoS) — o Express
  // padrão aceita até 100kb, que ainda é desnecessário para um chat.
  // COMO RESOLVER: manter o limite baixo (10kb já é generoso para
  // `{ sessionId, message }`) e responder 413 quando excedido.
  app.use(express.json({ limit: "10kb" }));

  // Autenticação do app (FR-19): token simples em header; o token da IXC fica só no backend.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const token = req.header("x-app-token");
    if (token !== config.appToken) {
      return res.status(401).json({ error: "token inválido" });
    }
    next();
  });

  app.use("/api/chat", chatRouter);
  app.use("/api/boleto", boletoRouter);

  app.get("/api/demandas", (_req: Request, res: Response) => {
    res.json(listarDemandas());
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // MOTIVO (endurecimento mínimo): handler de erro para o parser de JSON.
  // TERMOS: "error handler" = middleware final que o Express chama quando
  // algo lança erro (ex.: body muito grande, JSON malformado).
  // VULNERABILIDADE: sem handler próprio, o Express responde com HTML e
  // loga o stack trace completo (detalhes internos de versões/paths) — isso
  // ajuda um atacante a mapear o servidor.
  // COMO RESOLVER: responder sempre JSON enxuto por tipo de erro:
  // 413 (corpo grande demais), 400 (JSON malformado), 500 (resto).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "corpo da requisição muito grande" });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON inválido" });
    }
    console.error(`[server] erro não tratado: ${(err as Error).message}`);
    return res.status(500).json({ error: "erro interno" });
  });

  return app;
}