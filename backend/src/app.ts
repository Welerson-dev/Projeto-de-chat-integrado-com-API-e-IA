import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { chatRouter } from "./routes/chat";
import { boletoRouter } from "./routes/boleto";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10kb" }));

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const token = req.header("x-app-token");
    if (token !== config.appToken) {
      return res.status(401).json({ error: "token inválido" });
    }
    next();
  });

  app.use("/api/chat", chatRouter);
  app.use("/api/boleto", boletoRouter);

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "corpo da requisição muito grande" });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON inválido" });
    }
    console.error(`[server] erro: ${(err as Error).message}`);
    return res.status(500).json({ error: "erro interno" });
  });

  return app;
}