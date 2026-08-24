# Entendendo o Projeto DBS Assistente (sem precisar saber programar)

Este documento explica o projeto **DBS Assistente** — um robô de atendimento (chatbot) da DBS TELECOM — de um jeito simples, como se estivéssemos explicando para alguém que nunca viu código na vida.

---

## 1. O que é este projeto?

Imagine um **atendente virtual** que conversa com o cliente pelo celular, identifica quem ele é pelo **número de telefone** (consultando o cadastro), e ajuda com:

- **Suporte técnico**: checklist de internet lenta;
- **Financeiro**: 2ª via de boleto e desbloqueio de acesso;
- **Comercial**: apresentar planos e vender um novo.

O cliente fala com o robô como se fosse um atendente de verdade, digitando no celular. Por trás disso existem 4 "personagens" trabalhando juntos:

| Personagem | O que é | Onde fica |
|---|---|---|
| **O App (celular)** | A "loja" que o cliente vê: tela de boas-vindas, chat, botões | No celular do cliente |
| **O Servidor (backend)** | O "cérebro": decide o que responder, consulta sistemas, organiza o atendimento | No seu computador |
| **Sistema IXC** | O "cadastro" da provedora: clientes, contratos, boletos, endereços | Na internet (servidor da IXC) |
| **IA Gemini (Google)** | O "intérprete": entende o que o cliente digitou de forma livre ("minha internet tá caindo" etc.) | Na internet (Google) |

---

## 2. As duas grandes partes do projeto

```
dbs-chatbot/
│
├── 📱 app/          → O aplicativo do celular (a parte que o cliente vê)
│
└── 🖥️ backend/     → O servidor (o cérebro que processa tudo)
```

- **app/** — feita com **React Native / Expo**. É o que roda no celular. Contém a tela inicial (logo + botão "Iniciar atendimento"), a tela de chat (bolhas de mensagem, botões de "Baixar boleto" etc.) e a "régua" que conversa com o servidor.
- **backend/** — feita com **Node.js + Express**. É um serviço que fica ligado o tempo todo na sua máquina, esperando o app falar com ele. Ele conversa com a IXC e com a IA, e devolve as respostas.

> **Analogia do restaurante:** o App é o garçom que anota o pedido na mesa; o Servidor é a cozinha que prepara o prato; a IXC é o estoque (onde estão os ingredientes); a Gemini é o chef que decide qual receita usar quando o cliente pede algo que não está no cardápio.

---

## 3. O caminho de uma mensagem (passo a passo)

Quando o cliente digita algo no celular:

```
[1] Celular (app)
    │  envia: "minha internet está lenta" + número da conversa
    ▼
[2] Servidor (backend)
    │  • verifica se o cliente já se identificou (telefone consultado no cadastro)
    │  • se for mensagem livre, pergunta à IA Gemini o que o cliente quer
    │  • busca dados na IXC quando precisa (contrato, boletos...)
    │  • monta a resposta ("Entendi! Vou te ajudar com algumas verificações...")
    ▼
[3] Resposta volta para o celular
    │  "Entendi! Vou te ajudar..." + botões
    ▼
[4] Cliente vê a resposta na tela e responde de novo → volta ao passo [1]
```

Tudo isso acontece em frações de segundo. Cada conversa tem um **número de conversa (sessionId)** — é assim que o servidor sabe que é o mesmo cliente continuando o papo (como a "comanda" do restaurante).

---

## 4. Como o robô sabe o que responder? (os "estados")

O segredo do robô é uma lista de "momentos" da conversa. Ele só está em **um momento por vez**, e cada momento sabe como reagir. Isso se chama **máquina de estados** (não se assuste com o nome — é só um roteiro).

Os momentos principais:

| Momento (estado) | O que o robô está fazendo | Exemplo de resposta |
|---|---|---|
| `awaiting_phone` | Esperando o telefone para identificar o cliente (não existe login) | "Antes de começarmos, me informe o número de telefone cadastrado" |
| `select_contract` | Cliente tem mais de 1 contrato; perguntando qual | "Sobre qual deseja falar? 1 - ... 2 - ..." |
| `menu` | Mostrando o menu principal | "1 - Suporte técnico / 2 - Financeiro / 3 - Comercial" |
| `checklist` | Fluxo de internet lenta (perguntas de sim/não) | "O problema acontece em mais de um aparelho?" |
| `boleto` | Gerando a 2ª via do boleto | "Segue o boleto para você baixar" |
| `desbloqueio` | Verificando pendências e desbloqueando | "Não encontrei pendências, acesso liberado" |
| `comercial...` | Venda: quantos aparelhos, bairro, vencimento, indicação | "Recomendo o plano IDEAL DBS 500MB..." |
| `encaminhado` | Fim: cliente foi passado para um atendente | "Atendente de Suporte irá responder em instantes" |

O "roteiro" completo (todas as regras de cada momento) está num único arquivo: `backend/src/flows/session.ts` — é o coração do robô.

Se o cliente digita algo que não é um número do menu, o robô **pergunta à IA (Gemini)** o que ele quis dizer, e a IA devolve algo como "isso é um problema de suporte técnico". Aí o robô segue o fluxo correspondente.

> **Como o robô sabe quem é o cliente?** Não existe mais login nem CPF. Na primeira conversa o bot pede o telefone; quando o cliente digita, o servidor consulta o cadastro (IXC) procurando aquele número no celular, telefone fixo, comercial, WhatsApp ou ramal. Achou? O robô já chama o cliente pelo nome e mostra o menu. Não achou? Pede para conferir o número e digitar de novo.

---

## 5. O que cada arquivo faz

### 🖥️ Backend (servidor) — `backend/src/`

| Arquivo | O que faz (em linguagem simples) |
|---|---|
| `index.ts` | O "portão de entrada". Liga o servidor na porta 3000, confere o "crachá" (token) de cada chamada do app, e repassa para as rotas. |
| `config.ts` | O "painel de configurações": porta, tokens, horário de atendimento. Tudo vem do arquivo `.env`. |
| `routes/chat.ts` | Recebe as mensagens do app (`/api/chat`) e chama o cérebro do robô. |
| `routes/boleto.ts` | Recebe o pedido de download do boleto (`/api/boleto/:id`) e devolve o PDF (ou a linha digitável). |
| `flows/session.ts` | **O cérebro.** Todo o roteiro da conversa: estados, validação de CPF/CNPJ, checklist de lentidão, boleto, desbloqueio, venda de planos. |
| `ixc/client.ts` | O "mensageiro" que fala com a IXC: busca cliente por CPF, contratos, faturas, tenta gerar boleto e desbloquear. |
| `ai/gemini.ts` | O "intérprete" que fala com a IA do Google: entende a intenção da mensagem livre do cliente. |
| `data/planos.ts` | O "cardápio": lista de planos da DBS, preços, fidelidade, bairros atendidos. |

### 📱 App (celular) — `app/`

| Arquivo | O que faz |
|---|---|
| `App.tsx` | O "cérebro do app": decide mostrar a tela inicial ou o chat (sem login). |
| `src/screens/HomeScreen.tsx` | Tela inicial: logo, texto de apresentação e botão "Iniciar chat". |
| `src/screens/ChatScreen.tsx` | Tela do chat: bolhas de mensagem, campo de digitar, botões de "Baixar boleto" e "Copiar código de barras". |
| `src/api.ts` | A "régua" que fala com o servidor: envia mensagens e baixa boletos. |
| `src/theme.ts` | As "cores da marca": laranja DBS, tamanhos, espaçamentos. Tudo que é visual e repetido. |

### Arquivos de configuração

| Arquivo | O que é |
|---|---|
| `backend/.env` | Segredos do servidor: token da IXC, chave da IA, token do app. (Nunca deve ser divulgado.) |
| `app/.env` | Endereço do servidor e o token público do app. |
| `app.json` | "Certidão de nascimento" do app: nome, ícone, identificador (br.com.dbstelecom.assistente). |

---

## 6. O segredo por trás de tudo: os "tokens"

Para os sistemas se reconhecerem, cada conversa entre eles precisa de um "crachá" (token):

- O **app** envia o crachá `x-app-token` ao servidor → prova que é o app oficial da DBS;
- O **servidor** envia o crachá da **IXC** → prova que ele tem acesso aos dados dos clientes;
- O **servidor** envia a **chave da IA Gemini** → prova que tem direito de usar o Google.

Se um crachá estiver errado ou faltando, o sistema responde "não autorizado" (erro 401) e nada funciona.

---

## 7. Como rodar o projeto (no dia a dia)

**1) Ligar o servidor** (no PC):

```
cd backend
npm run dev
```

Você verá no terminal: "DBS chatbot backend em http://localhost:3000". O servidor recarrega sozinho quando o código muda.

**2) Ligar o app** (no PC):

```
cd app
npx expo start
```

Depois escaneie o QR code com o aplicativo **Expo Go** no celular (celular e PC na mesma rede Wi-Fi).

---

## 8. Problemas comuns (e o que significam)

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| App diz "Não consegui conectar ao servidor" | O endereço do servidor no `app/.env` está apontando errado (ex.: `localhost` quando se usa o celular) | Coloque o IP do seu PC na rede: `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000` e reinicie o `npx expo start` |
| "Não localizei seu cadastro" | O telefone digitado não está cadastrado na IXC demo | Usar um telefone que exista no ambiente demo (ex.: dados do cliente teste) |
| "Token inválido" (erro 401) | O token do app não bate com o do servidor | Conferir `APP_TOKEN` no `backend/.env` e `EXPO_PUBLIC_APP_TOKEN` no `app/.env` |
| "Estou com dificuldade para acessar nossos sistemas" | O servidor não consegue falar com a IXC (token IXC inválido ou sem internet) | Conferir `IXC_TOKEN` e `IXC_URL` no `backend/.env` |
| Mensagens livres sempre voltam com o menu | Falta a chave da IA (`GEMINI_API_KEY`) | Preencher no `backend/.env` |

> **Dica importante:** mensagem de *conexão* ("não consegui conectar") é diferente de mensagem de *conteúdo* ("não localizei seu cadastro"). A primeira significa que o celular não alcançou o servidor. A segunda significa que alcançou, mas o dado não existe lá.

---

## 9. Glossário rápido

| Palavra | Significado simples |
|---|---|
| **Backend** | A parte do sistema que roda no servidor (o "cérebro"). |
| **Frontend / App** | A parte que o usuário vê e toca (no celular). |
| **API** | Um "balcão de atendimento" entre sistemas: uma regra combinada de pedir e receber informações. |
| **Endpoint** | Um endereço específico da API, ex.: `/api/chat` (enviar mensagem). |
| **Token** | Um crachá secreto que prova quem você é para outro sistema. |
| **Estado** | O momento atual da conversa (qual parte do roteiro o robô está seguindo). |
| **SessionId** | O número da comanda da conversa: identifica cada cliente no servidor. |
| **JSON** | Um formato de "ficha preenchida" que os programas usam para trocar informações. |
| **IA / Gemini** | Um serviço do Google que entende linguagem natural e ajuda o robô a entender o cliente. |
| **IXC** | O sistema de gestão da provedora (cadastro de clientes, contratos, faturas). |

---

## 10. Para saber mais

Documentos técnicos mais detalhados (para quando quiser ir mais fundo) estão na pasta `docs/`:

- `docs/architecture.md` — arquitetura do sistema
- `docs/flows.md` — cada fluxo do bot passo a passo
- `docs/api.md` — os endpoints da API
- `docs/demo-script.md` — roteiro de demonstração
