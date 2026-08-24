# Integração IXC Soft — Convenções Validadas

Documento de referência para integrar com a API REST do IXC Soft (`webservice/v1`).
As convenções abaixo foram **validadas no dia 0** contra o demo real e **corrigem** o que o SDK/PRD sugeria.

## Base e autenticação

- Base: `https://demo.ixcsoft.com.br/webservice/v1`
- Autenticação: **Basic Auth** com o **token cru** em base64:

  ```
  Authorization: Basic base64(<TOKEN_CRU>)
  ```

  > ⚠️ **NÃO** usar `token:<TOKEN>` no usuário. Testes: `token:TOKEN` → HTTP 401;
  > token cru → HTTP 200. O token é **único e irrecuperável** — se perder, solicite outro.

## Listagem de registros

Usar **POST** com o header de ação e corpo `x-www-form-urlencoded`:

```http
POST /webservice/v1/{tabela}
ixcsoft: listar
Content-Type: application/x-www-form-urlencoded

qtype=<campo>&query=<valor>&oper=equal&page=1&rp=10
```

- `qtype`/`query`: campo e valor a filtrar (ex. `cnpj_cpf`, `id_cliente`, `id_contrato`).
- **GET com query string não funciona** → responde `Recurso ... não está disponível!`.
- **POST sem o header `ixcsoft` cai no CREATE** (validações de inclusão).

### Headers de CRUD (`ixcsoft`)

| Operação  | Header           |
| --------- | ---------------- |
| Listar    | `ixcsoft: listar`  |
| Obter     | `ixcsoft: obter`   |
| Incluir   | `ixcsoft: incluir` |
| Alterar   | `ixcsoft: alterar` |
| Deletar   | `ixcsoft: deletar` |

Ações de módulo (ex. `get_boleto`) **não usam** o header `ixcsoft` (sem ele o POST é roteado para a ação).

## Tabelas usadas no MVP

| Tabela             | Uso                                                    |
| ------------------ | ------------------------------------------------------ |
| `cliente`          | Busca por telefone (identificação no chat)             |
| `cliente_contrato` | Contratos do cliente (`id_cliente`)                    |
| `fn_areceber`      | Faturas em aberto do contrato (`id_contrato`)          |

## Busca de cliente por telefone

Segue o exemplo oficial "listar cliente por telefone" da wiki da IXC
(https://wikiapiprovedor.ixcsoft.com.br/index.php). Campos oficiais da tabela
`cliente`:

| Coluna               | Significado            |
| -------------------- | ---------------------- |
| `telefone_celular`   | Celular                |
| `fone`               | Telefone principal     |
| `telefone_comercial` | Telefone comercial     |
| `whatsapp`           | WhatsApp               |
| `ramal`              | Ramal                  |

A busca tenta, em ordem, `telefone_celular`, `fone`, `telefone_comercial`,
`whatsapp` e `ramal`. Em cada coluna consulta com o operador `=` nas
variações de formatação do número (`(49) 98877-8877` e `49988778877`) e
confirma o resultado comparando só os dígitos (aceita com ou sem DDD).

**Comportamento real da base (validado no demo):**

- Os telefones são gravados **formatados** — ex.: `(49) 98877-8877`. Uma
  consulta `=` com o número cru não encontra nada.
- O operador **`LIKE` não é aceito**: a IXC responde com uma página de erro
  em HTML (não-JSON). Por isso a busca usa apenas `=` com variações de
  formatação.
- O nome do cliente está na coluna `razao` (razão social) — não existe
  coluna `nome` nesta instalação.

## Fatura (`fn_areceber`)

- `status = "A"` → **aberto** (em aberto).
- Vencimento: campo **`data_vencimento`** (não `vencimento`).
- `linha_digitavel` disponível no cadastro da fatura.
- `valor`/`valor_aberto` para exibição.

## Ações de módulo

### 2ª via de boleto (`get_boleto`)

Rota oficial do SDK:

```http
POST /webservice/v1/get_boleto
Content-Type: application/json

{
  "boletos": "145690",
  "tipo_boleto": "arquivo",
  "base64": "S",
  "juro": "N",
  "multa": "N",
  "atualiza_boleto": "N"
}
```

- Resposta esperada em produção: `application/pdf` (ou JSON com base64 quando `base64: "S"`).
- **No demo esta ação não está liberada**: `/webservice/v1/get_boleto` retorna HTML vazio e
  `/webservice/v1/fn_areceber/action/get_boleto` cai em validação de CREATE.
- **Estratégia implementada**: tentar a rota oficial → em erro, **fallback para a linha digitável**
  da fatura (`linha_digitavel`) no app + mensagem para pagar pelo app do banco.

### Desbloqueio (`get_liberacao_bloqueio`)

- Rota SDK: `/webservice/v1/cliente_contrato/action/get_liberacao_bloqueio`
- **Também não exposta no demo** → o fluxo de desbloqueio sem pendência tenta a ação e, em falha,
  **escalona para Suporte** com registro de demanda.

## Resumo das correções vs. PRD/SDK

| Item                        | Sugestão inicial (SDK/PRD)      | Validado no demo                   |
| --------------------------- | ------------------------------- | ---------------------------------- |
| Auth                        | `token:TOKEN` no Basic          | Token cru em base64 (`base64(TOKEN)`) |
| Listagem                    | GET com query string            | POST + `ixcsoft: listar` + form     |
| `get_boleto`                | Sempre PDF via SDK              | Ação indisponível → fallback linha digitável |
| Vencimento da fatura        | `vencimento`                    | `data_vencimento`                   |
| Status da fatura            | —                               | `"A"` = aberto                      |