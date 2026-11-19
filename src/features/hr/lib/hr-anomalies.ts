import { citedPeriods, compareHrEntries, describeHrEntry, isOrganismNature, normalizeBeneficiary, type HrDuplicateLevel, type HrEntryLike } from "@/features/hr/lib/hr-duplicates";
import { MONTHS_FR } from "@/utils/dates";
import { upperPlain } from "@/utils/text";

/** Type d'anomalie repérée dans les écritures RH. */
export type HrAnomalyKind = "doublon" | "beneficiaire" | "periode";

/** Écriture RH et son mois de rattachement (celui du suivi : mois de la date de paiement si elle est dans l'année, sinon mois saisi). */
export interface HrAnomalyEntry extends HrEntryLike {
  id: string;
  monthKey: string;
}

/** Anomalie : indication à vérifier, jamais bloquante. */
export interface HrAnomaly {
  kind: HrAnomalyKind;
  /** Pour un doublon : certain ou probable. */
  level: HrDuplicateLevel | null;
  entryIds: string[];
  message: string;
}

const monthName = (key: string): string => `${(MONTHS_FR[Number(key.slice(5, 7)) - 1] ?? "").toLowerCase()} ${key.slice(0, 4)}`;

/** Bénéficiaire incohérent avec la nature : un organisme d'impôts ou de cotisations nommé « Salaires du personnel » ou « G50 SEPTEMBRE ». */
export function inconsistentBeneficiary(entry: Pick<HrEntryLike, "nature" | "beneficiaire">): string | null {
  if (!isOrganismNature(entry.nature)) return null;
  const name = normalizeBeneficiary(entry.beneficiaire);
  if (!name) return null;
  if (/\bSALAIRES?\b/.test(name)) return `nature ${entry.nature} avec le bénéficiaire « ${entry.beneficiaire} » (un libellé de salaires, pas un organisme)`;
  const nature = upperPlain(entry.nature).trim();
  if (name === nature || name.startsWith(`${nature} `)) return `nature ${entry.nature} avec un bénéficiaire qui reprend la nature (« ${entry.beneficiaire} ») au lieu de l'organisme`;
  return null;
}

/**
 * Anomalies d'une liste d'écritures : doublons suspects entre écritures, bénéficiaires incohérents avec la nature,
 * mois de rattachement différent de la période citée dans le libellé (simple indication).
 */
export function detectHrAnomalies(entries: readonly HrAnomalyEntry[]): HrAnomaly[] {
  const out: HrAnomaly[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const a = entries[i];
    if (!a) continue;
    for (let j = i + 1; j < entries.length; j += 1) {
      const b = entries[j];
      if (!b) continue;
      const found = compareHrEntries(a, b);
      if (found) out.push({ kind: "doublon", level: found.level, entryIds: [a.id, b.id], message: `${found.level === "certain" ? "Doublon" : "Doublon probable"} (${found.reason}) : ${describeHrEntry(a)} et ${describeHrEntry(b)}.` });
    }
    const wrong = inconsistentBeneficiary(a);
    if (wrong) out.push({ kind: "beneficiaire", level: null, entryIds: [a.id], message: `Bénéficiaire incohérent : ${wrong}.` });
    const cited = citedPeriods(a.libelle, a.date?.slice(0, 7) || a.mois);
    if (cited.length && a.monthKey && !cited.includes(a.monthKey)) {
      out.push({ kind: "periode", level: null, entryIds: [a.id], message: `Rattachée à ${monthName(a.monthKey)} alors que le libellé cite ${cited.map(monthName).join(", ")} : ${describeHrEntry(a)}.` });
    }
  }
  const rank = (anomaly: HrAnomaly): number => (anomaly.kind === "doublon" ? (anomaly.level === "certain" ? 0 : 1) : anomaly.kind === "beneficiaire" ? 2 : 3);
  return out.sort((x, y) => rank(x) - rank(y));
}
