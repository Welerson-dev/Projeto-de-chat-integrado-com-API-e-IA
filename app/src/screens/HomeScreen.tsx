import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontSize, radius, spacing } from "../theme";

interface Props {
  // Chamado quando o cliente toca no botão "Iniciar chat".
  onStart: () => void;
}

/**
 * Tela inicial SEM login: mostra a logo da DBS e o botão para começar o chat.
 * A identificação do cliente (telefone) acontece dentro do próprio chat.
 */
export default function HomeScreen({ onStart }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.brandBlock}>
        <Image
          source={require("../../assets/logo-dbs.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Logo DBS TELECOM"
        />
        <Text style={styles.title}>Assistente Virtual</Text>
        <Text style={styles.subtitle}>
          Suporte técnico, financeiro e planos — tudo por aqui, sem fila de espera.
        </Text>
      </View>

      <View style={styles.ctaBlock}>
        <Text style={styles.ctaText}>
          Toque no botão abaixo para falar com o assistente virtual.
        </Text>
        {/* Botão que abre o chat; o bot pedirá o telefone na primeira mensagem. */}
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={onStart}
        >
          <Text style={styles.buttonText}>Iniciar chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
    paddingVertical: spacing.xl * 2,
  },
  brandBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 220,
    height: 220,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.light,
    fontSize: fontSize.large,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: colors.light,
    fontSize: fontSize.body,
    textAlign: "center",
    marginTop: spacing.sm,
    opacity: 0.9,
    lineHeight: 22,
  },
  ctaBlock: {
    alignItems: "center",
  },
  ctaText: {
    color: colors.light,
    fontSize: fontSize.body,
    textAlign: "center",
    marginBottom: spacing.md,
    opacity: 0.95,
  },
  button: {
    backgroundColor: colors.light,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: "700",
  },
});
