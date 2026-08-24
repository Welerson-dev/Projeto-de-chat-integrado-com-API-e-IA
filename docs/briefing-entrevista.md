# Briefing para Entrevista — DBS Assistente

> Material de apoio para apresentar o projeto em entrevista de emprego.
> Use as seções na ordem: pitch → problema → solução → técnica → demo → perguntas.

---

## 1. Pitch (30 segundos)

"Desenvolvi o **DBS Assistente**, um chatbot de atendimento para provedora de
internet que resolve os três principais motivos de contato — suporte técnico,
financeiro e comercial — direto no celular do cliente, **sem login**. O cliente
se identifica pelo telefone cadastrado, o sistema consulta o ERP da provedora
(IXC Soft) em tempo real e uma IA (Google Gemini) entende mensagens livres como
'minha internet tá caindo'. O resultado: atendimentos automatizados de ponta a
ponta com escalonamento inteligente para atendentes humanos quando necessário."

## 2. O problema

Provedoras de internet pequenas/médias sofrem com alto volume de contatos repetitivos:

- **Suporte**: checklist de lentidão que poderia ser automatizado antes de abrir chamado;
- **Financeiro**: pedido de 2ª via de boleto e desbloqueio consomem tempo de atendente;
- **Comercial**: qualificação de venda (plano ideal, cobertura por bairro) feita manualmente.

Todo esse contexto vive no **IXC Soft** (ERP de telecom), mas não há canal
self-service amigável para o cliente final.

## 3. A solução

App mobile onde o cliente conversa como se fosse WhatsApp:

1. **Identificação sem login** — informa o telefone; o backend busca no cadastro
   IXC (celular, fixo, comercial, WhatsApp, ramal) e chama pelo nome;
2. **Menu + linguagem natural** — atalhos numéricos garantidos, mas mensagem
   livre é classificada pela IA Gemini e roteada para o fluxo certo;
3. **Fluxos completos** — checklist de lentidão (4 passos), 2ª via de boleto
   (PDF ou código de barras), desbloqueio com verificação de pendências,
   venda assistida (recomendação de plano por nº de aparelhos + viabilidade
   por bairro);
4. **Escalonamento** — quando o bot não resolve, registra a demanda com todo o
   contexto da conversa e encaminha ao departamento certo (com aviso de
   plantonista fora do horário comercial).

## 4. Stack e arquitetura

| Camada | Tecnologia | Papel |
|---|---|---|
| App | React Native + Expo SDK 57 (TypeScript) | Chat, telas Home/Chat, download de boleto |
| API | Node.js + Express + TypeScript | Orquestração, autenticação por token |
| ERP | IXC Soft (REST `webservice/v1`) | Clientes, contratos, faturas, ações |
| IA | Google Gemini (`gemini-3.6-flash`) | Classificação de intenção em texto livre |

**Decisão central de arquitetura** (fale isso na entrevista — mostra maturidade):

> "**Máquina de estados determinística** (`flows/session.ts`) para os fluxos de
> negócio, e a **IA apenas como classificadora de intenção**. Operações
> sensíveis (boleto, desbloqueio, venda) precisam de comportamento previsível e
> auditável — nunca deixaria um LLM 'improvisar' esses passos."

Fluxo de uma mensagem:

```
App → POST /api/chat (x-app-token)
     → sessão (sessionId) identifica estado atual
     → mensagem livre? → Gemini classifica intenção
     → precisa de dados? → IXC (contrato, faturas, ações)
     → monta resposta (+ botões de ação) → App
```

## 5. Pontos técnicos que valem destaque

1. **Degradation graciosa em toda integração externa**
   - Ação IXC indisponível no ambiente demo (PDF do boleto, desbloqueio)?
     Cai para a linha digitável / escalona — o atendimento **nunca trava**;
   - Sem chave Gemini? Responde com menu + aviso — **nunca usa fallback
     estático de classificação** (decisão consciente: preferível avisar do que classificar errado).

2. **Segurança desde o início**
   - Autenticação entre app e backend via header `x-app-token`;
   - Hardening aplicado: limite de payload JSON (10kb → 413) contra DoS,
     limite de 500 caracteres por mensagem (proteção contra abuso de custo da
     IA paga), error handler JSON (sem vazamento de stack trace);
   - **Suíte de segurança com 24 testes** rodando o servidor real em porta
     efêmera com stubs de IXC/Gemini — offline e reproduzível (runner nativo
     `node:test`, zero dependências extras);
   - Vulnerabilidades conhecidas **documentadas com teste skip e correção já
     escrita** (ex.: IDOR no endpoint de boleto) — abordagem honesta de MVP.

3. **Qualidade**
   - TypeScript end-to-end com `typecheck` no backend e no app;
   - Separação `createApp()` / `listen()` para viabilizar testes de integração;
   - Documentação completa: arquitetura, fluxos (FR-1..FR-18), referência de API,
     integração IXC e roteiro de demo.

## 6. Roteiro de demo (2 minutos)

Se puder demonstrar ao vivo, siga esta sequência (detalhes em `docs/demo-script.md`):

1. Abra o app → tela inicial DBS → **Iniciar chat**;
2. Digite o telefone cadastrado → bot responde **"Olá, {nome}!"** + menu
   *(mostre também um número inválido → erro amigável)*;
3. Opção **2** → boleto encontrado → **Baixar boleto** → **Copiar código de barras**;
4. Opção **1** → checklist sim/não até "o problema continua?" → **sim** → escalona;
5. Digite livre: **"minha internet caiu"** → IA classifica → abre o checklist sozinho;
6. Mostre `GET /api/demandas` com o registro completo dos atendimentos.

Plano B sem rede: tenha prints/vídeo das etapas — e conduza a apresentação
pela arquitetura (`docs/architecture.md`).

## 7. Perguntas prováveis do entrevistador

**"Por que máquina de estados em vez de deixar a IA conversar?"**
Previsibilidade e auditoria. Fluxos financeiros/comerciais têm regras de
negócio rígidas; a IA entra só onde há ambiguidade (classificar a intenção).
Isso reduz custo de tokens e risco alucinatório a praticamente zero nas etapas críticas.

**"Como você trata falhas da IA ou da API externa?"**
Camadas de fallback: resposta ambígua → pede esclarecimento; 2 tentativas →
escalona humano; integração fora → degrada o recurso (linha digitável em vez
de PDF) ou escalona com contexto registrado. O cliente nunca vê erro cru.

**"E se dois clientes usarem ao mesmo tempo?"**
Cada conversa tem `sessionId` isolado; o estado vive no servidor por sessão.
(Reconhecer limitação: persistência em memória no MVP — próximo passo seria Redis/Banco.)

**"O que você faria diferente / próximos passos?"**
- Corrigir o IDOR do `/api/boleto/:idFatura` validando posse da fatura (correção já escrita em teste);
- Persistir sessões e demandas em banco;
- Canal WhatsApp oficial (o contrato de `phone` no `/api/chat` já foi desenhado para isso);
- Rate limiting por telefone/sessão;
- Observabilidade (logs estruturados, métricas de resolução sem humano).

**"Quanto tempo levou / qual sua maior dificuldade?"**
Prepare sua própria resposta — boas âncoras técnicas:
- Descobrir as convenções reais da API IXC (auth, listagem, ações) — documentadas em `docs/ixc-integration.md`;
- Modelar a máquina de estados cobrindo todos os caminhos (multi-contrato, sem contrato, fatura quitada);
- Testar integrações pagas/externas sem dependê-las → stubs + servidor efêmero.

## 8. Fechamento (15 segundos)

"É um MVP enxuto mas production-minded: arquitetura testável, segurança
pensada desde o primeiro commit, fallbacks em toda borda e documentação que
permite qualquer dev continuar o projeto. Os pontos fracos eu conheço e tenho
o plano de correção pronto — que é exatamente como gosto de trabalhar."
