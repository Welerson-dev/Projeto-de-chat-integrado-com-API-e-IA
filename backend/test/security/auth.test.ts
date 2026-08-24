import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stubExternalServices, postChat, APP_TOKEN, TestServer } from "./helpers";

/**
 * ============================================================================
 * TESTES DE AUTENTICAÇÃO (x-app-token)
 * ============================================================================
 *
 * MOTIVO: garantir que o "crachá" do app é exigido em TODAS as rotas `/api/*`.
 *
 * TERMOS:
 * - "Autenticação" = provar quem você é (o token). Diferente de
 *   "autorização" = provar o que você pode fazer (não existe aqui no MVP).
 * - "401 Unauthorized" = status HTTP para "não autenticado".
 * - "x-app-token" = header customizado com o token compartilhado do app.
 *
 * VULNERABILIDADE (conhecida e aceita no MVP): token ÚNICO e estático,
 * embutido no app (que é público — qualquer um pode extrair do APK/JS).
 * Isso significa que a proteção é fraca contra quem tiver o token: não há
 * identificação do cliente, não há expiração e um vazamento do token dá
 * acesso total ao backend. Não há "autorização por cliente".
 *
 * COMO RESOLVER (produção):
 * - Substituir por autenticação por usuário real (ex.: OAuth2/OpenID
 *   Connect do próprio app, ou ao menos um token por instalação);
 * - Nunca confiar em token estático embutido no cliente;
 * - Transportar tudo por HTTPS (hoje o token trafega em texto puro em rede
 *   local — qualquer um na mesma rede pode capturá-lo).
 * ============================================================================
 */
describe("Autenticação — x-app-token", () => {
  let server: TestServer;

  before(async () => {
    stubExternalServices();
    server = await startServer();
  });

  after(() => server.close());

  it("POST /api/chat sem token → 401", async () => {
    const res = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", message: "oi" }),
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/chat com token errado → 401", async () => {
    const res = await postChat(server.url, { sessionId: "s1", message: "oi" }, "token_errado");
    assert.equal(res.status, 401);
  });

  it("POST /api/chat com token correto → 200", async () => {
    // fakeIxcData.cliente vazio → "Não localizei seu cadastro" (200), sem rede.
    const res = await postChat(server.url, { sessionId: "s1", message: "oi" }, APP_TOKEN);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.messages, "resposta deve ter mensagens");
  });

  it("GET /api/boleto/1 sem token → 401", async () => {
    const res = await fetch(`${server.url}/api/boleto/1`);
    assert.equal(res.status, 401);
  });

  it("GET /api/demandas sem token → 401", async () => {
    const res = await fetch(`${server.url}/api/demandas`);
    assert.equal(res.status, 401);
  });

  it("GET /health é público → 200", async () => {
    // MOTIVO: /health é o "batimento cardíaco" do servidor; precisa ser
    // público para orquestradores/monitores (ex.: Docker healthcheck)
    // verificarem se o processo está vivo sem conhecer o token.
    const res = await fetch(`${server.url}/health`);
    assert.equal(res.status, 200);
  });

  it("erro 401 não vaza detalhes do token", async () => {
    // MOTIVO: a resposta de erro deve ser mínima; vazar detalhes internos
    // (ex.: stack trace, qual comparação falhou) ajuda o atacante a adivinhar.
    const res = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", message: "oi" }),
    });
    const body = await res.json();
    assert.deepEqual(body, { error: "token inválido" });
  });
});
