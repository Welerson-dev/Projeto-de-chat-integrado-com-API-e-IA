# Segurança do MVP — Relatório e Resultados dos Testes

> Pasta de documentação da segurança do backend. Contém o relatório dos
> testes de segurança, as vulnerabilidades conhecidas e como corrigi-las.

## Como executar

```bash
cd backend
npm test            # roda toda a suíte de segurança (test:security)
npm run test:security
```

A suíte usa **Node.js 24** com o runner nativo `node:test` + `tsx` — sem
dependências novas. Os testes sobem o servidor real (`createApp`) em uma
porta efêmera e **interceptam as chamadas à IXC/Gemini** (stub em
`backend/test/security/helpers.ts`), ou seja, rodam offline e de forma
reproduzível.

## Estrutura

| Arquivo | O que cobre |
|---|---|
| `backend/src/app.ts` | `createApp()` — app isolado do `listen()` (refatorado p/ teste) + hardening mínimo |
| `backend/test/security/helpers.ts` | Servidor em porta efêmera + stub da IXC/Gemini |
| `backend/test/security/auth.test.ts` | Autenticação (`x-app-token`) e `/health` público |
| `backend/test/security/phone-identification.test.ts` | Identificação por telefone no chat (sem login) |
| `backend/test/security/validation.test.ts` | Validação de entrada (400s, tamanhos, idFatura, telefone) |
| `backend/test/security/vulnerabilities.test.ts` | Vulnerabilidades documentadas (skips) + verificações verdes |
| `docs/security/README.md` | Este relatório |
| `docs/security/test-results.txt` | Snapshot da última execução da suíte (para regravar: `cmd /c "npm run test:security > docs\security\test-results.txt 2>&1"`) |

## Resultado atual

```
✔ 24 testes passando
∅ 6 vulnerabilidades documentadas (it.skip com a correção pronta)
```

## Endurecimento já aplicado (escopo mínimo)

Estas correções pequenas foram feitas para os testes passarem — cada uma
está comentada no código com motivo/termos/vulnerabilidade/correção:

1. **Limite de corpo JSON** — `express.json({ limit: "10kb" })` → responde `413`
   (antes aceitava até 100kb, permitindo flood de payload/DoS).
2. **Limite de mensagem no `/api/chat`** — mensagens > 500 caracteres → `400`
   (antes iam verbatim para a IA paga, permitindo abuso de custo).
3. **Error handler JSON** — erros do parser agora respondem JSON enxuto
   (antes o Express vazava stack trace HTML com detalhes internos).
4. **Refatoração `app.ts`/`index.ts`** — separa a criação do app do `listen()`
   para viabilizar os testes (sem mudança de comportamento).

## Vulnerabilidades conhecidas (aceitas no MVP) e correção

Cada item abaixo tem um teste em `vulnerabilities.test.ts` marcado como
`it.skip` com a **assertiva da solução segura já escrita**. Para ativar:
remova o `skip` — o teste fica vermelho até a correção ser aplicada.

### 1. IDOR no `/api/boleto/:idFatura` — crítica

- **O que é:** IDOR = *Insecure Direct Object Reference*. O endpoint baixa
  boleto/linha digitável de **qualquer** id de fatura, sem conferir se a
  fatura pertence ao cliente da sessão. Como o token é público (embutido no
  app), basta enumerar ids (1, 2, 3...) para puxar boletos de terceiros.
- **Correção:** o app envia o `sessionId` no download; o backend só aceita
  faturas que estejam na lista de faturas em aberto do contrato daquela
  sessão (dados já carregados no fluxo `/api/chat`). Fora disso → `403/404`.

### 2. Sem rate limiting — alta

- **O que é:** não há limite de requisições. Permite abuso de custo da IA,
  enumeração de telefones na identificação e DoS por volume.
- **Correção:** `express-rate-limit` (ex.: 20 req/min por IP + por
  `sessionId`), retornando `429`.

### 3. Session hijacking (sessionId controlado pelo cliente) — alta

- **O que é:** o `sessionId` é escolhido pelo cliente e mantido num `Map`
  sem autenticação. Quem souber o id de outra pessoa assume a conversa dela
  (já identificada pelo telefone).
- **Correção:** o servidor gera o id (ex.: `crypto.randomUUID()`) no primeiro
  contato e o devolve na resposta; nunca aceitar id vindo do cliente.

### 4. Sem headers de segurança — média

- **O que é:** o Express não envia `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Strict-Transport-Security`, etc. (risco de
  clickjacking/interpretação errada de conteúdo).
- **Correção:** middleware `helmet`.

### 5. CORS aberto — média/baixa

- **O que é:** `cors()` sem opções libera qualquer origem (risco real apenas
  se houver integração web futura; o app mobile não usa CORS).
- **Correção:** lista de origens permitidas (domínio DBS) no `cors()`.

### 6. Prompt injection / reflexão de texto — média

- **O que é:** a mensagem do cliente vai verbatim ao prompt da Gemini e o
  texto de indicação comercial é refletido na resposta (risco de XSS em
  qualquer webview/web futuro e de manipulação da IA).
- **Correção:** delimitar a mensagem no prompt e validar o JSON de saída da
  IA; sanitizar/limitar o texto refletido; nunca usar `dangerouslySetInnerHTML`.

## Outros pontos observados (por fora da suíte)

- **Token único estático** embutido no app: proteção fraca — não identifica
  cliente, não expira, e trafega em texto puro (usar **HTTPS** em produção e
  migrar para autenticação por usuário/OAuth).
- **PII em memória/console:** `/api/demandas` guarda o nome do cliente e o
  `/api/chat` loga contexto. Não vaza documento hoje (verificado por teste),
  mas em produção guarde só o id interno do cliente e mascare documentos
  (`maskDocumento` em `backend/src/config.ts`).