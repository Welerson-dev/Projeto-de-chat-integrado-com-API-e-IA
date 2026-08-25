import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { fetchBoleto, getSessionId, sendMessage, type ChatMessage } from "../api";
import { colors, fontSize, radius, spacing } from "../theme";

interface Props {
  onBack: () => void;
}

interface Row {
  id: string;
  kind: "bot" | "user";
  message: ChatMessage;
  raw: string;
}

const INITIAL_GREETING: ChatMessage = {
  type: "text",
  text: "Olá! 👋 Sou o assistente virtual da DBS TELECOM.\n\nPara começar, me informe seu número de telefone com DDD. Ex.: (64) 99999-9999",
};

const STATE_AGUARDANDO_TELEFONE = "awaiting_phone";
const RESPOSTA_DELAY_MS = 2000;

let rowCounter = 0;
function nextId(): string {
  rowCounter += 1;
  return `r${rowCounter}`;
}

export default function ChatScreen({ onBack }: Props) {
  const [rows, setRows] = useState<Row[]>([
    { id: nextId(), kind: "bot", message: INITIAL_GREETING, raw: INITIAL_GREETING.text },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [chatState, setChatState] = useState(STATE_AGUARDANDO_TELEFONE);
  const scrollRef = useRef<ScrollView>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    getSessionId().then((id) => {
      sessionIdRef.current = id;
    });
  }, []);

  const appendRows = useCallback((msgs: ChatMessage[]) => {
    setRows((prev) => [
      ...prev,
      ...msgs.map((m) => ({ id: nextId(), kind: "bot" as const, message: m, raw: m.text })),
    ]);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || busy) return;
      setInput("");
      setBusy(true);

      let sid = sessionIdRef.current;
      if (!sid) {
        sid = await getSessionId();
        sessionIdRef.current = sid;
      }

      setRows((prev) => [...prev, { id: nextId(), kind: "user", message: { type: "text", text: clean }, raw: clean }]);

      try {
        const [res] = await Promise.all([
          sendMessage(sid, clean),
          new Promise<void>((resolve) => setTimeout(resolve, RESPOSTA_DELAY_MS)),
        ]);
        setChatState(res.state);
        appendRows(res.messages);
      } catch (err) {
        const msg =
          err instanceof Error && /estou com dificuldade|erro interno/.test(err.message)
            ? err.message
            : "Não consegui conectar ao servidor. Verifique sua conexão e tente novamente.";
        setRows((prev) => [
          ...prev,
          { id: nextId(), kind: "bot", message: { type: "text", text: msg }, raw: msg },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [appendRows, busy],
  );

  const handleDownload = useCallback(
    async (boletoId: string, hasLinhaDigitavel: boolean, linhaDigitavel?: string) => {
      if (downloading) return;
      setDownloading(boletoId);
      try {
        const result = await fetchBoleto(boletoId);
        if (result.kind === "pdf") {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(result.uri, { mimeType: "application/pdf" });
          } else {
            await Clipboard.setStringAsync(result.uri);
            Alert.alert("Boleto baixado", "Arquivo salvo no dispositivo.");
          }
        } else {
          await Clipboard.setStringAsync(result.linhaDigitavel);
          Alert.alert("Código de barras copiado", "Cole no app do seu banco para pagar. 😉");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível baixar o boleto.";
        Alert.alert("Boleto", msg);
      } finally {
        setDownloading(null);
      }
    },
    [downloading],
  );

  const handleCopy = useCallback(async (linhaDigitavel: string) => {
    await Clipboard.setStringAsync(linhaDigitavel);
    Alert.alert("Código de barras copiado", "Cole no app do seu banco para pagar. 😉");
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
    >
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>DBS Assistente</Text>
          <Text style={styles.headerStatus}>online</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {rows.map((row) => (
          <RowView
            key={row.id}
            row={row}
            downloading={downloading}
            onSend={handleSend}
            onDownload={handleDownload}
            onCopy={handleCopy}
          />
        ))}
        {busy && (
          <View style={[styles.bubble, styles.bubbleBot, styles.typing]}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={
            chatState === STATE_AGUARDANDO_TELEFONE
              ? "Digite seu telefone com DDD..."
              : "Digite sua mensagem..."
          }
          placeholderTextColor={colors.textMuted}
          editable={!busy}
          keyboardType={chatState === STATE_AGUARDANDO_TELEFONE ? "phone-pad" : "default"}
          returnKeyType="send"
          onSubmitEditing={() => handleSend(input)}
        />
        <Pressable
          style={[styles.sendButton, busy && styles.sendButtonDisabled]}
          onPress={() => handleSend(input)}
          disabled={busy}
        >
          <Text style={styles.sendText}>➤</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function RowView({
  row,
  downloading,
  onSend,
  onDownload,
  onCopy,
}: {
  row: Row;
  downloading: string | null;
  onSend: (text: string) => void;
  onDownload: (id: string, hasLinha: boolean, linha?: string) => void;
  onCopy: (linha: string) => void;
}) {
  const isBot = row.kind === "bot";
  const m = row.message;

  return (
    <View style={[styles.row, isBot ? styles.rowBot : styles.rowUser]}>
      <View style={[styles.bubble, isBot ? styles.bubbleBot : styles.bubbleUser]}>
        <Text style={[styles.bubbleText, !isBot && styles.bubbleTextUser]}>{m.text}</Text>

        {m.type === "menu" && m.options && (
          <View style={styles.quickReplies}>
            {m.options.map((opt) => {
              const code = opt.match(/^(\d+)/)?.[1] ?? opt;
              return (
                <Pressable key={opt} style={styles.quickReply} onPress={() => onSend(code)}>
                  <Text style={styles.quickReplyText}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {m.type === "boleto" && (
          <View style={styles.quickReplies}>
            {m.boletoId && (
              <Pressable
                style={styles.quickReply}
                onPress={() => onDownload(m.boletoId as string, Boolean(m.linhaDigitavel), m.linhaDigitavel)}
                disabled={downloading === m.boletoId}
              >
                {downloading === m.boletoId ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Text style={styles.quickReplyText}>Baixar boleto</Text>
                )}
              </Pressable>
            )}
            {m.linhaDigitavel && (
              <Pressable style={styles.quickReply} onPress={() => onCopy(m.linhaDigitavel as string)}>
                <Text style={styles.quickReplyText}>Copiar código de barras</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  backButton: {
    marginRight: spacing.sm,
    width: 32,
  },
  backText: {
    color: colors.light,
    fontSize: 24,
    fontWeight: "700",
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    color: colors.light,
    fontSize: fontSize.title,
    fontWeight: "800",
  },
  headerStatus: {
    color: colors.light,
    fontSize: fontSize.small,
    opacity: 0.85,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
  },
  row: {
    marginBottom: spacing.sm,
    flexDirection: "row",
  },
  rowBot: {
    justifyContent: "flex-start",
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bubbleBot: {
    backgroundColor: colors.bubbleBot,
    borderTopLeftRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bubbleUser: {
    backgroundColor: colors.bubbleUser,
    borderTopRightRadius: radius.sm,
  },
  bubbleText: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    lineHeight: 21,
  },
  bubbleTextUser: {
    color: colors.textOnBrand,
  },
  typing: {
    alignSelf: "flex-start",
    paddingVertical: spacing.md,
  },
  quickReplies: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  quickReply: {
    backgroundColor: colors.secondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
    alignSelf: "flex-start",
  },
  quickReplyText: {
    color: colors.textOnBrand,
    fontSize: fontSize.body,
    fontWeight: "600",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.light,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.body,
    color: colors.textPrimary,
  },
  sendButton: {
    marginLeft: spacing.sm,
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendText: {
    color: colors.light,
    fontSize: 18,
  },
});