import { ixc, IxcCliente, IxcContrato, IxcFatura, nomeExibicaoCliente } from "../ixc/client";
import { gemini, ClassifyResult, RespostaSimNao } from "../ai/gemini";
import { config } from "../config";
import { PLANOS_URBANOS, PLANOS_WIFI6, FIDELIDADE, recomendarPorAparelhos, BAIRROS_ATENDIDOS } from "../data/planos";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ChatMessage =
  | { type: "text"; text: string }
  | { type: "boleto"; text: string; boletoId?: string; pdfUrl?: string; linhaDigitavel?: string }
  | { type: "menu"; text: string; options: string[] }
  | { type: "end"; text: string };

export interface ChatResponse {
  messages: ChatMessage[];
  state: string;
}

type StateName =
  | "awaiting_phone"
  | "select_contract"
  | "menu"
  | "checklist"
  | "boleto"
  | "desbloqueio"
  | "financeiro"
  | "financeiro_ultimo_boleto"
  | "comercial"
  | "comercial_bairro"
  | "comercial_vencimento"
  | "comercial_indicacao"
  | "encaminhado";

interface Session {
  id: string;
  state: StateName;
  cliente?: IxcCliente;
  contratos: IxcContrato[];
  contrato?: IxcContrato;
  pendencia?: IxcFatura;
  attempts: number;
  checklistStep: number;
  clarificationAsked: boolean;
  comercial: {
    aparelhos?: number;
    bairro?: string;
    cidade?: string;
    vencimento?: string;
    indicacao?: string;
    plano?: string;
  };
  lastActivity: number;
}

interface DemandRecord {
  cliente: string;
  departamento: string;
  tipo: string;
  contexto: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Registro de demandas (em memória + console — PRD FR-13)
// ---------------------------------------------------------------------------

const demandas: DemandRecord[] = [];

function registrarDemanda(cliente: string, departamento: string, tipo: string, contexto: Record<string, unknown>) {
  const record = { cliente, departamento, tipo, contexto, timestamp: new Date().toISOString() };
  demandas.push(record);
  console.log(`[demanda] ${departamento} | ${tipo} | cliente=${cliente} | ${JSON.stringify(contexto)}`);
}

export function listarDemandas(): DemandRecord[] {
  return demandas;
}

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------

const sessions = new Map<string, Session>();
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 2;

function now(): number {
  return Date.now();
}

function fresh(id: string): Session {
  return {
    id,
    // Toda sessão nova começa esperando o cliente digitar o telefone.
    // (Não existe mais "login": a identificação acontece aqui no chat.)
    state: "awaiting_phone",
    contratos: [],
    attempts: 0,
    checklistStep: 0,
    clarificationAsked: false,
    comercial: {},
    lastActivity: now(),
  };
}

function getSession(id: string): Session {
  const s = sessions.get(id);
  if (!s) {
    const created = fresh(id);
    sessions.set(id, created);
    return created;
  }
  if (now() - s.lastActivity > SESSION_TIMEOUT_MS) {
    const reset = fresh(id);
    sessions.set(id, reset);
    return reset;
  }
  s.lastActivity = now();
  return s;
}

function setState(s: Session, state: StateName) {
  s.state = state;
}

// ---------------------------------------------------------------------------
// Textos dos fluxos (voz da marca — Manual de Marca)
// ---------------------------------------------------------------------------

// Pergunta exibida depois das respostas automáticas do financeiro: a decisão
// de voltar ao menu (ou continuar conversando) é sempre do cliente.
const PERGUNTA_POS_FINANCEIRO =
  "Deseja voltar ao menu ou tirar alguma dúvida? Pode falar à vontade.";

// Pergunta feita quando o contrato está com tudo quitado: oferecemos a
// consulta do último boleto (mesmo texto usado como contexto para a IA
// interpretar respostas livres do cliente).
const PERGUNTA_ULTIMO_BOLETO = "Gostaria de consultar o seu último boleto?";

const TEXT = {
  welcome: (nome: string) =>
    `Olá, ${nome}! 👋 Sou o assistente virtual da DBS TELECOM. Como posso ajudar você hoje?`,
  // O menu é a "raiz" do atendimento: não faz sentido oferecer "voltar" —
  // dentro de um fluxo, o comando 0/menu segue disponível como atalho global.
  menuOptions: ["1 - Suporte técnico", "2 - Financeiro", "3 - Comercial"],
  // Pergunta inicial do chat: em vez de login/CPF, pedimos o telefone.
  // O app mostra esse mesmo pedido como primeira mensagem da conversa.
  phonePrompt:
    "Antes de começarmos, me informe o número de telefone cadastrado (com DDD). Ex.: (64) 99999-9999",
  // Cliente digitou algo que não tem 10 ou 11 dígitos → não é um telefone válido.
  phoneInvalid:
    "Hmm, esse número não parece completo. Digite seu telefone com DDD — 10 ou 11 números. 🙂",
  // Telefone válido, mas a IXC não encontrou nenhum cliente com ele.
  phoneNotFound:
    "Não localizei esse número em nosso cadastro. Confira se digitou certo (com DDD) e envie novamente, por favor. 🙏",
  ixcError: "Estou com dificuldade para acessar nossos sistemas no momento. Tente novamente em instantes. 🙏",
  chooseContract: (contratos: IxcContrato[]) =>
    `Identifiquei mais de um contrato ativo em seu nome. Sobre qual deseja falar?\n` +
    contratos.map((c, i) => `${i + 1} - ${c.plano ?? `Contrato ${c.id ?? ""}`}`).join("\n"),
  invalidChoice: "Não entendi essa opção. Digite o número correspondente ou 0 para voltar ao menu.",
  unknown: "Desculpe, não entendi. Posso ajudar com suporte técnico (1), financeiro (2) ou planos (3)?",
  clarify: "Entendi que você precisa de ajuda. Poderia me dizer melhor: é sobre suporte técnico, financeiro ou planos?",
  escalate: (dep: string) =>
    `Atendente de ${dep} irá responder em instantes.`,
  escalatePlantao: (dep: string) =>
    `Atendente de ${dep} irá responder em instantes. Neste momento o plantonista será acionado.`,
  menuBack: "Claro! Como posso ajudar?",
  back: "Sempre que precisar, digite 0 ou 'menu' para voltar às opções.",
  tudoPago:
    "Verifiquei aqui e todas as suas faturas estão quitadas. 😊 " + PERGUNTA_ULTIMO_BOLETO,
  semHistoricoBoletos:
    "Não encontrei boletos emitidos para este contrato. 😊\n\n" + PERGUNTA_POS_FINANCEIRO,
  duvidaFinanceiro: "Claro! Me conta qual é a sua dúvida sobre o financeiro. 🙂",
  desbloqueioOk:
    "Tudo certo! Não encontrei pendências e já solicitei o desbloqueio do seu acesso. Pode testar em instantes. ✅\n\n" +
    PERGUNTA_POS_FINANCEIRO,
  checklist: [
    (q: string) =>
      `Entendi! Vou te ajudar com algumas verificações iniciais. ${q}\nPrimeiro, confirme: o problema de lentidão acontece em mais de um dispositivo conectado (celular, TV, notebook)?`,
    () => "Ok! Verifique se os cabos estão bem conectados no equipamento de conexão (ONT/roteador) e se as luzes estão normais. Confirma que está tudo conectado?",
    () => "Vamos reiniciar o equipamento: desligue o roteador/ONT da tomada, aguarde 30 segundos e ligue novamente. Pode fazer isso agora? (Se estiver em reunião ou não puder no momento, me avise!)",
    () => "Depois de reiniciar, o problema de lentidão continua?",
  ] as ((q?: string) => string)[],
  checklistResolved: "Que ótimo que resolveu! 😊 Se precisar de mais alguma coisa, estou por aqui — digite 0 para voltar ao menu.",
  checklistEscalate: "Mesmo após essas verificações o problema continua. Vou registrar tudo certinho.",
};

function plantonista(): boolean {
  const h = new Date().getHours();
  return h < config.supportStartHour || h >= config.supportEndHour;
}

function escalateText(dep: string): string {
  return plantonista() ? TEXT.escalatePlantao(dep) : TEXT.escalate(dep);
}

// ---------------------------------------------------------------------------
// Utilidades de telefone
// ---------------------------------------------------------------------------

/**
 * Normaliza o texto digitado pelo cliente em um número de telefone brasileiro:
 *  - aceita formatação livre ("(64) 99999-9999", "64 99999-9999",
 *    "+5564999999999"...) e devolve SOMENTE os dígitos;
 *  - remove o código do país ("55") quando ele veio junto;
 *  - considera válido apenas 10 dígitos (fixo) ou 11 (celular).
 * Retorna null quando o texto não vira um telefone válido.
 *
 * Validamos ANTES de chamar a IXC para não gastar requisições externas
 * com qualquer coisa que o cliente digitar.
 */
export function normalizarTelefone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  // Ex.: "+5564999999999" (13 dígitos) → "64999999999" (11 dígitos)
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits.length === 10 || digits.length === 11 ? digits : null;
}

function extractQuantity(text: string): number | null {
  const m = text.replace(",", ".").match(/(\d+)/);
  if (m) return Number(m[0]);
  const t = text.toLowerCase();
  if (/(muito|muitos|bastante|cheio)/.test(t)) return 12;
  if (/(pouco|poucos|só eu|so eu|um só|1 aparelho)/.test(t)) return 1;
  return null;
}

// ---------------------------------------------------------------------------
// Fluxo principal
// ---------------------------------------------------------------------------

export async function handleMessage(sessionId: string, message: string, phone?: string): Promise<ChatResponse> {
  const s = getSession(sessionId);
  const text = message.trim();

  if (s.state !== "awaiting_phone" && isMenuCommand(text)) {
    return backToMenu(s);
  }

  // Enquanto a sessão não identificou o cliente, toda mensagem passa pelo
  // fluxo de identificação por telefone (é o "login" do chat, sem tela).
  if (s.state === "awaiting_phone") {
    return handleIdentificacao(s, text, phone);
  }

  switch (s.state) {
    case "select_contract":
      return handleSelectContract(s, text);
    case "menu":
      return handleMenu(s, text);
    case "checklist":
      return handleChecklist(s, text);
    case "boleto":
      return handleBoleto(s, text);
    case "desbloqueio":
      return handleDesbloqueio(s, text);
    case "financeiro":
      return handleFinanceiroLivre(s, text);
    case "financeiro_ultimo_boleto":
      return handleUltimoBoleto(s, text);
    case "comercial":
      return handleComercial(s, text);
    case "comercial_bairro":
      return handleComercialBairro(s, text);
    case "comercial_vencimento":
      return handleComercialVencimento(s, text);
    case "comercial_indicacao":
      return handleComercialIndicacao(s, text);
    default:
      return backToMenu(s);
  }
}

function isMenuCommand(text: string): boolean {
  const t = text.toLowerCase();
  return t === "0" || t === "menu" || t === "voltar" || t === "início" || t === "inicio";
}

function backToMenu(s: Session): ChatResponse {
  setState(s, "menu");
  s.attempts = 0;
  s.clarificationAsked = false;
  return {
    messages: [{ type: "menu", text: TEXT.menuBack + "\n\n" + TEXT.menuOptions.join("\n"), options: TEXT.menuOptions }],
    state: s.state,
  };
}

// --- Identificação por telefone (substitui o login/CPF) ---------------------

/**
 * Fluxo de identificação da sessão. Acontece em duas etapas:
 *
 * 1. Se o CANAL já entregou o número do cliente (ex.: WhatsApp manda junto),
 *    tentamos identificar automaticamente — o cliente nem precisa digitar.
 * 2. Se não deu certo (ou não veio número do canal), usamos o que o cliente
 *    DIGITOU no chat: validamos, consultamos a IXC e, achando o cadastro,
 *    saudamos pelo nome e seguimos para o menu.
 */
async function handleIdentificacao(s: Session, text: string, phone?: string): Promise<ChatResponse> {
  // Etapa 1 — identificação automática pelo número do canal (se existir).
  if (phone) {
    try {
      const clienteCanal = await ixc.findClienteByTelefone(phone);
      if (clienteCanal?.id) return finalizarIdentificacao(s, clienteCanal);
    } catch (err) {
      // Falha na consulta do canal não derruba o fluxo: seguimos com o
      // que o cliente digitar (etapa 2).
      console.error(`[ixc] erro identificação pelo canal: ${(err as Error).message}`);
    }
  }

  // Etapa 2 — o cliente digitou o telefone no chat.
  const telefone = normalizarTelefone(text);
  if (!telefone) {
    // Texto não parece telefone (10–11 dígitos) → pede de novo.
    return { messages: [{ type: "text", text: TEXT.phoneInvalid }], state: s.state };
  }

  let cliente: IxcCliente | null;
  try {
    // Consulta a IXC: procura o número nas colunas de celular, residencial,
    // comercial, WhatsApp e ramal do cadastro de clientes.
    cliente = await ixc.findClienteByTelefone(telefone);
  } catch (err) {
    console.error(`[ixc] erro identificação por telefone: ${(err as Error).message}`);
    return { messages: [{ type: "text", text: TEXT.ixcError }], state: s.state };
  }

  if (!cliente?.id) {
    // Telefone válido, mas ninguém cadastrado com ele → pede novamente.
    return { messages: [{ type: "text", text: TEXT.phoneNotFound }], state: s.state };
  }

  // Achou! Guarda o cliente na sessão, busca os contratos e saúda pelo nome.
  return finalizarIdentificacao(s, cliente);
}

async function finalizarIdentificacao(s: Session, cliente: IxcCliente): Promise<ChatResponse> {
  s.cliente = cliente;
  try {
    s.contratos = (await ixc.findContratos(cliente.id as number)).filter((c) => String(c.status ?? "A").toUpperCase() === "A");
  } catch (err) {
    console.error(`[ixc] erro contratos: ${(err as Error).message}`);
    s.contratos = [];
  }

  const nome = nomeExibicaoCliente(cliente).split(" ")[0] || "cliente";

  if (s.contratos.length === 0) {
    setState(s, "menu");
    return {
      messages: [
        { type: "text", text: TEXT.welcome(nome) },
        {
          type: "menu",
          text:
            "Identifiquei que você ainda não possui contrato ativo. Posso apresentar nossos planos para você! 😉\n\n" +
            TEXT.menuOptions.join("\n"),
          options: TEXT.menuOptions,
        },
      ],
      state: s.state,
    };
  }

  if (s.contratos.length === 1) {
    s.contrato = s.contratos[0];
    setState(s, "menu");
    return {
      messages: [
        { type: "text", text: TEXT.welcome(nome) },
        { type: "menu", text: TEXT.menuOptions.join("\n"), options: TEXT.menuOptions },
      ],
      state: s.state,
    };
  }

  setState(s, "select_contract");
  return {
    messages: [
      { type: "text", text: TEXT.welcome(nome) },
      { type: "menu", text: TEXT.chooseContract(s.contratos), options: ["1", "2", "3"] },
    ],
    state: s.state,
  };
}

async function handleSelectContract(s: Session, text: string): Promise<ChatResponse> {
  const idx = Number(text) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= s.contratos.length) {
    return { messages: [{ type: "text", text: TEXT.invalidChoice }], state: s.state };
  }
  s.contrato = s.contratos[idx];
  setState(s, "menu");
  return {
    messages: [{ type: "menu", text: TEXT.menuOptions.join("\n"), options: TEXT.menuOptions }],
    state: s.state,
  };
}

// --- Menu / classificação --------------------------------------------------

async function handleMenu(s: Session, text: string): Promise<ChatResponse> {
  if (text === "1") return startChecklist(s);
  if (text === "2") return startFinanceiro(s);
  if (text === "3") return startComercial(s);

  // Mensagem livre → classificação via Gemini (FR-5: sempre IA, nunca fallback estático)
  let result: ClassifyResult;
  try {
    result = await gemini.classify(text);
  } catch (err) {
    console.error(`[gemini] erro classificação: ${(err as Error).message}`);
    return {
      messages: [
        {
          type: "text",
          text:
            "Estou com instabilidade no assistente neste momento. Você pode usar o menu abaixo enquanto isso? 🙏\n\n" +
            TEXT.menuOptions.join("\n"),
        },
      ],
      state: s.state,
    };
  }

  if (result.intent === "menu") return backToMenu(s);

  if (result.intent === "unknown" || result.confidence === "low") {
    if (s.clarificationAsked) {
      s.attempts++;
      if (s.attempts >= MAX_ATTEMPTS) {
        s.clarificationAsked = false;
        s.attempts = 0;
        setState(s, "encaminhado");
        registrarDemanda(nomeExibicaoCliente(s.cliente ?? {}), "Atendimento", "classificação falhou", { tentativas: MAX_ATTEMPTS });
        return { messages: [{ type: "end", text: escalateText("atendimento") }], state: s.state };
      }
    }
    s.clarificationAsked = true;
    return { messages: [{ type: "text", text: TEXT.clarify }], state: s.state };
  }

  s.clarificationAsked = false;
  s.attempts = 0;
  if (result.intent === "suporte") return startChecklist(s);
  if (result.intent === "financeiro") return startFinanceiro(s, result.flow);
  return startComercial(s);
}

// --- Suporte: checklist de lentidão (PRD FR-7) ------------------------------

function startChecklist(s: Session): ChatResponse {
  setState(s, "checklist");
  s.checklistStep = 0;
  s.attempts = 0;
  s.clarificationAsked = false;
  return { messages: [{ type: "text", text: TEXT.checklist[0](nomeExibicaoCliente(s.cliente ?? {})) }], state: s.state };
}

function affirmative(text: string): boolean {
  const t = text.toLowerCase();
  return /^(sim|ok|okay|pode|pode sim|já|ja|feito|tudo certo|continua)/.test(t) && !/(não|nao|nope|nunca)/.test(t);
}

function negative(text: string): boolean {
  const t = text.toLowerCase();
  return /^(não|nao|não posso|nao posso|nope|nunca|nada)/.test(t);
}

/**
 * Perguntas do checklist em linguagem natural, usadas como contexto quando
 * pedimos para a IA interpretar uma resposta livre do cliente.
 */
const PERGUNTAS_CHECKLIST = [
  "O problema de lentidão acontece em mais de um dispositivo conectado (celular, TV, notebook)?",
  "Os cabos estão bem conectados no equipamento (ONT/roteador) e as luzes estão normais?",
  "Você consegue reiniciar o equipamento agora (desligar da tomada por 30 segundos)?",
  "Depois de reiniciar, o problema de lentidão continua?",
] as const;

/**
 * Última instância antes de dizer "não entendi": pergunta à IA se a resposta
 * livre do cliente significa sim ou não PARA A PERGUNTA feita. Falha na IA
 * (sem chave, timeout, resposta ambígua) devolve null e o fluxo segue com o
 * pedido de esclarecimento normal.
 */
async function interpretarComIA(pergunta: string, text: string): Promise<RespostaSimNao | null> {
  try {
    const r = await gemini.interpretarSimNao(pergunta, text);
    return r === "incerto" ? null : r;
  } catch {
    return null;
  }
}

async function handleChecklist(s: Session, text: string): Promise<ChatResponse> {
  const step = s.checklistStep;

  if (step === 0) {
    if (affirmative(text)) {
      s.checklistStep = 1;
      return { messages: [{ type: "text", text: TEXT.checklist[1]() }], state: s.state };
    }
    if (negative(text) || /só|so|apenas|somente/.test(text.toLowerCase())) {
      s.checklistStep = 2;
      return { messages: [{ type: "text", text: TEXT.checklist[2]() }], state: s.state };
    }
    // Resposta livre (ex.: "celular e computador", "é só na TV da sala") → IA decide.
    const ia = await interpretarComIA(PERGUNTAS_CHECKLIST[0], text);
    if (ia === "sim") {
      s.checklistStep = 1;
      return { messages: [{ type: "text", text: TEXT.checklist[1]() }], state: s.state };
    }
    if (ia === "nao") {
      s.checklistStep = 2;
      return { messages: [{ type: "text", text: TEXT.checklist[2]() }], state: s.state };
    }
    return unrecognized(s, "Suporte");
  }

  if (step === 1) {
    if (affirmative(text)) {
      s.checklistStep = 2;
      return { messages: [{ type: "text", text: TEXT.checklist[2]() }], state: s.state };
    }
    if (negative(text)) {
      s.checklistStep = 3;
      return { messages: [{ type: "text", text: TEXT.checklist[3]() }], state: s.state };
    }
    // Ex.: "os cabos tão ok mas a luz vermelha pisca" → IA decide.
    const ia = await interpretarComIA(PERGUNTAS_CHECKLIST[1], text);
    if (ia === "sim") {
      s.checklistStep = 2;
      return { messages: [{ type: "text", text: TEXT.checklist[2]() }], state: s.state };
    }
    if (ia === "nao") {
      s.checklistStep = 3;
      return { messages: [{ type: "text", text: TEXT.checklist[3]() }], state: s.state };
    }
    return unrecognized(s, "Suporte");
  }

  if (step === 2) {
    if (affirmative(text)) {
      s.checklistStep = 3;
      return { messages: [{ type: "text", text: TEXT.checklist[3]() }], state: s.state };
    }
    if (negative(text) || /reuni|trabalho|agora não|agora nao|depois/.test(text.toLowerCase())) {
      s.checklistStep = 3;
      return { messages: [{ type: "text", text: TEXT.checklist[3]() }], state: s.state };
    }
    // Ex.: "já reiniciei ontem à noite", "tô no trabalho agora" → IA decide
    // (qualquer resposta que não seja "reinicieiiii agora mesmo" avança).
    const ia = await interpretarComIA(PERGUNTAS_CHECKLIST[2], text);
    if (ia !== null) {
      s.checklistStep = 3;
      return { messages: [{ type: "text", text: TEXT.checklist[3]() }], state: s.state };
    }
    return unrecognized(s, "Suporte");
  }

  // step 3 — problema continua?
  if (negative(text)) {
    setState(s, "menu");
    s.attempts = 0;
    return { messages: [{ type: "menu", text: TEXT.checklistResolved + "\n\n" + TEXT.menuOptions.join("\n"), options: TEXT.menuOptions }], state: s.state };
  }
  if (affirmative(text)) {
    return escalateTo(s, "Suporte", "lentidão não resolvida", { checklist: "executado, problema continua" });
  }
  // Ex.: "melhorou um pouco mas ainda tá estranho", "às vezes cai" → IA decide.
  const ia = await interpretarComIA(PERGUNTAS_CHECKLIST[3], text);
  if (ia === "sim") {
    return escalateTo(s, "Suporte", "lentidão não resolvida", { checklist: "executado, problema continua" });
  }
  if (ia === "nao") {
    setState(s, "menu");
    s.attempts = 0;
    return { messages: [{ type: "menu", text: TEXT.checklistResolved + "\n\n" + TEXT.menuOptions.join("\n"), options: TEXT.menuOptions }], state: s.state };
  }
  return unrecognized(s, "Suporte");
}

// --- Financeiro: boleto e desbloqueio (PRD FR-9..FR-12) ----------------------

async function startFinanceiro(s: Session, flow: string = "boleto"): Promise<ChatResponse> {
  s.attempts = 0;
  s.clarificationAsked = false;
  if (flow === "desbloqueio") {
    setState(s, "desbloqueio");
    return handleDesbloqueio(s, "");
  }
  setState(s, "boleto");
  return handleBoleto(s, "");
}

async function handleBoleto(s: Session, _text: string): Promise<ChatResponse> {
  if (!s.contrato?.id) {
    return escalateTo(s, "Financeiro", "boleto sem contrato", {});
  }

  let faturas: IxcFatura[];
  try {
    faturas = await ixc.findFaturasEmAberto(s.contrato.id);
  } catch (err) {
    console.error(`[ixc] erro faturas: ${(err as Error).message}`);
    return escalateTo(s, "Financeiro", "erro ao consultar faturas", {});
  }

  if (faturas.length === 0) {
    // Tudo quitado: perguntamos se o cliente deseja consultar o último
    // boleto (ex.: conferir o pagamento do mês anterior).
    setState(s, "financeiro_ultimo_boleto");
    s.attempts = 0;
    return {
      messages: [{ type: "text", text: TEXT.tudoPago }],
      state: s.state,
    };
  }

  const fatura = faturas[0];
  s.pendencia = fatura;

  const detalhesFatura = `Encontrei seu boleto${fatura.valor ? ` no valor de R$ ${fatura.valor}` : ""}${
    fatura.data_vencimento ? ` com vencimento em ${fatura.data_vencimento}` : ""
  }`;

  try {
    const boleto = await ixc.getBoleto(Number(fatura.id));
    setState(s, "menu");
    s.attempts = 0;
    return {
      messages: [
        {
          type: "boleto",
          text: `${detalhesFatura}. Vou disponibilizá-lo para você baixar. 💳`,
          boletoId: String(fatura.id),
          pdfUrl: boleto.pdfUrl,
        },
        { type: "menu", text: TEXT.menuOptions.join("\n"), options: TEXT.menuOptions },
      ],
      state: s.state,
    };
  } catch (err) {
    console.error(`[ixc] erro get_boleto: ${(err as Error).message}`);
    if (fatura.linha_digitavel) {
      setState(s, "menu");
      s.attempts = 0;
      return {
        messages: [
          {
            type: "boleto",
            text: `${detalhesFatura}. Segue o código de barras para você pagar pelo seu banco ou app favorito. 💳`,
            boletoId: String(fatura.id),
            linhaDigitavel: fatura.linha_digitavel,
          },
          { type: "menu", text: TEXT.menuOptions.join("\n"), options: TEXT.menuOptions },
        ],
        state: s.state,
      };
    }
    return escalateTo(s, "Financeiro", "falha ao gerar boleto", {
      valor: fatura.valor,
      vencimento: fatura.data_vencimento,
    });
  }
}

// --- Último boleto: contrato com tudo quitado --------------------------------
//
// Cliente respondeu à pergunta "Gostaria de consultar o seu último boleto?".
// Regras locais resolvem primeiro; resposta livre vai para a IA e, se nem a
// IA souber decidir, vale a régua de esclarecimento/escalonamento padrão.

async function handleUltimoBoleto(s: Session, text: string): Promise<ChatResponse> {
  if (negative(text)) return aposUltimoBoleto(s);

  if (!affirmative(text)) {
    const ia = await interpretarComIA(PERGUNTA_ULTIMO_BOLETO, text);
    if (ia === "nao") return aposUltimoBoleto(s);
    if (ia !== "sim") return unrecognized(s, "Financeiro");
  }

  if (!s.contrato?.id) {
    return escalateTo(s, "Financeiro", "último boleto sem contrato", {});
  }

  let faturas: IxcFatura[];
  try {
    faturas = await ixc.findFaturasContrato(Number(s.contrato.id));
  } catch (err) {
    console.error(`[ixc] erro faturas (último boleto): ${(err as Error).message}`);
    return escalateTo(s, "Financeiro", "erro ao consultar último boleto", {});
  }

  // A IXC já ordena por vencimento desc; reordenamos localmente como garantia
  // e preferimos uma fatura paga (status "R") para não exibir nada em aberto.
  const ordenadas = [...faturas].sort((a, b) =>
    String(b.data_vencimento ?? "").localeCompare(String(a.data_vencimento ?? "")),
  );
  const ultima = ordenadas.find((f) => String(f.status ?? "").toUpperCase() === "R") ?? ordenadas[0];

  if (!ultima?.id) {
    setState(s, "financeiro");
    s.attempts = 0;
    return { messages: [{ type: "text", text: TEXT.semHistoricoBoletos }], state: s.state };
  }

  const detalhes = `Este foi o seu último boleto${ultima.valor ? `, no valor de R$ ${ultima.valor}` : ""}${
    ultima.data_vencimento ? `, com vencimento em ${ultima.data_vencimento}` : ""
  }`;

  try {
    const boleto = await ixc.getBoleto(Number(ultima.id));
    setState(s, "financeiro");
    s.attempts = 0;
    return {
      messages: [
        {
          type: "boleto",
          text: `${detalhes}. Vou disponibilizá-lo para você baixar. 💳`,
          boletoId: String(ultima.id),
          pdfUrl: boleto.pdfUrl,
        },
        { type: "text", text: PERGUNTA_POS_FINANCEIRO },
      ],
      state: s.state,
    };
  } catch (err) {
    console.error(`[ixc] erro get_boleto (último boleto): ${(err as Error).message}`);
    if (ultima.linha_digitavel) {
      setState(s, "financeiro");
      s.attempts = 0;
      return {
        messages: [
          {
            type: "boleto",
            text: `${detalhes}. Segue o código de barras para você conferir ou pagar pelo seu banco. 💳`,
            boletoId: String(ultima.id),
            linhaDigitavel: ultima.linha_digitavel,
          },
          { type: "text", text: PERGUNTA_POS_FINANCEIRO },
        ],
        state: s.state,
      };
    }
    return escalateTo(s, "Financeiro", "falha ao gerar último boleto", {
      valor: ultima.valor,
      vencimento: ultima.data_vencimento,
    });
  }
}

function aposUltimoBoleto(s: Session): ChatResponse {
  setState(s, "financeiro");
  s.attempts = 0;
  return { messages: [{ type: "text", text: TEXT.duvidaFinanceiro }], state: s.state };
}

async function handleDesbloqueio(s: Session, _text: string): Promise<ChatResponse> {
  if (!s.contrato?.id) {
    return escalateTo(s, "Suporte", "desbloqueio sem contrato", {});
  }

  let faturas: IxcFatura[];
  try {
    faturas = await ixc.findFaturasEmAberto(s.contrato.id);
  } catch (err) {
    console.error(`[ixc] erro faturas (desbloqueio): ${(err as Error).message}`);
    return escalateTo(s, "Financeiro", "erro ao consultar pendências", {});
  }

  if (faturas.length > 0) {
    const fatura = faturas[0];
    s.pendencia = fatura;
    const pendenciaTexto = `Identifiquei um boleto pendente no valor de R$ ${fatura.valor ?? "—"}${
      fatura.data_vencimento ? ` com vencimento em ${fatura.data_vencimento}` : ""
    }. O desbloqueio do seu acesso depende do pagamento.`;
    try {
      const boleto = await ixc.getBoleto(Number(fatura.id));
      return {
        messages: [
          {
            type: "boleto",
            text: `${pendenciaTexto} Segue o boleto para você baixar — assim que o pagamento for confirmado, seu acesso é liberado. 💳`,
            boletoId: String(fatura.id),
            pdfUrl: boleto.pdfUrl,
          },
          { type: "menu", text: TEXT.menuOptions.join("\n"), options: TEXT.menuOptions },
        ],
        state: s.state,
      };
    } catch (err) {
      console.error(`[ixc] erro get_boleto (desbloqueio): ${(err as Error).message}`);
      if (fatura.linha_digitavel) {
        return {
          messages: [
            {
              type: "boleto",
              text: `${pendenciaTexto} Segue o código de barras para pagamento — assim que o pagamento for confirmado, seu acesso é liberado. 💳`,
              boletoId: String(fatura.id),
              linhaDigitavel: fatura.linha_digitavel,
            },
            { type: "menu", text: TEXT.menuOptions.join("\n"), options: TEXT.menuOptions },
          ],
          state: s.state,
        };
      }
      return escalateTo(s, "Financeiro", "boleto pendente + falha ao gerar", { valor: fatura.valor });
    }
  }

  // Sem pendência → desbloqueio automático (FR-12)
  try {
    await ixc.desbloquearContrato(Number(s.contrato.id));
    setState(s, "financeiro");
    s.attempts = 0;
    return {
      messages: [{ type: "text", text: TEXT.desbloqueioOk }],
      state: s.state,
    };
  } catch (err) {
    console.error(`[ixc] erro desbloqueio: ${(err as Error).message}`);
    return escalateTo(s, "Suporte", "desbloqueio automático falhou", {});
  }
}

// --- Financeiro livre: pós-resposta automática -------------------------------
//
// Depois de uma resposta automática (sem boletos, desbloqueio concluído etc.)
// o cliente fica em conversa livre: pode pedir o menu ou tirar qualquer
// dúvida — a IA roteia para o departamento certo.

async function handleFinanceiroLivre(s: Session, text: string): Promise<ChatResponse> {
  // Resposta à pergunta "deseja voltar ao menu?".
  if (affirmative(text)) return backToMenu(s);
  if (negative(text)) {
    return { messages: [{ type: "text", text: TEXT.duvidaFinanceiro }], state: s.state };
  }

  let result: ClassifyResult;
  try {
    result = await gemini.classify(text);
  } catch (err) {
    console.error(`[gemini] erro classificação: ${(err as Error).message}`);
    return {
      messages: [
        {
          type: "text",
          text:
            "Estou com instabilidade no assistente neste momento. Você pode usar o menu abaixo enquanto isso? 🙏\n\n" +
            TEXT.menuOptions.join("\n"),
        },
      ],
      state: s.state,
    };
  }

  if (result.intent === "menu") return backToMenu(s);

  if (result.intent === "unknown" || result.confidence === "low") {
    if (s.clarificationAsked) {
      s.attempts++;
      if (s.attempts >= MAX_ATTEMPTS) {
        return escalateTo(s, "Financeiro", "dúvida não compreendida", { duvida: text });
      }
    }
    s.clarificationAsked = true;
    return { messages: [{ type: "text", text: TEXT.clarify }], state: s.state };
  }

  s.clarificationAsked = false;
  s.attempts = 0;
  if (result.intent === "suporte") return startChecklist(s);
  if (result.intent === "comercial") return startComercial(s);

  // Financeiro: dúvidas que vão além de boleto/desbloqueio são registradas e
  // encaminhadas ao atendente do setor.
  return escalateTo(s, "Financeiro", "dúvida do cliente", { duvida: text });
}

// --- Comercial (PRD FR-15..FR-18) --------------------------------------------

function startComercial(s: Session): ChatResponse {
  s.attempts = 0;
  s.clarificationAsked = false;
  setState(s, "comercial");
  const lista = [
    "Temos ótimas opções! Estes são nossos planos urbanos:",
    ...PLANOS_URBANOS.map((p) => `• ${p.nome} ${p.banda} — ${p.valor}${p.obs ? ` (${p.obs})` : ""}`),
    "",
    "E os planos com tecnologia Wi-Fi 6 (mais velocidade e estabilidade para muitos dispositivos):",
    ...PLANOS_WIFI6.map((p) => `• Wi-Fi 6 ${p.banda} — ${p.valor}${p.id === "wifi6-500" ? " (ponto adicional: " + "R$ 19,90" + ")" : ""}`),
    "",
    FIDELIDADE.com,
    FIDELIDADE.sem,
    "",
    "Para eu te recomendar o plano ideal: quantos aparelhos costumam usar a internet na sua casa (celulares, TVs, notebooks etc.)?",
  ];
  return { messages: [{ type: "text", text: lista.join("\n") }], state: s.state };
}

async function handleComercial(s: Session, text: string): Promise<ChatResponse> {
  const qtd = extractQuantity(text);
  if (qtd === null) return unrecognized(s, "Comercial");
  s.comercial.aparelhos = qtd;
  setState(s, "comercial_bairro");
  return {
    messages: [
      { type: "text", text: recomendarPorAparelhos(qtd) },
      { type: "text", text: "Para confirmarmos a disponibilidade do serviço, me informe seu bairro e cidade, por favor." },
    ],
    state: s.state,
  };
}

async function handleComercialBairro(s: Session, text: string): Promise<ChatResponse> {
  const partes = text.split(/[-,]/).map((p) => p.trim());
  const bairro = (partes[0] ?? "").toLowerCase();
  const cidade = partes[1] ?? "";
  s.comercial.bairro = partes[0] ?? text;
  s.comercial.cidade = cidade;

  if (!BAIRROS_ATENDIDOS.some((b) => bairro.includes(b) || b.includes(bairro))) {
    setState(s, "menu");
    return {
      messages: [
        { type: "text", text: "Infelizmente ainda não atendemos nessa região. Mas assim que houver novidade, estaremos por aqui! 😊" },
        { type: "menu", text: TEXT.menuOptions.join("\n"), options: TEXT.menuOptions },
      ],
      state: s.state,
    };
  }

  setState(s, "comercial_vencimento");
  return {
    messages: [
      { type: "text", text: "Maravilha, conseguimos atender sua região! ✅" },
      { type: "text", text: "Qual a melhor data de vencimento para o seu boleto? (Sugestão: dia 10)" },
    ],
    state: s.state,
  };
}

async function handleComercialVencimento(s: Session, text: string): Promise<ChatResponse> {
  const dia = text.replace(/\D/g, "").slice(0, 2);
  if (!dia || Number(dia) < 1 || Number(dia) > 31) return unrecognized(s, "Comercial");
  s.comercial.vencimento = dia;
  setState(s, "comercial_indicacao");
  return {
    messages: [
      { type: "text", text: "Anotado! E tem mais: indicando alguém que também feche com a DBS TELECOM, você ganha 50% de desconto na próxima mensalidade. 🎉 Você teria alguém para indicar?" },
    ],
    state: s.state,
  };
}

async function handleComercialIndicacao(s: Session, text: string): Promise<ChatResponse> {
  const t = text.toLowerCase();
  if (!/(não|nao|ninguém|ninguem|não tenho|nao tenho)/.test(t)) {
    s.comercial.indicacao = text;
  }
  return finalizeComercial(s);
}

function finalizeComercial(s: Session): ChatResponse {
  const nome = nomeExibicaoCliente(s.cliente ?? {});
  const resumo = [
    "Perfeito! Confirme o resumo da sua solicitação:",
    `• Cliente: ${nome}`,
    `• Plano de interesse: a definir com o time comercial`,
    `• Aparelhos: ${s.comercial.aparelhos ?? "—"}`,
    `• Local: ${s.comercial.bairro ?? "—"}${s.comercial.cidade ? `, ${s.comercial.cidade}` : ""}`,
    `• Vencimento preferido: dia ${s.comercial.vencimento ?? "—"}`,
    s.comercial.indicacao ? `• Indicação: ${s.comercial.indicacao}` : "• Indicação: não informada",
  ].join("\n");

  registrarDemanda(nome, "Comercial", "contratação", {
    ...s.comercial,
    plano: s.comercial.plano ?? "a definir",
  });

  setState(s, "encaminhado");
  s.attempts = 0;
  return {
    messages: [
      { type: "text", text: resumo },
      { type: "end", text: "Atendente comercial irá responder em instantes." },
    ],
    state: s.state,
  };
}

// --- Escalonamento ------------------------------------------------------------

function unrecognized(s: Session, departamento: string): ChatResponse {
  s.attempts++;
  if (s.attempts >= MAX_ATTEMPTS) {
    return escalateTo(s, departamento, "respostas não reconhecidas", { tentativas: MAX_ATTEMPTS });
  }
  return {
    messages: [
      {
        type: "text",
        text: "Não entendi bem. Pode responder com sim ou não? Ou digite 0 para voltar ao menu. 🙂",
      },
    ],
    state: s.state,
  };
}

function escalateTo(s: Session, departamento: string, tipo: string, contexto: Record<string, unknown>): ChatResponse {
  registrarDemanda(nomeExibicaoCliente(s.cliente ?? {}), departamento, tipo, contexto);
  setState(s, "encaminhado");
  s.attempts = 0;
  return { messages: [{ type: "end", text: escalateText(departamento) }], state: s.state };
}

export { sessions };