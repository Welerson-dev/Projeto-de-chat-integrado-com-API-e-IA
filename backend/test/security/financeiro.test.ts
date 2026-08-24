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
 * FINANCEIRO — BOLETO CONSULTADO NA IXC
 * ============================================================================
 *
 * MOTIVO: quando o cliente aciona o financeiro e NÃO há nenhuma fatura em
 * aberto (tudo pago), o bot encerrava a conversa dizendo apenas que não
 * havia boletos. O cliente que quer conferir o pagamento do mês anterior
 * ficava sem opção.
 *
 * SOLUÇÃO: com tudo quitado, o bot pergunta se o cliente deseja consultar o
 * ÚLTIMO boleto; respondendo sim, ele busca a fatura mais recente na IXC e
 * entrega o PDF (ou, no demo sem get_boleto, a linha digitável).
 *
 * Bônus verificado aqui: o menu principal não oferece mais "0 - Voltar ao
 * menu" — na abertura do chat não existe de onde voltar (o comando 0 segue
 * funcionando como atalho global dentro dos fluxos).
 * ============================================================================
 */

const CLIENTE = { id: 2270, nome: "Teste Wbrnet", telefone_celular: "(11) 98765-4321" };
const CONTRATO = { id: 100, id_cliente: 2270, status: "A", plano: "Velocidade 300M" };

const FATURA_PAGA = {
  id: 501,
  id_contrato: 100,
  status: "R",
  valor: "99.90",
  data_vencimento: "2026-07-10",
  linha_digitavel: "34191090000000009990109876543210000000501230",
};

async function identificar(server: TestServer, sessionId: string): Promise<void> {
  const res = await postChat(server.url, { sessionId, message: "(11) 98765-4321" }, APP_TOKEN);
  const body = await res.json();
  assert.equal(body.state, "menu");
}

describe("Financeiro — consulta de boleto na IXC", () => {
  let server: TestServer;

  before(async () => {
    stubExternalServices();
    server = await startServer();
    fakeIxcData.cliente = [CLIENTE];
    fakeIxcData.contratos = [CONTRATO];
  });

  after(() => {
    delete fakeIxcData.boleto;
    server.close();
  });

  it("menu inicial após identificação não mostra a opção 0 - Voltar ao menu", async () => {
    fakeIxcData.faturas = [];
    await identificar(server, "fin-menu");
    const res = await postChat(server.url, { sessionId: "fin-menu", message: "menu" }, APP_TOKEN);
    const body = await res.json();
    const menu = body.messages.find((m: { type: string }) => m.type === "menu");
    assert.ok(menu, "esperava uma mensagem de menu");
    assert.ok(
      !JSON.stringify(body.messages).includes("Voltar ao menu"),
      `menu não deveria oferecer "Voltar ao menu": ${JSON.stringify(body.messages)}`,
    );
    assert.equal(menu.options.length, 3);
  });

  it("tudo pago → bot pergunta se o cliente deseja consultar o último boleto", async () => {
    fakeIxcData.faturas = [FATURA_PAGA];
    await identificar(server, "fin-pago");
    const res = await postChat(server.url, { sessionId: "fin-pago", message: "2" }, APP_TOKEN);
    const body = await res.json();
    assert.equal(body.state, "financeiro_ultimo_boleto");
    const text = JSON.stringify(body.messages);
    assert.ok(text.includes("último boleto"), `esperava pergunta sobre o último boleto, veio: ${text}`);
  });

  it('resposta "sim" → entrega o último boleto com PDF disponível para download', async () => {
    fakeIxcData.faturas = [FATURA_PAGA];
    fakeIxcData.boleto = { base64: Buffer.from("%PDF-1.4 boleto de teste").toString("base64") };
    try {
      await identificar(server, "fin-sim-pdf");
      await postChat(server.url, { sessionId: "fin-sim-pdf", message: "2" }, APP_TOKEN);
      const res = await postChat(server.url, { sessionId: "fin-sim-pdf", message: "sim" }, APP_TOKEN);
      const body = await res.json();
      const boleto = body.messages.find((m: { type: string }) => m.type === "boleto");
      assert.ok(boleto, `esperava mensagem de boleto, veio: ${JSON.stringify(body.messages)}`);
      assert.equal(boleto.boletoId, String(FATURA_PAGA.id));
      assert.ok(boleto.text.includes("último boleto"), `texto deveria citar o último boleto: ${boleto.text}`);

      const dl = await fetch(`${server.url}/api/boleto/${FATURA_PAGA.id}`, {
        headers: { "x-app-token": APP_TOKEN },
      });
      assert.equal(dl.status, 200);
      assert.ok(
        (dl.headers.get("content-type") ?? "").includes("application/pdf"),
        "download deveria devolver um PDF",
      );
    } finally {
      delete fakeIxcData.boleto;
    }
  });

  it('sem ação get_boleto (demo) → "sim" entrega a linha digitável do último boleto', async () => {
    fakeIxcData.faturas = [FATURA_PAGA];
    await identificar(server, "fin-sim-linha");
    await postChat(server.url, { sessionId: "fin-sim-linha", message: "2" }, APP_TOKEN);
    setFakeGeminiReply('{"resposta":"sim"}');
    let res: Response;
    try {
      res = await postChat(server.url, { sessionId: "fin-sim-linha", message: "quero sim" }, APP_TOKEN);
    } finally {
      setFakeGeminiReply(null);
    }
    const body = await res.json();
    const boleto = body.messages.find((m: { type: string }) => m.type === "boleto");
    assert.ok(boleto, `esperava mensagem de boleto, veio: ${JSON.stringify(body.messages)}`);
    assert.equal(boleto.boletoId, String(FATURA_PAGA.id));
    assert.equal(boleto.linhaDigitavel, FATURA_PAGA.linha_digitavel);
  });

  it('resposta "não" → segue na conversa livre do financeiro', async () => {
    fakeIxcData.faturas = [FATURA_PAGA];
    await identificar(server, "fin-nao");
    await postChat(server.url, { sessionId: "fin-nao", message: "2" }, APP_TOKEN);
    const res = await postChat(server.url, { sessionId: "fin-nao", message: "não" }, APP_TOKEN);
    const body = await res.json();
    assert.equal(body.state, "financeiro");
    assert.ok(JSON.stringify(body.messages).includes("dúvida"));
  });

  it("com fatura em aberto → comportamento atual: oferece a 2ª via diretamente", async () => {
    fakeIxcData.faturas = [
      {
        id: 502,
        id_contrato: 100,
        status: "A",
        valor: "109.90",
        data_vencimento: "2026-08-10",
        linha_digitavel: "34191090000000010990109876543210000000502230",
      },
    ];
    await identificar(server, "fin-aberta");
    const res = await postChat(server.url, { sessionId: "fin-aberta", message: "2" }, APP_TOKEN);
    const body = await res.json();
    const boleto = body.messages.find((m: { type: string }) => m.type === "boleto");
    assert.ok(boleto, `esperava oferta da 2ª via, veio: ${JSON.stringify(body.messages)}`);
    assert.equal(boleto.boletoId, "502");
    assert.notEqual(body.state, "financeiro_ultimo_boleto");
  });
});
