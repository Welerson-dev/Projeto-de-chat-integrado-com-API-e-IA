# Arquitetura — DBS Assistente

Explicação técnica de como o MVP funciona, por dentro.

## Visão geral

```
┌─────────────┐   HTTPS (JSON)    ┌──────────────────┐   HTTPS/JSON    ┌──────────────┐
│  App Expo   │ ────────────────► │  Backend Node.js │ ──────────────► │  IXC Soft    │
│  (RN/TS)    │  POST /api/chat   │  (Express + TS)  │  webservice/v1  │  (demo)      │
│             │ ◄──────────────── │                  │ ◄────────────── │  clientes,   │
│  balões,    │  ChatResponse     │  ┌────────────┐  │  listar/obter   │  contratos,  │
│  botões,    │                   │  │ fluxos     │  │                 │  faturas     │
│  boleto     │                   │  │ (state     │  │                 │              │
│             │                   │  │  machine)  │  │                 │              │
└─────────────┘                   │  └────────────┘  │                 └──────────────┘
                                  │  ┌────────────┐  │                 ┌──────────────┐
                                  │  │ Gemini IA  │  │  HTTPS/JSON     │  Gemini      │
                                  │  │ (classify) │  │ ──────────────► │  API         │
                                  │  └────────────┘  │  generateContent│  (nuvem)     │
                                  └──────────────────┘                 └──────────────┘
```

- **App** (React Native/Expo): única interface com o usuário. Não fala com a IXC nem com o Gemini.
- **Backend** (Node.js + Express + TypeScript): cérebro do sistema. Guarda o token da IXC, mantém
  as sessões em memória, executa os fluxos e orquestra as integrações.
- **IXC Soft**: fonte da verdade dos dados do cliente (cadastro, contratos, faturas).
- **Gemini**: classifica mensagens livres do menu ("minha internet caiu") em um fluxo.

## Camadas do backend

```
src/
├── index.ts              → Bootstrap: Express, CORS, middleware x-app-token, rotas, ping IXC
├── config.ts             → Configurações a partir de variáveis de ambiente (.env)
├── routes/
│   ├── chat.ts           → POST /api/chat (valida payload e chama o fluxo)
│   └── boleto.ts         → GET /api/boleto/:id (PDF ou fallback linha digitável)
├── flows/
│   └── session.ts        → Máquina de estados dos fluxos (regra de negócio)
├── ai/
│   └── gemini.ts         → Cliente do Gemini: classificação + resposta (prompts)
├── ixc/
│   └── client.ts         → Cliente HTTP da API IXC v1 (auth, listagem, ações)
└── data/
    └── planos.ts         → Catálogo de planos, fidelidade, recomendação, bairros
```

Cada camada só conversa com a camada abaixo: rotas → fluxos → clientes de integração. Nenhuma
regra de negócio vive nas rotas; nenhum HTTP vive nos fluxos.

## Ciclo de uma mensagem

1. O app gera um `sessionId` (persistido no dispositivo) e envia `{ sessionId, message }` para
   `POST /api/chat` com o header `x-app-token`.
2. O middleware valida o token (FR-19) — o token da IXC nunca sai do backend.
3. `handleMessage(sessionId, message)` recupera a sessão (ou cria nova; timeout de 10 min).
4. Dependendo do estado, o fluxo executa:
   - **identificação** (`awaiting_phone`) → o bot pede o telefone; o número
     digitado é normalizado e consultado na IXC em todas as colunas de
     telefone do cadastro (celular, fixo, comercial, WhatsApp, ramal). Se o
     canal enviar `phone` (ex.: WhatsApp), a identificação é automática.
     Encontrado → saúda pelo nome e carrega os contratos ativos;
   - **menu** → dígito rápido (1/2/3) ou classificação por IA da mensagem livre;
   - **checklist/boleto/desbloqueio/comercial** → passos internos, sempre consultando a IXC.
5. O backend devolve `{ messages, state }`; o app renderiza balões, botões de menu e ações de boleto.

## Máquina de estados

```
                       ┌──────────────────────────────┐
                       │       awaiting_phone         │  bot pede o telefone; canal pode
                       └──────────────┬───────────────┘  enviar o número (identificação
                                      │                  automática). Achou na IXC →
                                      │                  saúda pelo nome
                                      │ 1 contrato ativo
                          ┌───────────┴───────────┐
                          │   select_contract     │──► (múltiplos contratos → escolher)
                          └───────────┬───────────┘
                                      ▼
                    ┌──────────────  menu  ──────────────┐
                    │ 1      │ 2        │ 3      │ livre │
                    ▼        ▼          ▼        ▼ (Gemini)
              checklist  boleto/    comercial   (classifica e roteia p/ os mesmos fluxos)
                    │   desbloqueio   │
                    │      │          ├──► comercial_bairro ──► comercial_vencimento ──► comercial_indicacao
                    │      │          ▼
                    │      ▼        encaminhado (end)
                    └─────► encaminhado (end) / menu (resolvido)
```

- **encaminhado**: estado terminal — a demanda foi registrada (memória + console) e o cliente
  recebe "Atendente de X irá responder em instantes."
- **0 / "menu" / "voltar"** em qualquer estado (exceto identificação) volta ao menu e zera as tentativas.
- **2 tentativas** sem resposta válida escalonam automaticamente.
- Fora do horário de suporte (8h–18h), o texto de escalonamento avisa que o plantonista será acionado.

## Sessões e segurança

- Sessões em `Map` na memória: `sessionId` (gerado no app) → estado, cliente, contrato, pendência.
- Timeout de **10 minutos** sem atividade → sessão reiniciada (pede o telefone novamente).
- **Dados sensíveis**: valores e documentos não são logados; demandas registram só contexto de negócio
  (helper `maskDocumento` segue disponível em `config.ts` para uso futuro).
- **Token IXC**: vive apenas no `.env` do backend; rotas `/api/*` exigem `x-app-token`.
- **Token IXC é único e irrecuperável** — o backend só faz leituras e as ações previstas; nunca
  aciona rotas de geração de token.

## Classificação por IA (Gemini)

- `gemini.classify(message)` → `{ intent, flow, confidence }` via `generateContent` (temp 0.2, 15 s de timeout).
- Intent: `suporte | financeiro | comercial | menu | unknown` · Flow: `lentidao | boleto | desbloqueio | contratar | outro`.
- **Nunca há fallback estático de classificação**: sem chave, a mensagem livre responde com o menu
  e o aviso de instabilidade; com `intent=unknown` ou `confidence=low`, o bot pede esclarecimento
  (2 tentativas → escalona).
- O fluxo de desbloqueio via texto livre depende da chave: `GEMINI_API_KEY` no `.env`.

## Integração IXC — resumo

- Auth: `Authorization: Basic base64(TOKEN_CRU)` (token cru, **sem** prefixo `token:`).
- Listagem: `POST /webservice/v1/{tabela}` + header `ixcsoft: listar` + corpo form-urlencoded.
- Ações de módulo (`get_boleto`, `get_liberacao_bloqueio`): **não liberadas no demo** → o backend
  tenta a rota oficial do SDK e cai em fallback (linha digitável / escalonamento com demanda).

Detalhes e exemplos em [ixc-integration.md](ixc-integration.md).

## Limitações do MVP

| Item | Impacto |
| ---- | ------- |
| Ações IXC indisponíveis no demo | Boleto vira linha digitável; desbloqueio sem pendência escalona para suporte |
| `GEMINI_API_KEY` vazia | Mensagens livres respondem com menu + aviso de instabilidade |
| Sessões em memória | Reinício do servidor perde sessões e demandas (aceitável no MVP) |
| Demandas em memória/console | Não há fila nem CRM; visível em `/api/demandas` |
| Identificação sem login | Qualquer pessoa com um telefone cadastrado se identifica (decisão do PRD para o MVP) |

## Decisões de projeto (por quê)

- **Backend próprio em vez de app direto na IXC**: o token da IXC fica escondido; os fluxos (regras,
  identificação por telefone, escalonamento) ficam testáveis por API sem o app.
- **Máquina de estados explícita**: cada resposta depende do estado da sessão — impossível o bot
  "pular" etapas (ex.: receber boleto sem se identificar).
- **Classificação sempre via IA**: requisito do PRD (FR-5) e mais robusto para a variedade real de
  mensagens; o menu numérico é o atalho garantido.
- **Fallback gracioso da IXC**: o demo não libera ações; em produção, com as ações liberadas, o
  mesmo código passa a entregar o PDF sem mudança no app.