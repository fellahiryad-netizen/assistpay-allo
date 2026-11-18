import { db } from "@/lib/db";
import { branchLabel, branchOf } from "@/features/invoices/services/branch";
import { NOT_MONTHLY, productionPeriod } from "@/features/partners/services/advance-table";
import { fail, ok, type ActionResult } from "@/types";
import { formatDA } from "@/utils/format";
import { upperPlain } from "@/utils/text";
import { decimalToNumber } from "@/features/invoices/services/invoice-mapper";

/** Champs d'une facture utiles pour reconnaître une avance CAAT mensuelle. */
export interface AdvanceCandidate {
  sens: string;
  categorie: string;
  tiers: string;
  libelle: string;
  succursale: string;
  periode: string;
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * Une seule avance de 90 % par succursale et par mois pour le CAAT : refuse une deuxième avance sur la même case du tableau.
 * `excludeId` écarte la facture en cours de modification. Les régularisations, trimestres et refacturations ne sont pas concernés.
 */
export async function checkSingleAdvance(candidate: AdvanceCandidate, excludeId?: string): Promise<ActionResult<true>> {
  if (candidate.sens !== "CREDIT" || candidate.categorie !== "CAAT") return ok(true);
  if (NOT_MONTHLY.test(upperPlain(candidate.libelle))) return ok(true);
  const period = productionPeriod(candidate.periode, candidate.libelle);
  const key = branchOf(candidate);
  if (!period || !key) return ok(true);
  const rows = await db.invoice.findMany({ where: { sens: "CREDIT", categorie: "CAAT", status: { not: "ANNULE" }, payroll: false, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  const same = rows.filter(
    (row) => !NOT_MONTHLY.test(upperPlain(row.libelle)) && productionPeriod(row.periode, row.libelle) === period && branchOf({ categorie: row.categorie, succursale: row.succursale, tiers: row.tiers, libelle: row.libelle }) === key,
  );
  if (!same.length) return ok(true);
  const label = branchLabel(candidate) || key;
  const month = `${MONTHS[Number(period.slice(5, 7)) - 1] ?? period} ${period.slice(0, 4)}`;
  const list = same.map((row) => `« ${row.libelle} » (${formatDA(decimalToNumber(row.montant))}, ${row.status === "REGLE" ? "réglée" : "en attente"})`).join(" ; ");
  return fail(
    `Il existe déjà une avance pour ${label} · ${month} : ${list}. Il ne peut y avoir qu'une avance par mois. Corrigez celle-ci (Modifier), ou changez le mois ou la succursale de la nouvelle facture.`,
    "CONFLICT",
  );
}
