/**
 * Catálogo de planos — Manual ADM DBS TELECOM (fixo no MVP, PRD FR-15).
 */

export interface Plano {
  id: string;
  nome: string;
  banda: string;
  valor: string;
  wifi6: boolean;
  obs?: string;
}

export const PLANOS_URBANOS: Plano[] = [
  { id: "seja400", nome: "SEJA DBS", banda: "400 MB", valor: "R$ 109,90", wifi6: false, obs: "valor fixo" },
  { id: "entretenimento800", nome: "ENTRETENIMENTO DBS", banda: "800 MB", valor: "R$ 159,90", wifi6: false, obs: "valor fixo" },
  { id: "ideal500", nome: "IDEAL DBS", banda: "500 MB", valor: "R$ 139,90 | R$ 119,90", wifi6: false, obs: "R$ 119,90 pagando até o vencimento" },
  { id: "essencial600", nome: "ESSENCIAL DBS", banda: "600 MB", valor: "R$ 149,90 | R$ 139,90", wifi6: false, obs: "R$ 139,90 pagando até o vencimento" },
  { id: "hard1g", nome: "HARD DBS", banda: "1 GB", valor: "R$ 249,90", wifi6: false, obs: "valor fixo" },
  { id: "retencao300", nome: "RETENÇÃO DBS", banda: "300 MB", valor: "R$ 89,90", wifi6: false, obs: "casos de extrema necessidade" },
];

export const PLANOS_WIFI6: Plano[] = [
  { id: "wifi6-500", nome: "Wi-Fi 6", banda: "500 MB", valor: "R$ 119,90", wifi6: true },
  { id: "wifi6-600", nome: "Wi-Fi 6", banda: "600 MB", valor: "R$ 129,90", wifi6: true },
  { id: "wifi6-800", nome: "Wi-Fi 6", banda: "800 MB", valor: "R$ 159,90", wifi6: true },
  { id: "wifi6-1000", nome: "Wi-Fi 6", banda: "1000 MB", valor: "R$ 189,90", wifi6: true },
];

export const PONTO_ADICIONAL = "R$ 19,90";

export const FIDELIDADE = {
  com: "Com fidelidade: 12 meses, você não paga ativação, porém existe multa por quebra de contrato se cancelar dentro desse período.",
  sem: "Sem fidelidade: você paga a ativação de R$ 600,00 — pode ser entrada + 4x, 5x no cartão de crédito ou à vista no ato da ativação.",
};

/** Recomendação por faixa de aparelhos (Script de Vendas — PRD FR-16). */
export function recomendarPorAparelhos(qtd: number): string {
  if (qtd <= 4) {
    return "Perfeito! Para essa quantidade de aparelhos, recomendo o plano IDEAL DBS 500MB: R$ 139,90, e pagando em dia sai por R$ 119,90 — excelente custo-benefício.";
  }
  if (qtd <= 8) {
    return "Recomendo o plano Wi-Fi 6 de 500 MB por R$ 119,90 — conexão mais rápida e estável para vários aparelhos.";
  }
  return "Com muitos aparelhos conectados, recomendo um plano Wi-Fi 6 (600 MB por R$ 129,90 ou superior) — tecnologia 802.11ax, ideal para casas com muitos dispositivos.";
}

/** Bairros atendidos (viabilidade — tabela estática, PRD FR-17; demo: Santo Antônio da Barra-GO). */
export const BAIRROS_ATENDIDOS = ["centro", "vila nova", "são josé", "jardim das flores"];