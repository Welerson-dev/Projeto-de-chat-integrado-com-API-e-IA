import type { Server } from "http";
import type { AddressInfo } from "net";
import { createApp } from "../../src/app";
import { config } from "../../src/config";

/**
 * MOTIVO: centralizar a infraestrutura dos testes de segurança (subir o
 * servidor + simular os sistemas externos). Sem isso, cada teste repetiria
 * setup e — pior — faria chamadas de rede reais à IXC/Gemini.
 *
 * TERMOS: "stub" = substituto que devolve respostas falsas fixas; "porta
 * efêmera" = porta 0, o SO escolhe uma porta livre automaticamente.
 *
 * VULNERABILIDADE (a evitar nos próprios testes): chamar serviços externos
 * reais torna os testes lentos, não reproduzíveis e dependentes de internet.
 * COMO RESOLVER: interceptar `globalThis.fetch` e responder localmente.
 */

export interface TestServer {
  url: string;
  server: Server;
  close: () => Promise<void>;
}

/** Token do app lido do .env, exatamente como o config.ts usa. */
export const APP_TOKEN = process.env.APP_TOKEN ?? "app_token_dbs_2026";

/** Dados falsos da IXC que os testes podem ajustar caso a caso. */
export const fakeIxcData: {
  cliente?: unknown[];
  contratos?: unknown[];
  faturas?: unknown[];
  /** Corpo devolvido pela ação get_boleto; {} simula o demo sem a ação. */
  boleto?: unknown;
} = {};

/**
 * Resposta crua que a API do Gemini deve devolver nos testes (texto puro).
 * Quando null, vale o padrão de classificação de menu. Cada teste ajusta
 * esta variável para simular o que a IA responderia.
 */
export let fakeGeminiReply: string | null = null;

export function setFakeGeminiReply(text: string | null): void {
  fakeGeminiReply = text;
}

/** Sobe o backend real (createApp) numa porta efêmera. */
export async function startServer(): Promise<TestServer> {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Simula as respostas da IXC (webservice/v1) e da Gemini. */
export function stubExternalServices(): void {
  // Mantém o fetch original: as requisições dos TESTES ao servidor local
  // (127.0.0.1) passam normalmente; só serviços externos são interceptados.
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // Requisição para o próprio servidor de teste → fetch real.
    if (url.startsWith("http://127.0.0.1")) {
      return realFetch(input, init);
    }

    // --- IXC ---
    if (url.includes("/webservice/v1")) {
      // /get_boleto não está liberado no demo real; por padrão devolvemos
      // vazio para o backend cair no fallback de linha digitável
      // (comportamento real). O teste pode definir fakeIxcData.boleto para
      // simular a produção (PDF em base64 / link).
      if (url.includes("/get_boleto")) {
        return jsonResponse(fakeIxcData.boleto ?? {});
      }
      if (url.includes("/cliente_contrato")) return jsonResponse({ total: 1, registros: fakeIxcData.contratos ?? [] });
      if (url.includes("/fn_areceber")) return jsonResponse({ total: 1, registros: fakeIxcData.faturas ?? [] });
      if (url.includes("/cliente")) return jsonResponse({ total: 1, registros: fakeIxcData.cliente ?? [] });
      return jsonResponse({ total: 0, registros: [] });
    }

    // --- Gemini (resposta configurável por teste; padrão = menu) ---
    if (url.includes("generativelanguage")) {
      const text = fakeGeminiReply ?? '{"intent":"menu","flow":"outro","confidence":"high"}';
      return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
    }

    throw new Error(`[teste] chamada de rede não interceptada: ${url}`);
  }) as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** POST /api/chat com token. */
export function postChat(baseUrl: string, body: unknown, token: string) {
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-token": token },
    body: JSON.stringify(body),
  });
}
