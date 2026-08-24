# API — DBS Assistente

Referência dos endpoints do backend. Todas as rotas `/api/*` exigem o header:

```
x-app-token: app_token_dbs_2026
```

---

## POST /api/chat

Envia uma mensagem do usuário para o bot.

**Request**

```json
{
  "sessionId": "abc123",
  "message": "(64) 99999-9999",
  "phone": "64999999999"
}
```

- `sessionId`: gerado pelo app e persistido (máx. 64 caracteres).
- `phone` (opcional, máx. 24 caracteres): número do canal (ex.: WhatsApp).
  No estado inicial da sessão (`awaiting_phone`), se enviado, o bot tenta
  identificar o cliente automaticamente por esse número.
- **Identificação sem login**: a sessão começa em `awaiting_phone` e o bot
  pede o telefone. A mensagem digitada é normalizada (só dígitos, aceita
  10–11) e consultada na IXC em todas as colunas de telefone do cadastro
  (`telefone_celular`, `fone`, `telefone_comercial`, `whatsapp`, `ramal`).
  Encontrado → saúda **pelo nome** e vai ao menu; não encontrado → pede
  o número novamente.
- `0` / `menu` / `voltar` em qualquer estado retorna ao menu.

**Response** — `200`

```json
{
  "messages": [
    { "type": "text", "text": "Olá, Teste! 👋 Sou o assistente virtual da DBS TELECOM. Como posso ajudar você hoje?" },
    { "type": "menu", "text": "1 - Suporte técnico\n2 - Financeiro\n3 - Comercial\n0 - Voltar ao menu", "options": ["1 - Suporte técnico", "2 - Financeiro", "3 - Comercial", "0 - Voltar ao menu"] }
  ],
  "state": "menu"
}
```

**Tipos de mensagem**

| type    | Campos adicionais                          | Uso                              |
| ------- | ------------------------------------------ | -------------------------------- |
| `text`  | —                                          | Mensagem simples                 |
| `menu`  | `options: string[]`                        | Menu com botões (app renderiza)  |
| `boleto`| `boletoId?`, `pdfUrl?`, `linhaDigitavel?`  | Oferta de boleto (ações no app)  |
| `end`   | —                                          | Encaminhado para atendente       |

**Erros**

| Status | Exemplo                                 |
| ------ | --------------------------------------- |
| 400    | `{ "error": "sessionId é obrigatório" }` |
| 400    | `{ "error": "phone inválido" }`         |
| 401    | `{ "error": "token inválido" }`          |
| 500    | `{ "messages": [...], "state": "error" }` |

**Exemplo (PowerShell — usar `curl.exe`)**

```powershell
$body = '{"sessionId":"demo1","message":"(64) 99999-9999"}'
Set-Content "$env:TEMP\chat.json" $body -Encoding utf8
curl.exe -s -X POST http://localhost:3000/api/chat `
  -H "Content-Type: application/json" -H "x-app-token: app_token_dbs_2026" `
  --data-binary "@$env:TEMP\chat.json"
```

---

## GET /api/boleto/:idFatura

Baixa a 2ª via do boleto da fatura.

- **Com PDF disponível** (produção, ação `get_boleto` liberada): responde `application/pdf`
  (`Content-Disposition: inline; filename="boleto-<id>.pdf"`).
- **Sem PDF** (demo): responde JSON com a linha digitável.

```json
{
  "tipo": "linha_digitavel",
  "linhaDigitavel": "00190.00009 ...",
  "valor": "100.00",
  "vencimento": "2026-12-10"
}
```

| Status | Significado                  |
| ------ | ---------------------------- |
| 400    | `idFatura` inválido          |
| 401    | token inválido               |
| 404    | `{ "error": "boleto indisponível" }` |

**Exemplo**

```powershell
curl.exe -s http://localhost:3000/api/boleto/145690 -H "x-app-token: app_token_dbs_2026"
```

---

## GET /api/demandas

Lista as demandas registradas durante o atendimento (memória do processo + console).

```json
[
  {
    "cliente": "Teste Wbrnet",
    "departamento": "Suporte",
    "tipo": "lentidão não resolvida",
    "contexto": { "checklist": "executado, problema continua" },
    "timestamp": "2026-08-19T14:00:00.000Z"
  }
]
```

---

## GET /health

```json
{ "ok": true }
```

No boot, o backend também executa um `ping` na IXC e loga se o token está válido.