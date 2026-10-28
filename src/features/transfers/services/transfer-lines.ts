import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { round2 } from "@/utils/amounts";

/**
 * Ligne d'un fichier de virements, au format stocké par l'ancienne version :
 * [n° de ligne, banque, agence, compte, clé, nom, prénom, adresse, montant, sens D/C, complété, montant en texte].
 */
export interface TransferLine {
  row: number;
  banque: string;
  agence: string;
  compte: string;
  cle: string;
  nom: string;
  prenom: string;
  adresse: string;
  montant: number;
  sens: "D" | "C" | string;
}

const storedLine = z.array(z.unknown()).min(10);

/** Lit les lignes stockées d'un envoi ; les lignes illisibles sont ignorées. */
export function readTransferLines(value: Prisma.JsonValue): TransferLine[] {
  if (!Array.isArray(value)) return [];
  const out: TransferLine[] = [];
  for (const item of value) {
    const parsed = storedLine.safeParse(item);
    if (!parsed.success) continue;
    const a = parsed.data;
    const text = (index: number): string => (a[index] === null || a[index] === undefined ? "" : String(a[index]));
    const amount = Number(a[8]);
    out.push({
      row: Number(a[0]) || 0,
      banque: text(1),
      agence: text(2),
      compte: text(3),
      cle: text(4),
      nom: text(5),
      prenom: text(6),
      adresse: text(7),
      montant: Number.isFinite(amount) ? round2(amount) : 0,
      sens: text(9).toUpperCase(),
    });
  }
  return out;
}

/** Écrit une ligne au format stocké (compatible avec l'ancienne version). */
export function storeTransferLine(line: TransferLine): Prisma.InputJsonValue {
  return [line.row, line.banque, line.agence, line.compte, line.cle, line.nom, line.prenom, line.adresse, line.montant, line.sens, 0, 0];
}

/** Bénéficiaires d'un envoi : lignes C regroupées par compte (un prestataire peut avoir plusieurs virements). */
export interface TransferBeneficiary {
  key: string;
  nom: string;
  montant: number;
  count: number;
}

/** Regroupe les lignes C d'un envoi par compte bancaire. */
export function transferBeneficiaries(lines: TransferLine[]): TransferBeneficiary[] {
  const map = new Map<string, TransferBeneficiary>();
  for (const line of lines) {
    if (line.sens !== "C") continue;
    const key = `${line.banque}${line.compte}`;
    const nom = `${line.nom} ${line.prenom}`.replace(/\s+/g, " ").trim();
    const current = map.get(key) ?? { key, nom, montant: 0, count: 0 };
    current.montant = round2(current.montant + line.montant);
    current.count += 1;
    map.set(key, current);
  }
  return [...map.values()];
}

/** Libellé du produit d'un envoi (A = assistance routière, B = BDG). */
export function productLabel(type: string): string {
  return type === "B" ? "BDG" : type === "A" ? "Assistance routière" : type || "—";
}
