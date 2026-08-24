import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  stubExternalServices,
  setFakeGeminiReply,
  postChat,
  APP_TOKEN,
  fakeIxcData,
  TestServer,
} from "./helpers";

/**
 * ============================================================================
 * CHECKLIST DE LENTIDÃO COM INTERPRETAÇÃO POR IA
 * ============================================================================
 *
 * MOTIVO: as respostas do cliente no checklist eram interpretadas só por
 * regras fixas (tinham que começar com "sim", "não", "só"...). Quando o
 * cliente respondia com linguagem natural — ex.: "celular e computador"
 * para a pergunta "acontece em mais de um dispositivo?" — o bot dizia que
 * não entendeu.
 *
 * SOLUÇÃO: regras fixas continuam sendo o caminho rápido; se nenhuma casa,
 * o backend pergunta à IA (Gemini) se a resposta livre significa sim ou não
 * PARA A PERGUNTA da etapa. Aqui simulamos as respostas da IA para testar
 * os dois caminhos sem chamar a API real.
 * ============================================================================
 */

/** Identifica o cliente e entra no fluxo de suporte → checklist. */
async function irParaChecklist(server: TestServer, sessionId: string): Promise<void> {
  fakeIxcData.cliente = [{ id: 2270, nome: "Teste Wbrnet", telefone_celular: "(11) 98765-4321" }];
  fakeIxcData.contratos = [{ id: 100, id_cliente: 2270, status: "A", plano: "Velocidade 300M" }];
  fakeIxcData.faturas = [];
  await postChat(server.url, { sessionId, message: "(11) 98765-4321" }, APP_TOKEN);
  // A IA classifica a mensagem livre; aqui ela manda para suporte/lentidão.
  setFakeGeminiReply('{"intent":"suporte","flow":"lentidao","confidence":"high"}');
  try {
    const res = await postChat(server.url, { sessionId, message: "minha internet está lenta" }, APP_TOKEN);
    const body = await res.json();
    assert.equal(body.state, "checklist");
  } finally {
    setFakeGeminiReply(null);
  }
}

describe("Checklist de lentidão interpretado por IA", () => {
  let server: TestServer;

  before(async () => {
    stubExternalServices();
    server = await startServer();
  });

  after(() => server.close());

  it('resposta livre "celular e computador" com IA dizendo sim → avança para verificação de cabos', async () => {
    await irParaChecklist(server, "ia1");
    setFakeGeminiReply('{"resposta":"sim"}');
    try {
      const res = await postChat(server.url, { sessionId: "ia1", message: "celular e computador" }, APP_TOKEN);
      const body = await res.json();
      const text = JSON.stringify(body.messages ?? []);
      assert.ok(text.includes("cabos"), `esperava passo dos cabos, veio: ${text}`);
    } finally {
      setFakeGeminiReply(null);
    }
  });

  it("IA interpreta como não → pula direto para o reinício do equipamento", async () => {
    await irParaChecklist(server, "ia2");
    setFakeGeminiReply('{"resposta":"nao"}');
    try {
      const res = await postChat(server.url, { sessionId: "ia2", message: "é na tv e no notebook" }, APP_TOKEN);
      const body = await res.json();
      const text = JSON.stringify(body.messages ?? []);
      assert.ok(text.includes("reiniciar"), `esperava passo do reinício, veio: ${text}`);
    } finally {
      setFakeGeminiReply(null);
    }
  });

  it('regra fixa ainda resolve antes da IA ("só no meu celular" não gasta chamada)', async () => {
    await irParaChecklist(server, "ia3");
    // Se a IA fosse chamada, responderia "sim" (passo dos cabos) — mas a
    // regra local /só|apenas/ deve vencer e pular para o reinício.
    setFakeGeminiReply('{"resposta":"sim"}');
    try {
      const res = await postChat(server.url, { sessionId: "ia3", message: "só no meu celular" }, APP_TOKEN);
      const body = await res.json();
      const text = JSON.stringify(body.messages ?? []);
      assert.ok(text.includes("reiniciar"), `esperava passo do reinício, veio: ${text}`);
    } finally {
      setFakeGeminiReply(null);
    }
  });

  it("IA incerta → bot pede esclarecimento (sim ou não)", async () => {
    await irParaChecklist(server, "ia4");
    const res = await postChat(server.url, { sessionId: "ia4", message: "sei lá, acho que talvez" }, APP_TOKEN);
    const body = await res.json();
    const text = JSON.stringify(body.messages ?? []);
    assert.ok(text.includes("Não entendi bem"), `esperava pedido de esclarecimento, veio: ${text}`);
    assert.equal(body.state, "checklist");
  });
});
