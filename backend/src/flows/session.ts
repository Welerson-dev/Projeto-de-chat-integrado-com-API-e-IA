import { ixc, IxcCliente, nomeExibicaoCliente } from "../ixc/client";
import { gemini } from "../ai/gemini";

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

type State = "awaiting_phone" | "aguardando_solicitacao" | "checklist" | "encaminhado";

interface Session {
  id: string;
  state: State;
  cliente?: IxcCliente;
  contrato?: { id: number };
  checklistStep: number;
  lastActivity: number;
}

// ---------------------------------------------------------------------------
// Sessões em memória
// ---------------------------------------------------------------------------

const sessions = new Map<string, Session>();
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

function getSession(id: string): Session {
  const existing = sessions.get(id);
  if (existing && Date.now() - existing.lastActivity < SESSION_TIMEOUT_MS) {
    existing.lastActivity = Date.now();
    return existing;
  }
  const s: Session = { id, state: "awaiting_phone", checklistStep: 0, lastActivity: Date.now() };
  sessions.set(id, s);
  return s;
}

// ---------------------------------------------------------------------------
// Utilitário: normalizar telefone
// ---------------------------------------------------------------------------

function normalizarTelefone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits.length === 10 || digits.length === 11 ? digits : null;
}

// ---------------------------------------------------------------------------
// Fluxo principal
// ---------------------------------------------------------------------------

export async function handleMessage(sessionId: string, message: string): Promise<ChatResponse> {
  const s = getSession(sessionId);
  const text = message.trim();

  if (s.state === "awaiting_phone") return handlePhone(s, text);
  if (s.state === "aguardando_solicitacao") return handleSolicitacao(s, text);
  if (s.state === "checklist") return handleChecklist(s, text);

  // encaminhado: reinicia sessão
  s.state = "awaiting_phone";
  s.cliente = undefined;
  s.contrato = undefined;
  s.checklistStep = 0;
  return { messages: [{ type: "text", text: "Sessão encerrada. Para um novo atendimento, informe seu telefone com DDD." }], state: s.state };
}

// ---------------------------------------------------------------------------
// 1) Identificação pelo telefone
// ---------------------------------------------------------------------------

async function handlePhone(s: Session, text: string): Promise<ChatResponse> {
  const telefone = normalizarTelefone(text);
  if (!telefone) {
    return {
      messages: [{ type: "text", text: "Hmm, esse número não parece completo. Digite seu telefone com DDD (10 ou 11 dígitos). 🙂" }],
      state: s.state,
    };
  }

  let cliente: IxcCliente | null;
  try {
    cliente = await ixc.findClienteByTelefone(telefone);
  } catch {
    return {
      messages: [{ type: "text", text: "Estou com dificuldade para acessar nossos sistemas. Tente novamente em instantes. 🙏" }],
      state: s.state,
    };
  }

  if (!cliente?.id) {
    return {
      messages: [{ type: "text", text: "Não localizei esse número em nosso cadastro. Confira se digitou certo (com DDD) e tente novamente. 🙏" }],
      state: s.state,
    };
  }

  // Cliente encontrado!
  s.cliente = cliente;

  // Busca contrato ativo
  try {
    const contratos = await ixc.findContratos(cliente.id as number);
    if (contratos.length > 0) s.contrato = { id: contratos[0].id as number };
  } catch {
    // sem contrato, não bloqueia
  }

  const nome = nomeExibicaoCliente(cliente).split(" ")[0] || "cliente";
  s.state = "aguardando_solicitacao";

  return {
    messages: [
      { type: "text", text: `Olá, ${nome}! 👋 Sou o assistente virtual da DBS TELECOM. Como posso ajudar você hoje?` },
    ],
    state: s.state,
  };
}

// ---------------------------------------------------------------------------
// 2) Interpretar solicitação com Gemini
// ---------------------------------------------------------------------------

async function handleSolicitacao(s: Session, text: string): Promise<ChatResponse> {
  const t = text.trim().toLowerCase();
  const nome = nomeExibicaoCliente(s.cliente ?? {}).split(" ")[0] || "cliente";

  // Atalhos numéricos do menu (quando o usuário toca nos botões)
  if (t === "1" || t.startsWith("1 -") || /suporte|técnico|tecnico/.test(t)) {
    s.state = "checklist";
    s.checklistStep = 0;
    return {
      messages: [
        {
          type: "text",
          text: `Entendi, ${nome}! Vou ajudar você com algumas verificações iniciais.\n\nPrimeiro, confirme se o problema acontece em todos os dispositivos conectados à sua rede (celular, TV, notebook etc.)?`,
        },
      ],
      state: s.state,
    };
  }

  if (t === "2" || t.startsWith("2 -") || /financeiro|boleto|fatura|pagamento|2ª via|2a via/.test(t)) {
    return handleBoleto(s, nome);
  }

  if (t === "3" || t.startsWith("3 -") || /comercial|plano|contratar|preço|preco/.test(t)) {
    s.state = "encaminhado";
    return {
      messages: [
        { type: "text", text: `Entendi! Vou encaminhar você para o nosso setor Comercial, ${nome}. Um atendente irá apresentar os planos disponíveis. 😊` },
        { type: "end", text: "Atendente Comercial irá responder em instantes." },
      ],
      state: s.state,
    };
  }

  // Mensagem livre → Gemini classifica
  let result: { intent: string; flow: string };
  try {
    result = await gemini.classify(text);
  } catch {
    return {
      messages: [{ type: "text", text: "Desculpe, tive um problema ao processar sua mensagem. Pode tentar novamente? 🙏" }],
      state: s.state,
    };
  }

  if (result.intent === "suporte") {
    s.state = "checklist";
    s.checklistStep = 0;
    return {
      messages: [
        {
          type: "text",
          text: `Entendi, ${nome}! Vou ajudar você com algumas verificações iniciais.\n\nPrimeiro, confirme se o problema acontece em todos os dispositivos conectados à sua rede (celular, TV, notebook etc.)?`,
        },
      ],
      state: s.state,
    };
  }

  if (result.intent === "financeiro") {
    return handleBoleto(s, nome);
  }

  if (result.intent === "comercial") {
    s.state = "encaminhado";
    return {
      messages: [
        { type: "text", text: `Entendi! Vou encaminhar você para o nosso setor Comercial, ${nome}. Um atendente irá apresentar os planos disponíveis. 😊` },
        { type: "end", text: "Atendente Comercial irá responder em instantes." },
      ],
      state: s.state,
    };
  }

  // Intenção não identificada → Gemini tenta responder naturalmente
  // e oferece o menu como fallback uma única vez
  try {
    const aiReply = await gemini.reply(
      "O cliente está conversando com o assistente virtual da DBS TELECOM. Você pode ajudar com suporte técnico, financeiro (boleto) ou comercial (planos). Se não conseguir ajudar, oriente o cliente a escolher uma das opções.",
      text,
    );
    return {
      messages: [
        { type: "text", text: aiReply },
        {
          type: "menu",
          text: "Ou escolha diretamente:\n\n1 - Suporte técnico\n2 - Financeiro (boleto)\n3 - Comercial (planos)",
          options: ["1 - Suporte técnico", "2 - Financeiro", "3 - Comercial"],
        },
      ],
      state: s.state,
    };
  } catch {
    return {
      messages: [
        {
          type: "menu",
          text: "Posso ajudar com:\n\n1 - Suporte técnico\n2 - Financeiro (boleto)\n3 - Comercial (planos)\n\nQual seria?",
          options: ["1 - Suporte técnico", "2 - Financeiro", "3 - Comercial"],
        },
      ],
      state: s.state,
    };
  }
}


// ---------------------------------------------------------------------------
// 3) Financeiro: busca boleto na IXC
// ---------------------------------------------------------------------------

async function handleBoleto(s: Session, nome: string): Promise<ChatResponse> {
  if (!s.contrato?.id) {
    s.state = "encaminhado";
    return {
      messages: [
        { type: "text", text: "Não encontrei um contrato ativo para encaminhar o boleto. Vou acionar nosso time financeiro para te ajudar." },
        { type: "end", text: "Atendente Financeiro irá responder em instantes." },
      ],
      state: s.state,
    };
  }

  let faturas;
  try {
    faturas = await ixc.findFaturasEmAberto(s.contrato.id);
  } catch {
    s.state = "encaminhado";
    return {
      messages: [
        { type: "text", text: "Não consegui acessar as faturas agora. Vou acionar nosso time financeiro." },
        { type: "end", text: "Atendente Financeiro irá responder em instantes." },
      ],
      state: s.state,
    };
  }

  if (faturas.length === 0) {
    s.state = "aguardando_solicitacao";
    return {
      messages: [{ type: "text", text: `Verifiquei aqui e todas as suas faturas estão quitadas, ${nome}! 😊 Posso ajudar com mais alguma coisa?` }],
      state: s.state,
    };
  }

  const fatura = faturas[0];
  const detalhes = `Encontrei seu boleto${fatura.valor ? ` no valor de R$ ${fatura.valor}` : ""}${fatura.data_vencimento ? ` com vencimento em ${fatura.data_vencimento}` : ""}`;

  // Tenta gerar PDF
  try {
    const boleto = await ixc.getBoleto(Number(fatura.id));
    s.state = "aguardando_solicitacao";
    return {
      messages: [
        {
          type: "boleto",
          text: `Claro, ${nome}! Vou consultar seus dados.\n\n${detalhes}. Disponibilizando para você. 💳`,
          boletoId: String(fatura.id),
          pdfUrl: boleto.pdfUrl,
        },
      ],
      state: s.state,
    };
  } catch {
    // Fallback: linha digitável direto da fatura
    if (fatura.linha_digitavel) {
      s.state = "aguardando_solicitacao";
      return {
        messages: [
          {
            type: "boleto",
            text: `Claro, ${nome}! ${detalhes}. Segue o código de barras para pagar pelo seu banco. 💳`,
            boletoId: String(fatura.id),
            linhaDigitavel: String(fatura.linha_digitavel),
          },
        ],
        state: s.state,
      };
    }

    s.state = "encaminhado";
    return {
      messages: [
        { type: "text", text: `Encontrei uma fatura pendente mas não consegui gerar o boleto agora. Vou acionar nosso time financeiro.` },
        { type: "end", text: "Atendente Financeiro irá responder em instantes." },
      ],
      state: s.state,
    };
  }
}

// ---------------------------------------------------------------------------
// 4) Checklist de suporte (internet lenta)
// ---------------------------------------------------------------------------

const PERGUNTAS = [
  "O problema acontece em todos os dispositivos conectados à sua rede (celular, TV, notebook)?",
  "Verifique se os cabos estão bem conectados no roteador/ONT e se as luzes estão normais. Está tudo conectado?",
  "Tente reiniciar o equipamento: desligue da tomada, aguarde 30 segundos e ligue novamente. Consegue fazer isso agora?",
  "Após reiniciar, o problema de lentidão continua?",
];

async function handleChecklist(s: Session, text: string): Promise<ChatResponse> {
  const step = s.checklistStep;

  // Usa IA para interpretar sim/não
  let interpretado: "sim" | "nao" | "incerto" = "incerto";
  try {
    interpretado = await gemini.interpretarSimNao(PERGUNTAS[step], text);
  } catch {
    // sem IA, tenta heurística simples
    const t = text.toLowerCase();
    if (/^(sim|ok|s|yes|pode|ja|já|feito|confirm|tudo|normal|continua)/.test(t)) interpretado = "sim";
    else if (/^(não|nao|n|no|nope|nada|resolv)/.test(t)) interpretado = "nao";
  }

  // Última pergunta: "o problema continua?"
  if (step === 3) {
    if (interpretado === "nao") {
      s.state = "aguardando_solicitacao";
      s.checklistStep = 0;
      return {
        messages: [{ type: "text", text: "Que ótimo que resolveu! 😊 Fico feliz em ter ajudado. Posso ajudar com mais alguma coisa?" }],
        state: s.state,
      };
    }
    if (interpretado === "sim") {
      return escalate(s, "Suporte");
    }
    // incerto → encaminha de qualquer forma após esta última tentativa
    return escalate(s, "Suporte");
  }

  // Passos 0, 1, 2
  if (interpretado === "incerto") {
    return {
      messages: [{ type: "text", text: `Não entendi bem. Pode responder com sim ou não? 🙂\n\n${PERGUNTAS[step]}` }],
      state: s.state,
    };
  }

  // Avança para próxima pergunta
  s.checklistStep += 1;
  return {
    messages: [{ type: "text", text: PERGUNTAS[s.checklistStep] }],
    state: s.state,
  };
}

function escalate(s: Session, departamento: string): ChatResponse {
  s.state = "encaminhado";
  s.checklistStep = 0;
  return {
    messages: [
      { type: "text", text: "Mesmo após essas verificações o problema persiste. Vou registrar tudo e encaminhar para nossa equipe." },
      { type: "end", text: `Atendente de ${departamento} irá responder em instantes.` },
    ],
    state: s.state,
  };
}

export { sessions };
export { normalizarTelefone };