import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import HomeScreen from "./src/screens/HomeScreen";
import ChatScreen from "./src/screens/ChatScreen";

/**
 * Sem login: o app abre direto na tela inicial (logo + botão "Iniciar chat").
 * Ao tocar no botão, o chat começa e o próprio bot pede o telefone do cliente.
 */
export default function App() {
  const [started, setStarted] = useState(false);

  return (
    <>
      {started ? (
        <ChatScreen onBack={() => setStarted(false)} />
      ) : (
        <HomeScreen onStart={() => setStarted(true)} />
      )}
      <StatusBar style="light" />
    </>
  );
}
