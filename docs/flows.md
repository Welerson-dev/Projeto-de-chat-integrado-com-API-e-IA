# Fluxos de Atendimento

Descrição de cada fluxo implementado na máquina de estados (`backend/src/flows/session.ts`),
com o texto que o bot apresenta e as transições.

Legenda: **[bot]** = mensagem do bot · **[cli]** = entrada do cliente · **IA** = classificação Gemini.

---

## 1. Identificação por telefone (sem login)

Não existe tela de login nem pedido de CPF/CNPJ. A sessão nasce no estado
`awaiting_phone` e o bot pede o telefone:

```
[bot]  Antes de começarmos, me informe o número de telefone cadastrado (com DDD). Ex.: (64) 99999-9999
[cli]  (64) 99999-9999
[bot]  Olá, Teste! 👋 Sou o assistente virtual da DBS TELECOM. Como posso ajudar você hoje?
[bot]  1 - Suporte técnico
       2 - Financeiro
       3 - Comercial
```

- O texto é normalizado (só dígitos; remove o código do país "55") e aceito com
  **10 ou 11 dígitos** — qualquer outra coisa recebe aviso de número inválido.
- Busca na IXC pela tabela `cliente` em **todas as colunas de telefone**:
  `telefone_celular`, `fone`, `telefone_comercial`, `whatsapp` e `ramal`
  (exemplo oficial "listar cliente por telefone" da wiki da IXC). O casamento
  final compara só os dígitos, então funciona com ou sem formatação/DDD.
- Se o canal enviar o número no campo opcional `phone` (ex.: WhatsApp), a
  identificação é automática — o cliente nem precisa digitar.
- Cliente com **mais de um contrato ativo** → o bot pede para escolher
  (`select_contract`).
- Sem contrato ativo → apresenta os planos e vai ao menu.
- Número válido mas não cadastrado → "Não localizei esse número..." e pede
  novamente (sem confirmar existência de cadastro de terceiros).

## 2. Menu e classificação (FR-4..FR-6)

- **Dígitos**: `1` → Suporte, `2` → Financeiro, `3` → Comercial (atalhos garantidos).
- **Mensagem livre** → classificação **sempre via Gemini** (FR-5):
  - `suporte` → inicia checklist de lentidão (ou encaminha conforme fluxo);
  - `financeiro` → boleto; se o fluxo for `desbloqueio`, entra no desbloqueio;
  - `comercial` → fluxo de contratação;
  - `menu` → volta ao menu;
  - `unknown`/`confidence=low` → pede esclarecimento; após **2 tentativas**, escalona.
- Sem chave Gemini configurada → responde com o menu + aviso de instabilidade
  (nunca usa classificação estática).

## 3. Checklist de lentidão — Suporte (FR-7/FR-8)

4 passos com validação de sim/não:

| Passo | Pergunta do bot |
| ----- | --------------- |
| 1 | A lentidão acontece em **mais de um dispositivo**? |
| 2 | Cabos conectados e luzes do equipamento normais? |
| 3 | Reiniciar o equipamento (30 s desligado) — pode fazer agora? |
| 4 | Após o reinício, **o problema continua**? |

- **P4 = não** → "Que ótimo que resolveu! 😊" + volta ao menu.
- **P4 = sim** → escalona para **Suporte** ("Atendente de Suporte irá responder em instantes.")
  e registra a demanda com o contexto do checklist.
- Resposta inválida (2x) → escalona.

## 4. Boleto — Financeiro (FR-9/FR-10)

```
[cli]  2
[bot]  Encontrei seu boleto no valor de R$ 100.00 com vencimento em 2026-12-10.
       Vou disponibilizá-lo para você baixar. 💳        ← botão "Baixar boleto"
```

- Lista faturas **em aberto** (`status = "A"`) do contrato via IXC.
- **Sem faturas em aberto (tudo quitado)** → pergunta se o cliente deseja
  consultar o **último boleto**:
  - **Sim** → busca todas as faturas do contrato (mais recente primeiro,
    preferindo uma paga `status = "R"`) e entrega o boleto:
    - **Com PDF** (produção) → botão baixa o PDF e abre o compartilhamento;
    - **Sem PDF** (demo) → botão oferece **"Copiar código de barras"**
      (linha digitável);
  - **Não** → segue na conversa livre do financeiro ("Me conta qual é a sua
    dúvida...");
  - Resposta ambígua → interpretada pela IA (sim/não); incerta → pede
    esclarecimento e escalona após 2 tentativas.
- **Com faturas em aberto** → oferece a 2ª via da mais recente diretamente:
  - **Com PDF** (produção) → botão baixa o PDF e abre o compartilhamento do sistema.
  - **Sem PDF** (demo) → botão oferece **"Copiar código de barras"** (linha digitável) para
    pagar pelo app do banco.
- Falha total → escalona para Financeiro com o contexto da pendência.

## 5. Desbloqueio — Financeiro (FR-11/FR-12)

- **Com pendência** → informa o valor/vencimento e oferece o boleto; o acesso é liberado
  após a confirmação do pagamento (mensagem explicativa).
- **Sem pendência** → executa a ação `get_liberacao_bloqueio` na IXC
  (indisponível no demo → escalona para Suporte com demanda registrada).

## 6. Contratação — Comercial (FR-15..FR-18)

```
[cli]  3
[bot]  Lista dos planos urbanos + Wi-Fi 6, fidelidade e ativação.
       Para eu te recomendar o plano ideal: quantos aparelhos usam a internet?
[cli]  6
[bot]  Recomendo o plano Wi-Fi 6 de 500 MB por R$ 119,90...
       Para confirmarmos a disponibilidade, me informe seu bairro e cidade.
[cli]  Centro, Goiânia
[bot]  Maravilha, conseguimos atender sua região! ✅
       Qual a melhor data de vencimento? (Sugestão: dia 10)
[cli]  10
[bot]  Indicando alguém que feche com a DBS, você ganha 50% de desconto. Teria alguém para indicar?
[cli]  não
[bot]  Confirme o resumo da sua solicitação: ... + Atendente comercial irá responder em instantes.
```

- Recomendação por faixa de aparelhos: ≤4 → IDEAL DBS 500 MB; 5–8 → Wi-Fi 6 500 MB;
  >8 → Wi-Fi 6 600 MB+.
- Viabilidade por bairro (tabela estática; bairro não atendido → resposta amigável + menu).
- O resumo é registrado como demanda do Comercial (o bot não fecha venda — FR-13).

## 7. Escalonamento (FR-6/FR-8/FR-12/FR-13)

- Gatilhos: checklist não resolvido, respostas não reconhecidas (2x), falha de integração,
  desbloqueio com pendência, finalização comercial, classificação desconhecida (2x).
- Sempre registra demanda (`/api/demandas`) e termina o fluxo com a mensagem
  **"Atendente de <Departamento> irá responder em instantes."** (com aviso de plantonista
  fora do horário 8h–18h).

## Comandos globais

| Entrada | Efeito |
| ------- | ------ |
| `0`, `menu`, `voltar` | Volta ao menu (qualquer estado, exceto identificação) — atalho oculto; o menu em si não lista a opção 0 |
| `sim`/`não` (checklist) | Avança pelo checklist |

### Checklist de lentidão com interpretação por IA

As respostas do checklist aceitam linguagem natural. Regras locais
("sim", "não", "só", "apenas"...) resolvem primeiro; quando nenhuma casa,
o backend pergunta à IA se a resposta livre significa **sim** ou **não**
para a pergunta da etapa (ex.: "celular e computador" → sim para "acontece
em mais de um dispositivo?"). Se a IA ficar incerta ou indisponível, o bot
pede esclarecimento ("Pode responder com sim ou não?") como antes.