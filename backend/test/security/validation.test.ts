import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stubExternalServices, postChat, APP_TOKEN, TestServer } from "./helpers";

/**
 * ============================================================================
 * TESTES DE VALIDAÇÃO DE ENTRADA
 * ============================================================================
 *
 * MOTIVO: toda entrada que vem do cliente é potencialmente maliciosa —
 * o primeiro "filtro" de segurança de uma API é rejeitar o que não é válido.
 *
 * TERMOS:
 * - "Validação de entrada" (input validation) = regras que aceitam apenas o
 *   que o sistema espera (tamanho, tipo, formato) e rejeitam o resto.
 * - "400 Bad Request" = status HTTP para "requisição inválida".
 * - "413 Payload Too Large" = status HTTP para "corpo grande demais".
 *
 * VULNERABILIDADE (sem validação):
 * - "DoS por payload" — corpo gigante sobrecarrega memória/CPU.
 * - "Abuso de custo" — mensagem enorme enviada à IA paga.
 * - "Injeção" — dados malformados vazando para consultas (ver teste de CPF).
 *
 * COMO RESOLVER: validar sempre no servidor (nunca confiar no app),
 * limitar tamanhos e validar formato antes de processar.
 * ============================================================================
 */
describe("Validação de entrada", () => {
  let server: TestServer;

  before(async () => {
    stubExternalServices();
    server = await startServer();
  });

  after(() => server.close());

  it("POST /api/chat sem sessionId → 400", async () => {
    const res = await postChat(server.url, { message: "oi" }, APP_TOKEN);
    assert.equal(res.status, 400);
  });

  it("POST /api/chat com sessionId acima de 64 caracteres → 400", async () => {
    // MOTIVO: sessionId vira chave de um Map em memória; valores enormes
    // permitem "poisoning" de memória (criar milhões de sessões estranhas).
    const res = await postChat(server.url, { sessionId: "x".repeat(65), message: "oi" }, APP_TOKEN);
    assert.equal(res.status, 400);
  });

  it("POST /api/chat sem message → 400", async () => {
    const res = await postChat(server.url, { sessionId: "s1" }, APP_TOKEN);
    assert.equal(res.status, 400);
  });

  it("POST /api/chat com message vazia → 400", async () => {
    const res = await postChat(server.url, { sessionId: "s1", message: "   " }, APP_TOKEN);
    assert.equal(res.status, 400);
  });

  it("POST /api/chat com message muito longa (>500) → 400", async () => {
    // VULNERABILIDADE (endurecida): mensagens livres vão para a IA paga;
    // um atacante podia inflar a mensagem para gastar créditos/CPU.
    // COMO RESOLVER (já aplicado no chat.ts): rejeitar >500 caracteres.
    const res = await postChat(server.url, { sessionId: "s1", message: "a".repeat(501) }, APP_TOKEN);
    assert.equal(res.status, 400);
  });

  it("POST /api/chat com corpo JSON acima de 10kb → 413", async () => {
    // VULNERABILIDADE (endurecida): sem o limite de body, um corpo gigante
    // (ex.: 50mb de JSON) sobrecarrega o parser do Express.
    // COMO RESOLVER (já aplicado no app.ts): express.json({ limit: "10kb" }).
    const bigMessage = "a".repeat(12 * 1024);
    const res = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-token": APP_TOKEN },
      body: JSON.stringify({ sessionId: "s1", message: bigMessage }),
    });
    assert.equal(res.status, 413);
  });

  it("GET /api/boleto/:id com id não numérico → 400", async () => {
    const res = await fetch(`${server.url}/api/boleto/abc`, { headers: { "x-app-token": APP_TOKEN } });
    assert.equal(res.status, 400);
  });

  it("GET /api/boleto/:id com id negativo ou zero → 400", async () => {
    for (const id of ["-1", "0", "1.5"]) {
      const res = await fetch(`${server.url}/api/boleto/${id}`, { headers: { "x-app-token": APP_TOKEN } });
      assert.equal(res.status, 400, `id=${id} deveria ser rejeitado`);
    }
  });

  it("POST /api/chat com phone acima de 24 caracteres → 400", async () => {
    // MOTIVO: o `phone` é usado numa consulta à IXC (identificação
    // automática); um valor enorme permite abuso de custo/rate limit.
    const res = await postChat(server.url, { sessionId: "s1", message: "oi", phone: "x".repeat(25) }, APP_TOKEN);
    assert.equal(res.status, 400);
  });

  it("POST /api/chat com phone não-string → 400", async () => {
    const res = await postChat(server.url, { sessionId: "s1", message: "oi", phone: 1234567890 }, APP_TOKEN);
    assert.equal(res.status, 400);
  });

  it("body com array em vez de objeto → tratado sem crash (500)", async () => {
    // MOTIVO: o Express aceita JSON de qualquer tipo raiz. Se o app de um
    // cliente antigo enviasse um array, o servidor deve responder com erro
    // controlado (nunca crashar nem vazar stack trace).
    const res = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-token": APP_TOKEN },
      body: JSON.stringify(["não", "é", "objeto"]),
    });
    assert.ok(res.status === 400 || res.status === 500);
  });
});
