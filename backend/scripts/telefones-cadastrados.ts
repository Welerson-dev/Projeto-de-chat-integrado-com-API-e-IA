/**
 * Lista os telefones cadastrados na base IXC, para você saber QUAL número
 * digitar no app na hora de testar o chat.
 *
 * Como usar:
 *   cd backend
 *   npm run ixc:telefones
 */
import "dotenv/config";
import { config } from "../src/config";
import { ixc } from "../src/ixc/client";

// Formato dos registros que a IXC devolve na tabela "cliente"
interface ClienteLinha {
  id?: number;
  nome?: string;
  razao?: string;
  telefone_celular?: string;
  fone?: string;
  telefone_comercial?: string;
  whatsapp?: string;
  ramal?: string;
}

// Consulta a tabela "cliente" (mesmo padrão do client.ts: POST + header ixcsoft:listar)
async function listarClientes(): Promise<ClienteLinha[]> {
  const auth = "Basic " + Buffer.from(config.ixcToken, "utf8").toString("base64");
  const res = await fetch(`${config.ixcUrl}/webservice/v1/cliente`, {
    method: "POST",
    headers: {
      Authorization: auth,
      ixcsoft: "listar",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      qtype: "cliente.ativo", // filtra por clientes ativos
      query: "S",
      oper: "=",
      page: "1",
      rp: "30", // traz até 30 registros
      sortname: "cliente.id",
      sortorder: "desc",
    }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`A IXC respondeu HTTP ${res.status} (confira token/URL no .env)`);
  const data = (await res.json()) as { registros?: ClienteLinha[] };
  return data.registros ?? [];
}

// Devolve o primeiro campo de telefone preenchido do cliente
function primeiroTelefone(c: ClienteLinha): string | null {
  for (const v of [c.telefone_celular, c.fone, c.telefone_comercial, c.whatsapp, c.ramal]) {
    if (v && String(v).replace(/\D/g, "")) return String(v);
  }
  return null;
}

async function main() {
  console.log(`Consultando clientes ativos em ${config.ixcUrl}...\n`);
  const clientes = await listarClientes();

  if (!clientes.length) {
    console.log("Nenhum cliente ativo encontrado na base.");
    return;
  }

  console.log("=== NÚMEROS PARA TESTAR NO APP ===\n");
  let achouAlgum = false;
  for (const c of clientes) {
    const tel = primeiroTelefone(c);
    if (tel) {
      achouAlgum = true;
      const nome = c.nome ?? c.razao ?? "(sem nome)";
      console.log(`  ${nome.padEnd(25)} ${tel}`);
    }
  }
  if (!achouAlgum) {
    console.log("  Nenhum cliente desta página tem telefone preenchido no cadastro.");
  }

  // Validação ponta a ponta: usa a mesma função que o fluxo do chat usa.
  const numeroTeste = clientes.map(primeiroTelefone).find(Boolean);
  if (numeroTeste) {
    console.log(`\n=== TESTE DA BUSCA DO BOT (número ${numeroTeste}) ===`);
    const cliente = await ixc.findClienteByTelefone(numeroTeste);
    console.log(
      cliente?.id
        ? `OK! Digitando esse número no app, o bot identifica: ${cliente.nome ?? cliente.razao} (id ${cliente.id})`
        : "ATENÇÃO: o número está no cadastro, mas a busca do bot não achou. Ajustar matching.",
    );
  }
}

main().catch((err: Error) => {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
});
