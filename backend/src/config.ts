import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appToken: process.env.APP_TOKEN ?? "app_token_dbs_2026",
  ixcUrl: (process.env.IXC_URL ?? "https://demo.ixcsoft.com.br").replace(/\/+$/, ""),
  ixcToken: process.env.IXC_TOKEN ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
  supportStartHour: Number(process.env.SUPPORT_START_HOUR ?? 8),
  supportEndHour: Number(process.env.SUPPORT_END_HOUR ?? 18),
};

export function maskDocumento(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 2) return "**";
  return digits.slice(0, 2) + "*".repeat(Math.max(digits.length - 4, 0)) + digits.slice(-2);
}
