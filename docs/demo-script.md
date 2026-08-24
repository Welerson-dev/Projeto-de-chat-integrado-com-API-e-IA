# Roteiro de Demo — DBS Assistente (etapa por etapa)

Roteiro completo para apresentar o MVP: cada etapa mostra uma funcionalidade
funcionando. Requisito 3.1 (tela inicial), 3.2 (identificação do cliente via
IXC pelo telefone, sem login).

## Pré-requisitos

- Backend rodando (`cd backend && npm run dev`) com `.env` preenchido
  (`IXC_TOKEN` e, para classificação por IA, `GEMINI_API_KEY`).
- App aberto no Expo Go (`cd app && npx expo start`).
- O **telefone do cliente** de teste precisa estar cadastrado na IXC
  (tabela cliente, campos `telefone_celular`/`fone`/`telefone_comercial`/
  `whatsapp`/`ramal`) para o bot identificar e chamar pelo nome.

---

## Etapa 1 — Tela inicial e início do chat (Req. 3.1)

1. Abra o app → aparece a tela inicial com a logo da DBS (**sem login**).
2. Toque em **Iniciar chat**.
3. Abre o chat e o bot já pede: **"Antes de começarmos, me informe o número
   de telefone cadastrado (com DDD)"**.

## Etapa 2 — Identificação do cliente pelo telefone (Req. 3.2)

1. Digite o telefone do cliente de teste, ex.: `(64) 99999-9999`.
2. O backend consulta a IXC (todas as colunas de telefone do cadastro).
3. Número cadastrado → o bot responde **"Olá, {nome}! 👋 Sou o assistente
   virtual da DBS TELECOM..."** + menu.
4. Teste negativo: digite um número não cadastrado → "Não localizei esse
   número em nosso cadastro..." e ele pede novamente.

> Acontece por trás: `POST /api/chat` → `ixc.findClienteByTelefone()`.

## Etapa 3 — Menu e fluxos de atendimento

O menu mostra: `1 - Suporte técnico / 2 - Financeiro / 3 - Comercial / 0`.

- **2 (Financeiro)** → 2ª via do boleto: toque em **Baixar boleto** → como o
  demo não libera PDF, cai na **linha digitável** → **Copiar código de barras**.
- **1 (Suporte técnico)** → checklist de lentidão (responda **sim**/**não**);
  em "o problema continua?" diga **sim** → o bot escalona e registra a demanda.
- **3 (Comercial)** → quantos aparelhos, bairro/cidade, vencimento, indicação
  → o bot apresenta o resumo e encaminha ao comercial.
- **0 / menu** em qualquer momento → volta ao menu.

## Etapa 4 — Mensagem livre com IA (classificação)

1. No menu, digite uma mensagem livre: **"minha internet caiu"**.
2. Com a `GEMINI_API_KEY` configurada, a IA classifica como **suporte** e o
   bot inicia o checklist. (Sem chave, responde com o menu e o aviso.)

## Etapa 5 — Registro de demandas

1. `GET /api/demandas` (header `x-app-token`) mostra os atendimentos
   registrados (cliente, setor, contexto) — sem documento do cliente.

---

## Endpoints usados na demo (curl.exe)

```powershell
# Chat com identificação pelo telefone digitado no chat
$body = '{"sessionId":"demo1","message":"(64) 99999-9999"}'
Set-Content "$env:TEMP\chat.json" $body -Encoding utf8
curl.exe -s -X POST http://localhost:3000/api/chat `
  -H "Content-Type: application/json" -H "x-app-token: app_token_dbs_2026" `
  --data-binary "@$env:TEMP\chat.json"

# Variação: número vindo do canal (ex.: WhatsApp) → identificação automática
$body = '{"sessionId":"demo2","message":"oi","phone":"64999999999"}'
Set-Content "$env:TEMP\chat-canal.json" $body -Encoding utf8
curl.exe -s -X POST http://localhost:3000/api/chat `
  -H "Content-Type: application/json" -H "x-app-token: app_token_dbs_2026" `
  --data-binary "@$env:TEMP\chat-canal.json"
```

## Clientes de teste no demo

| ID    | Nome        | Documento         | Contrato         | Faturas abertas             |
| ----- | ----------- | ----------------- | ---------------- | --------------------------- |
| 2270  | Teste Wbrnet | CNPJ 03.824.222/0001-17 | Velocidade 300M (status A) | 145687–145690 (R$ 100,00, venc. 10/12) |
| 2269  | Everaldo    | CPF 024.403.310-23 | —                | 145686 (sem boleto/avulsa)  |

> ⚠️ Para a **identificação por telefone** (Etapa 2), o número usado precisa
> estar cadastrado na IXC (campos `telefone_celular`/`fone`/
> `telefone_comercial`/`whatsapp`/`ramal` do cliente). Confira o número que
> será usado antes da apresentação.