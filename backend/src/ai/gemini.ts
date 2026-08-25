import { config } from "../config";

export type Intent = "suporte" | "financeiro" | "comercial" | "unknown";

export interface ClassifyResult {
  intent: Intent;
  flow: string;
  confidence: "high" | "low";
}

export type RespostaSimNao = "sim" | "nao" | "incerto";

const CLASSIFY_PROMPT = `Você é o classificador de intenção do assistente virtual da DBS TELECOM (provedora de internet).
Analise a mensagem do cliente e classifique em UM dos departamentos abaixo.

Departamentos:
- suporte: problemas técnicos (internet lenta, sem conexão, queda, instabilidade, reinicializar, roteador, sinal, etc.)
- financeiro: boleto, pagamento, fatura, 2ª via, vencimento, débito, pendência, valor.
- comercial: contratar plano, mudar plano, preços, planos disponíveis, upgrade, internet nova.
- unknown: não está relacionado a nenhum dos departamentos acima.

Fluxo (só para suporte):
- lentidao: internet lenta, devagar, travando, baixa velocidade.
- outro: qualquer outro problema técnico.

Responda APENAS com JSON: {"intent":"...","flow":"lentidao"|"outro","confidence":"high"|"low"}`;

const REPLY_PROMPT = (context: string) => `Você é o assistente virtual da DBS TELECOM.
Seja objetivo, cordial e empático. Responda em 1 ou 2 frases curtas.

Contexto: ${context}

Mensagem do cliente:`;

export class GeminiClient {
  private key: string;
  private model: string;

  constructor() {
    this.key = config.geminiApiKey;
    this.model = config.geminiModel;
  }

  private async generate(prompt: string, system?: string): Promise<string> {
    if (!this.key) throw new Error("GEMINI_API_KEY não configurada");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`;
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      }

      lastError = `Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.status !== 429 && res.status < 500) break;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
    }
    throw new Error(lastError);
  }

  async classify(message: string): Promise<ClassifyResult> {
    const raw = await this.generate(`${CLASSIFY_PROMPT}\n\nMensagem: "${message}"`);
    const json = this.extractJson(raw);

    const intent: Intent = (["suporte", "financeiro", "comercial", "unknown"] as const).includes(json.intent as Intent)
      ? (json.intent as Intent)
      : "unknown";

    return {
      intent,
      flow: json.flow ?? "outro",
      confidence: json.confidence === "high" ? "high" : "low",
    };
  }

  async interpretarSimNao(pergunta: string, resposta: string): Promise<RespostaSimNao> {
    const prompt = `Dada a PERGUNTA e a RESPOSTA do cliente, decida se a resposta significa SIM ou NÃO.
Se ambíguo ou sem relação, responda "incerto".

PERGUNTA: "${pergunta}"
RESPOSTA: "${resposta}"

Responda APENAS com JSON: {"resposta":"sim"|"nao"|"incerto"}`;

    const raw = await this.generate(prompt);
    const json = this.extractJson(raw);
    return json.resposta === "sim" || json.resposta === "nao" ? json.resposta : "incerto";
  }

  async reply(context: string, message: string): Promise<string> {
    return this.generate(`${REPLY_PROMPT(context)}\n"${message}"`);
  }

  private extractJson(raw: string): Record<string, string> {
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