import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN ?? "app_token_dbs_2026";
const SESSION_KEY = "dbs.sessionId";

export interface ChatMessage {
  type: "text" | "menu" | "boleto" | "end";
  text: string;
  options?: string[];
  boletoId?: string;
  pdfUrl?: string;
  linhaDigitavel?: string;
}

export interface ChatResponse {
  messages: ChatMessage[];
  state: string;
}

export type BoletoResult =
  | { kind: "pdf"; uri: string; name: string }
  | { kind: "linha_digitavel"; linhaDigitavel: string; valor?: string; vencimento?: string };

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getSessionId(): Promise<string> {
  const existing = await AsyncStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = uuid();
  await AsyncStorage.setItem(SESSION_KEY, id);
  return id;
}

export async function resetSession(): Promise<string> {
  const id = uuid();
  await AsyncStorage.setItem(SESSION_KEY, id);
  return id;
}

export async function sendMessage(sessionId: string, message: string): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-token": APP_TOKEN },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Falha na comunicação (HTTP ${res.status})`);
  }
  return (await res.json()) as ChatResponse;
}

export async function fetchBoleto(boletoId: string): Promise<BoletoResult> {
  const res = await fetch(`${API_URL}/api/boleto/${boletoId}`, {
    headers: { "x-app-token": APP_TOKEN },
  });
  if (res.status === 404) throw new Error("Boleto indisponível no momento.");
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/pdf")) {
    const buf = await res.arrayBuffer();
    const file = new File(Paths.cache, `boleto-${boletoId}.pdf`);
    file.write(new Uint8Array(buf));
    return { kind: "pdf", uri: file.uri, name: file.name };
  }

  const data = await res.json().catch(() => null);
  if (data && data.tipo === "linha_digitavel") {
    return {
      kind: "linha_digitavel",
      linhaDigitavel: String(data.linhaDigitavel ?? ""),
      valor: data.valor,
      vencimento: data.vencimento,
    };
  }
  throw new Error("Boleto indisponível no momento.");
}