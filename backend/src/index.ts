import { config } from "./config";
import { createApp } from "./app";
import { ixc } from "./ixc/client";

const app = createApp();

app.listen(config.port, () => {
  console.log(`[server] DBS chatbot backend em http://localhost:${config.port}`);
  console.log(`[server] IXC: ${config.ixcUrl} (token configurado: ${config.ixcToken ? "sim" : "NÃO"})`);
  console.log(`[server] Gemini: modelo ${config.geminiModel} (chave configurada: ${config.geminiApiKey ? "sim" : "NÃO"})`);
});

// Diagnóstico dia 0 (PRD §12): teste de leitura da IXC ao subir.
ixc
  .ping()
  .then((ok) => console.log(`[ixc] ping: ${ok ? "OK — token válido" : "FALHOU — verifique token/URL"}`))
  .catch((err) => console.error(`[ixc] ping erro: ${(err as Error).message}`));