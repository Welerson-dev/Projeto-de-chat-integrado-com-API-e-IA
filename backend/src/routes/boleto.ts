import { Router, Request, Response } from "express";
import { ixc } from "../ixc/client";

export const boletoRouter = Router();

/**
 * GET /api/boleto/:idFatura
 * Baixa a 2ª via do boleto. Autenticado por x-app-token (middleware global).
 * - Com PDF disponível (ação get_boleto liberada): retorna application/pdf.
 * - Sem PDF (ação indisponível no demo): retorna JSON com a linha digitável.
 */
boletoRouter.get("/:idFatura", async (req: Request, res: Response) => {
  const id = Number(req.params.idFatura);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "idFatura inválido" });
  }

  try {
    const boleto = await ixc.getBoleto(id);
    if (boleto.pdfBase64) {
      const buf = Buffer.from(boleto.pdfBase64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="boleto-${id}.pdf"`);
      return res.send(buf);
    }
    if (boleto.pdfUrl) {
      return res.redirect(boleto.pdfUrl);
    }
  } catch (err) {
    console.error(`[boleto] ação get_boleto indisponível: ${(err as Error).message}`);
  }

  // Fallback: linha digitável da própria fatura.
  try {
    const fatura = await ixc.findFaturaById(id);
    if (fatura?.linha_digitavel) {
      return res.json({
        tipo: "linha_digitavel",
        linhaDigitavel: fatura.linha_digitavel,
        valor: fatura.valor,
        vencimento: fatura.data_vencimento,
      });
    }
  } catch (err) {
    console.error(`[boleto] erro fallback: ${(err as Error).message}`);
  }

  return res.status(404).json({ error: "boleto indisponível" });
});