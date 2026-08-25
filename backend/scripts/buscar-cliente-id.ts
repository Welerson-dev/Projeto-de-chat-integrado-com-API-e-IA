/**
 * Busca um cliente por ID na base IXC e exibe seus dados, incluindo telefones.
 *
 * Como usar:
 *   cd backend
 *   npm run ixc:cliente <ID>
 *
 * Exemplo:
 *   npm run ixc:cliente 2270
 */
import "dotenv/config";
import { ixc } from "../src/ixc/client";
import { maskDocumento } from "../src/config";

const idArg = process.argv[2];
if (!idArg || isNaN(Number(idArg))) {
  console.error("Uso: npm run ixc:cliente <ID>");
  console.error("Exemplo: npm run ixc:cliente 2270");
  process.exit(1);
}

const id = Number(idArg);

async function main() {
  console.log(`Buscando cliente ID ${id} na IXC...\n`);

  const cliente = await ixc.findClienteById(id);
  if (!cliente) {
    console.log(`Cliente ID ${id} não encontrado.`);
    return;
  }

  console.log("=== DADOS DO CLIENTE ===\n");
  console.log(`  ID:          ${cliente.id}`);
  console.log(`  Nome:        ${cliente.nome ?? "(vazio)"}`);
  console.log(`  Razão:       ${cliente.razao ?? "(vazio)"}`);
  console.log(`  Fantasia:    ${cliente.fantasia ?? "(vazio)"}`);
  console.log(`  Documento:   ${cliente.cnpj_cpf ? maskDocumento(cliente.cnpj_cpf) : "(vazio)"}`);
  console.log(`  Tipo pessoa: ${cliente.tipo_pessoa ?? "(vazio)"}`);
  console.log(`  Ativo:       ${cliente.ativo ?? "(vazio)"}`);
  console.log(`\n=== TELEFONES ===\n`);
  console.log(`  Celular:     ${cliente.telefone_celular ?? "(vazio)"}`);
  console.log(`  Fone:        ${cliente.fone ?? "(vazio)"}`);
  console.log(`  Comercial:   ${cliente.telefone_comercial ?? "(vazio)"}`);
  console.log(`  WhatsApp:    ${cliente.whatsapp ?? "(vazio)"}`);
  console.log(`  Ramal:       ${cliente.ramal ?? "(vazio)"}`);

  const telefones = [cliente.telefone_celular, cliente.fone, cliente.telefone_comercial, cliente.whatsapp, cliente.ramal]
    .filter((t) => t && String(t).replace(/\D/g, "").length >= 8);
  console.log(`\n>>> Número(s) para usar no app: ${telefones.length ? telefones.join(", ") : "NENHUM CADASTRADO"}`);
}

main().catch((err: Error) => {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
});
