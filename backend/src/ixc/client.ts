import { config } from "../config";

export interface IxcError extends Error {
  status?: number;
  ixcData?: unknown;
}

export class IxcClient {
  private base: string;
  private auth: string;

  constructor() {
    this.base = `${config.ixcUrl}/webservice/v1`;
    this.auth = "Basic " + Buffer.from(config.ixcToken, "utf8").toString("base64");
  }

  private async request<T>(path: string, opts: { method?: string; form?: Record<string, string>; json?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: this.auth };
    let body: string | undefined;
    if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    } else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method: opts.method ?? "POST",
        headers,
        body,
        signal: AbortSignal.timeout(20000),
      });
    } catch (cause) {
      const err = new Error(`IXC timeout/network: ${cause instanceof Error ? cause.message : "unknown"}`) as IxcError;
      err.status = 0;
      throw err;
    }

    if (!res.ok) {
      const err = new Error(`IXC HTTP ${res.status} em ${path}`) as IxcError;
      err.status = res.status;
      try { err.ixcData = await res.json(); } catch { /* não-JSON */ }
      throw err;
    }
    const text = await res.text();
    if (!text) {
      const err = new Error(`IXC resposta vazia em ${path}`) as IxcError;
      err.status = 502;
      throw err;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      const err = new Error(`IXC resposta não-JSON em ${path}`) as IxcError;
      err.status = 502;
      err.ixcData = text.slice(0, 200);
      throw err;
    }
  }

  private async requestWithListHeader<T>(table: string, params: Record<string, string>): Promise<T> {
    const clean = table.replace(/^\/+/, "");
    const headers = { Authorization: this.auth, "ixcsoft": "listar", "Content-Type": "application/x-www-form-urlencoded" };
    let res: Response;
    try {
      res = await fetch(this.base + `/${clean}`, {
        method: "POST",
        headers,
        body: new URLSearchParams({ page: "1", rp: "20", ...params }).toString(),
        signal: AbortSignal.timeout(20000),
      });
    } catch (cause) {
      const err = new Error(`IXC timeout/network: ${cause instanceof Error ? cause.message : "unknown"}`) as IxcError;
      err.status = 0;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`IXC HTTP ${res.status} em /${clean}`) as IxcError;
      err.status = res.status;
      try { err.ixcData = await res.json(); } catch { /* não-JSON */ }
      throw err;
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      const err = new Error(`IXC resposta não-JSON em /${clean}`) as IxcError;
      err.status = 502;
      err.ixcData = text.slice(0, 200);
      throw err;
    }
  }

  async findClienteByTelefone(telefone: string): Promise<IxcCliente | null> {
    let digits = telefone.replace(/\D/g, "");
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
      digits = digits.slice(2);
    }
    if (digits.length < 10 || digits.length > 11) return null;

    const campos = ["telefone_celular", "fone", "telefone_comercial", "whatsapp", "ramal"];
    const formatos = formatosTelefone(digits);

    for (const campo of campos) {
      for (const formato of formatos) {
        const data = await this.requestWithListHeader<{ total?: number; registros?: IxcCliente[] }>("/cliente", {
          qtype: campo,
          query: formato,
          oper: "=",
          page: "1",
          rp: "5",
          sortname: "cliente.id",
          sortorder: "desc",
        });
        const achou = this.casarTelefone(data.registros ?? [], digits);
        if (achou) return achou;
      }
    }
    return null;
  }

  private casarTelefone(registros: IxcCliente[], digits: string): IxcCliente | null {
    const sufixo = digits.slice(-8);
    return (
      registros.find((c) =>
        [c.telefone_celular, c.fone, c.telefone_comercial, c.whatsapp, c.ramal].some((v) => {
          if (!v) return false;
          const d = String(v).replace(/\D/g, "");
          if (!d) return false;
          return d === digits || d.endsWith(sufixo);
        }),
      ) ?? null
    );
  }

  async findContratos(idCliente: number): Promise<IxcContrato[]> {
    const data = await this.requestWithListHeader<{ registros?: IxcContrato[] }>("/cliente_contrato", {
      qtype: "cliente_contrato.id_cliente",
      query: String(idCliente),
      oper: "=",
      rp: "50",
    });
    return (data.registros ?? []).filter((c) => String(c.status ?? "").toUpperCase() === "A");
  }

  async findFaturasEmAberto(idContrato: number): Promise<IxcFatura[]> {
    const data = await this.requestWithListHeader<{ registros?: IxcFatura[] }>("/fn_areceber", {
      qtype: "fn_areceber.id_contrato",
      query: String(idContrato),
      oper: "=",
      rp: "50",
    });
    return (data.registros ?? []).filter((f) => String(f.status ?? "").toUpperCase() === "A");
  }

  async findFaturasContrato(idContrato: number): Promise<IxcFatura[]> {
    const data = await this.requestWithListHeader<{ registros?: IxcFatura[] }>("/fn_areceber", {
      qtype: "fn_areceber.id_contrato",
      query: String(idContrato),
      oper: "=",
      rp: "50",
      sortname: "fn_areceber.data_vencimento",
      sortorder: "desc",
    });
    return data.registros ?? [];
  }

  async findFaturaById(idFatura: number): Promise<IxcFatura | null> {
    const data = await this.requestWithListHeader<{ registros?: IxcFatura[] }>("/fn_areceber", {
      qtype: "fn_areceber.id",
      query: String(idFatura),
      oper: "=",
      rp: "1",
    });
    return (data.registros ?? [])[0] ?? null;
  }

  async getBoleto(idFatura: number): Promise<{ pdfBase64?: string; pdfUrl?: string }> {
    const data = await this.request<Record<string, unknown>>("/get_boleto", {
      json: {
        boletos: String(idFatura),
        tipo_boleto: "arquivo",
        base64: "S",
        juro: "N",
        multa: "N",
        atualiza_boleto: "N",
      },
    });
    const pick = (keys: string[]) => {
      for (const k of keys) {
        const v = data[k];
        if (typeof v === "string" && v) return v;
      }
      return undefined;
    };
    const pdfBase64 = pick(["base64", "arquivo", "file", "conteudo"]);
    const pdfUrl = pick(["link_boleto", "url", "url_boleto", "gateway_link"]);
    if (!pdfBase64 && !pdfUrl) {
      const err = new Error("IXC: get_boleto sem conteúdo") as IxcError;
      err.status = 502;
      err.ixcData = data;
      throw err;
    }
    return { pdfBase64, pdfUrl };
  }

  async desbloquearContrato(idContrato: number): Promise<unknown> {
    const action = process.env.IXC_UNBLOCK_ACTION ?? "get_liberacao_bloqueio";
    return this.request<unknown>(`/cliente_contrato/action/${action}`, {
      form: { id_contrato: String(idContrato) },
    });
  }

  async ping(): Promise<boolean> {
    try {
      const data = await this.requestWithListHeader<{ total?: number }>("/cliente", {
        qtype: "cliente.ativo",
        query: "S",
        oper: "=",
        rp: "1",
      });
      return typeof data.total === "number";
    } catch {
      return false;
    }
  }
}

export interface IxcCliente {
  id?: number;
  razao?: string;
  nome?: string;
  fantasia?: string;
  cnpj_cpf?: string;
  tipo_pessoa?: string;
  ativo?: string;
  telefone_celular?: string;
  fone?: string;
  telefone_comercial?: string;
  whatsapp?: string;
  ramal?: string;
}

export interface IxcContrato {
  id?: number;
  id_cliente?: number;
  id_plano?: number;
  status?: string;
  plano?: string;
  [key: string]: unknown;
}

export interface IxcFatura {
  id?: number;
  id_contrato?: number;
  id_cliente?: number;
  status?: string;
  liberado?: string;
  valor?: string | number;
  valor_aberto?: string | number;
  valor_recebido?: string | number;
  data_vencimento?: string;
  data_emissao?: string;
  linha_digitavel?: string;
  gateway_link?: string;
  boleto?: string;
  documento?: string;
  [key: string]: unknown;
}

export function formatosTelefone(digits: string): string[] {
  const d = digits.replace(/\D/g, "");
  if (d.length === 11) {
    return [d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3"), d];
  }
  if (d.length === 10) {
    return [d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3"), d];
  }
  return [d];
}

export function nomeExibicaoCliente(c: IxcCliente): string {
  const nome = c.nome ?? c.razao ?? "";
  return nome.trim();
}

export const ixc = new IxcClient();