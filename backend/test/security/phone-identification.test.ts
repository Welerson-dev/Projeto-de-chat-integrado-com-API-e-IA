import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stubExternalServices, postChat, APP_TOKEN, fakeIxcData, TestServer } from "./helpers";

/**
 * ============================================================================
 * IDENTIFICAÇÃO POR TELEFONE NO CHAT (sem login)
 * ============================================================================
 *
 * MOTIVO: não existe mais tela de login nem pedido de CPF/CNPJ. O app abre
 * o chat e o bot pede o telefone; ao receber um número válido, o backend
 * consulta a IXC (tabela `cliente`, colunas de telefone) e, se encontrar,
 * saúda o cliente pelo nome e segue para o menu.
 *
 * TERMOS:
 * - "phone" = número opcional enviado pelo canal no body de /api/chat
 *   (ex.: WhatsApp); permite identificação sem o cliente digitar.
 * - "awaiting_phone" = estado inicial da sessão (aguardando o telefone).
 * ============================================================================
 */
describe("Identificação por telefone no chat", () => {
  let server: TestServer;

  before(async () => {
    stubExternalServices();
    server = await startServer();
  });

  after(() => server.close());

  it("cliente digita o telefone cadastrado → saúda pelo nome e vai ao menu", async () => {
    fakeIxcData.cliente = [{ id: 2270, nome: "Teste Wbrnet", telefone_celular: "(11) 98765-4321" }];
    fakeIxcData.contratos = [{ id: 100, id_cliente: 2270, status: "A", plano: "Velocidade 300M" }];
    fakeIxcData.faturas = [];

    const res = await postChat(server.url, { sessionId: "tel1", message: "(11) 98765-4321" }, APP_TOKEN);
    assert.equal(res.status, 200);
    const body = await res.json();
    const text = JSON.stringify(body.messages ?? []);
    assert.ok(text.includes("Olá, Teste!"), `esperava saudação pelo nome, veio: ${text}`);
    assert.equal(body.state, "menu");
  });

  it("telefone não cadastrado → bot pede o número novamente", async () => {
    fakeIxcData.cliente = [];
    const res = await postChat(server.url, { sessionId: "tel2", message: "11999999999" }, APP_TOKEN);
    assert.equal(res.status, 200);
    const body = await res.json();
    const text = JSON.stringify(body.messages ?? []);
    assert.ok(text.includes("Não localizei esse número"), `esperava aviso de não encontrado, veio: ${text}`);
    assert.equal(body.state, "awaiting_phone");
  });

  it("texto que não é telefone → avisa que o número é inválido e continua aguardando", async () => {
    fakeIxcData.cliente = [];
    const res = await postChat(server.url, { sessionId: "tel3", message: "oi tudo bem" }, APP_TOKEN);
    assert.equal(res.status, 200);
    const body = await res.json();
    const text = JSON.stringify(body.messages ?? []);
    assert.ok(text.includes("não parece completo"), `esperava aviso de número inválido, veio: ${text}`);
    assert.equal(body.state, "awaiting_phone");
  });

  it("phone do canal identifica automaticamente (sem o cliente digitar)", async () => {
    fakeIxcData.cliente = [{ id: 2270, nome: "Teste Wbrnet", telefone_celular: "11987654321" }];
    fakeIxcData.contratos = [{ id: 100, id_cliente: 2270, status: "A", plano: "Velocidade 300M" }];

    const res = await postChat(server.url, { sessionId: "tel4", message: "oi", phone: "11987654321" }, APP_TOKEN);
    assert.equal(res.status, 200);
    const body = await res.json();
    const text = JSON.stringify(body.messages ?? []);
    assert.ok(text.includes("Olá, Teste!"), `esperava saudação pelo nome, veio: ${text}`);
    assert.equal(body.state, "menu");
  });
});
