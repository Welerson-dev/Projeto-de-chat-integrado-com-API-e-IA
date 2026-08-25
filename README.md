# DBS Assistente — MVP

Chatbot de atendimento da DBS TELECOM: identifica o cliente por CPF/CNPJ, saúda pelo nome, classifica a intenção com IA (Gemini) e encaminha para Suporte / Financeiro / Comercial — com fluxos automatizados de checklist de lentidão, 2ª via de boleto e desbloqueio.

- **App**: React Native / Expo (SDK 57) em `app/`
- **Backend**: Node.js + TypeScript + Express em `backend/`
- **Integração**: IXC Soft (demo) via API REST `webservice/v1`
- **IA**: Google Gemini (`gemini-3.6-flash`) para classificação de mensagens livres

## Estrutura

```
dbs-chatbot/
├── backend/                 # API + fluxos + integração IXC/Gemini
│   ├── src/
│   │   ├── index.ts         # Express (CORS, x-app-token, rotas)
│   │   ├── config.ts        # Configurações + máscara de documento
│   │   ├── ixc/client.ts    # Cliente da API IXC (auth, listagem, ações)
│   │   ├── ai/gemini.ts     # Classificação e resposta com IA
│   │   ├── data/planos.ts   # Catálogo de planos + bairros atendidos
│   │   ├── flows/session.ts # Máquina de estados dos fluxos
│   │   └── routes/          # chat.ts, boleto.ts
│   └── .env                 # IXC_TOKEN, GEMINI_API_KEY
└── app/                     # App Expo (TypeScript)
    ├── src/
    │   ├── api.ts           # Cliente do backend + download de boleto
    │   ├── theme.ts         # Cores da marca DBS
    │   └── screens/         # HomeScreen, ChatScreen
    └── .env                 # EXPO_PUBLIC_API_URL, EXPO_PUBLIC_APP_TOKEN
```

## Requisitos

- Node.js 18+ e npm
- Conta/credencial IXC Soft (token) e chave da API Gemini
- Celular com Expo Go (ou emulador) para o app

## Configuração — Backend

1. `cd backend && npm install`
2. Copie `.env.example` para `.env` e preencha:

   ```env
   IXC_URL=https://demo.ixcsoft.com.br/webservice/v1
   IXC_TOKEN=<seu token>          # token cru, sem "token:"
   GEMINI_API_KEY=<sua chave>     # modelo gemini-3.6-flash
   APP_TOKEN=app_token_dbs_2026   # header x-app-token (roteas /api)
   PORT=3000
   ```

3. Suba o servidor:

   ```bash
   npm run dev        # tsx watch (recarrega sozinho)
   # ou
   npm start          # execução única
   ```

4. Verifique: `curl http://localhost:3000/health` → `{"ok":true}`

> O boot executa um `ping` na IXC; se a credencial estiver inválida, o servidor **para** com log claro (o token IXC não deve ser regenerado).

## Configuração — App

1. `cd app && npm install`
2. Copie `.env.example` para `.env` e ajuste a URL do backend:

   ```env
   EXPO_PUBLIC_API_URL=http://localhost:3000
   EXPO_PUBLIC_APP_TOKEN=app_token_dbs_2026
   ```

   - Emulador Android: use `http://10.0.2.2:3000`
   - Celular físico (Expo Go): use o IP da sua máquina na rede, ex. `http://192.168.1.10:3000`

3. Suba o app:

   ```bash
   npx expo start
   ```

   Escaneie o QR code com o Expo Go (Android/iOS) ou pressione `a` para emulador Android.

## Testes de tipo

```bash
cd backend && npm run typecheck
cd app && npx tsc --noEmit
```

## Endpoints

| Método | Rota                     | Descrição                                          |
| ------ | ------------------------ | -------------------------------------------------- |
| POST   | `/api/chat`              | Envia mensagem: `{ sessionId, message, phone? }` — sem login: o bot pede o telefone no chat, consulta a IXC e chama o cliente pelo nome |
| GET    | `/api/boleto/:idFatura`  | Baixa a 2ª via (PDF) ou retorna linha digitável    |
| GET    | `/api/demandas`          | Lista demandas registradas (memória/console)       |
| GET    | `/health`                | Health check                                       |

Todas as rotas `/api/*` exigem o header `x-app-token`.


## Documentação

- [Arquitetura](docs/architecture.md) — como o sistema funciona por dentro (camadas, fluxo de mensagens, máquina de estados, decisões)
- [Fluxos de atendimento](docs/flows.md) — cada fluxo do bot passo a passo (FR-1..FR-18)
- [API](docs/api.md) — referência dos endpoints com exemplos
- [Integração IXC Soft](docs/ixc-integration.md) — convenções corrigidas de auth, listagem e ações
- [Roteiro de demo](docs/demo-script.md) — passo a passo para apresentar o MVP

## Limitações conhecidas (demo)

- **Ações IXC** (`get_boleto` com PDF, `get_liberacao_bloqueio`) **não estão liberadas no demo** → o backend usa a rota oficial do SDK e, na indisponibilidade, cai para a **linha digitável** da fatura (boleto) ou **escalona** (desbloqueio). Em produção com as ações liberadas, o PDF é gerado e baixado normalmente.
- **Classificação por IA** depende da `GEMINI_API_KEY`; sem chave, mensagens livres respondem com o menu (a classificação nunca usa fallback estático).
- Identificação usa os dados do demo (Teste Wbrnet / Everaldo) — veja o roteiro de demo.