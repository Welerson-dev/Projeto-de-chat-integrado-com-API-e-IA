import { config } from "../config";

export type Intent = "suporte" | "financeiro" | "comercial" | "menu" | "unknown";
export type FlowIntent = "lentidao" | "boleto" | "desbloqueio" | "contratar" | "outro";

export interface ClassifyResult {
  intent: Intent;
  flow: FlowIntent;
  confidence: "high" | "low";
}

export type RespostaSimNao = "sim" | "nao" | "incerto";

const CLASSIFY_PROMPT = `Você é o classificador de intenção do assistente virtual da DBS TELECOM (provedora de internet).
Classifique a mensagem do cliente em UM departamento e UM fluxo.

Departamentos:
- suporte: problemas técnicos com a internet/equipamento.
- financeiro: boletos, pagamentos, pendências, desbloqueio por inadimplência.
- comercial: contratar plano, mudar plano, preços, planos disponíveis.
- menu: o cliente pede para voltar ao menu (digita 0, menu, voltar).
- unknown: não dá para classificar com segurança.

Fluxos (dentro do departamento):
- lentidao (suporte): internet lenta.
- boleto (financeiro): quer o boleto/2ª via.
- desbloqueio (financeiro): quer desbloquear o acesso.
- contratar (comercial): quer contratar ou mudar de plano.
- outro: qualquer outra coisa.

Responda APENAS com JSON: {"intent":"...","flow":"...","confidence":"high"|"low"}`;

const REPLY_PROMPT = (context: string) => `Você é o assistente virtual da DBS TELECOM.
Voz da marca: clara, confiável e próxima; objetiva, educada e empática.
Atendimento: cordial, resolutivo e empático. Orientações técnicas: didáticas, objetivas e educadas.
NUNCA invente dados do cliente; NUNCA prometa valores que não estejam na mensagem do sistema.
Responda com 1 ou 2 frases curtas.

Contexto do fluxo (informação do sistema — use isso para responder):
${context}

Mensagem do cliente:`;

export class GeminiClient {
  private key: string;
  private model: string;

  constructor() {
    this.key = config.geminiApiKey;
    this.model = config.geminiModel;
  }

  private async generate(prompt: string, system?: string): Promise<string> {
    if (!this.key) {
      throw new Error("GEMINI_API_KEY não configurada (ver .env)");
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`;
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Modelos Gemini 3 "pensam" antes de responder e esse raciocínio
      // consome do mesmo teto de tokens — por isso thinkingLevel "low"
      // (mais rápido) e um teto folgado para a resposta não ser cortada.
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "low" },
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    // A API do Gemini pode falhar de forma transitória (429 limite de uso,
    // 5xx alta demanda). Tentamos 2 vezes com uma pequena pausa entre elas.
    let ultimoErro = "";
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sem isso a requisição sai vazia e a API responde 400
        // "contents is not specified".
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      }
      ultimoErro = `Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      const transitorio = res.status === 429 || res.status >= 500;
      if (!transitorio || tentativa === 2) break;
      await new Promise((r) => setTimeout(r, 1200));
    }
    throw new Error(ultimoErro);
  }

  async classify(message: string): Promise<ClassifyResult> {
    const raw = await this.generate(CLASSIFY_PROMPT + `\nMensagem: "${message}"`);
    const json = this.extractJson(raw);
    const intent: Intent = (["suporte", "financeiro", "comercial", "menu", "unknown"] as const).includes(
      json.intent as Intent,
    )
      ? (json.intent as Intent)
      : "unknown";
    const flow: FlowIntent = (["lentidao", "boleto", "desbloqueio", "contratar", "outro"] as const).includes(
      json.flow as FlowIntent,
    )
      ? (json.flow as FlowIntent)
      : "outro";
    return { intent, flow, confidence: json.confidence === "high" ? "high" : "low" };
  }

  /**
   * Interpreta uma resposta livre do cliente para uma pergunta de sim/não
   * do checklist (ex.: "celular e computador" para "acontece em mais de um
   * dispositivo?" → sim). Usamos como fallback quando as regras locais
   * não reconhecem a resposta. "incerto" = a IA não soube decidir.
   */
  async interpretarSimNao(pergunta: string, resposta: string): Promise<RespostaSimNao> {
    const prompt = `Você interpreta respostas de clientes de um chatbot de suporte.
Dada a PERGUNTA que o assistente fez e a RESPOSTA livre do cliente, decida se a resposta significa SIM ou NÃO para a pergunta.

Regras:
- Considere o contexto e o bom senso (ex.: para "o problema acontece em mais de um dispositivo?", responder "celular e computador" significa SIM; "só no meu celular" significa NÃO).
- Se a resposta não responder à pergunta ou for ambígua demais, responda "incerto".

PERGUNTA: "${pergunta}"
RESPOSTA DO CLIENTE: "${resposta}"

Responda APENAS com JSON: {"resposta":"sim"|"nao"|"incerto"}`;
    const raw = await this.generate(prompt);
    const json = this.extractJson(raw);
    return json.resposta === "sim" || json.resposta === "nao" ? json.resposta : "incerto";
  }

  async reply(context: string, message: string): Promise<string> {
    return this.generate(REPLY_PROMPT(context) + `\n"${message}"`);
  }

  private extractJson(raw: string): { intent?: string; flow?: string; confidence?: string; resposta?: string } {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return {};
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

export const gemini = new GeminiClient();