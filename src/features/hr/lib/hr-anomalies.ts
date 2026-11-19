import { citedPeriods, compareHrEntries, describeHrEntry, isOrganismNature, normalizeBeneficiary, type HrDuplicateLevel, type HrEntryLike } from "@/features/hr/lib/hr-duplicates";
import { isPeriodNature } from "@/features/hr/lib/hr-period";
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
  /** Clé stable (voir `anomalyKey`) : sert à valider ou rétablir l'anomalie. */
  key: string;
  kind: HrAnomalyKind;
  /** Pour un doublon : certain ou probable. */
  level: HrDuplicateLevel | null;
  entryIds: string[];
  message: string;
}

/** Hachage djb2 court (base 36) d'un texte. */
export function shortHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = (Math.imul(hash, 33) + text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

/**
 * Clé stable d'une anomalie : `type:identifiants triés joints par +:hachage du message`.
 * Le message cite date, montant, bénéficiaire, libellé et chèque : une écriture modifiée change la clé, et l'anomalie validée réapparaît.
 */
export function anomalyKey(anomaly: { kind: HrAnomalyKind; entryIds: readonly string[]; message: string }): string {
  return `${anomaly.kind}:${[...anomaly.entryIds].sort().join("+")}:${shortHash(anomaly.message)}`;
}

/** Validation d'une anomalie (« j'ai vérifié, c'est normal »). */
export interface HrAnomalyValidation {
  key: string;
  motif: string;
  par: string;
  parId: string;
  /** Horodatage ISO. */
  le: string;
}

/** Sépare les anomalies à traiter de celles déjà validées (avec leur validation). Une validation sans anomalie correspondante est ignorée. */
export function partitionAnomalies(anomalies: readonly HrAnomaly[], validations: readonly HrAnomalyValidation[]): { open: HrAnomaly[]; validated: Array<{ anomaly: HrAnomaly; validation: HrAnomalyValidation }> } {
  const byKey = new Map(validations.map((validation) => [validation.key, validation]));
  const open: HrAnomaly[] = [];
  const validated: Array<{ anomaly: HrAnomaly; validation: HrAnomalyValidation }> = [];
  for (const anomaly of anomalies) {
    const validation = byKey.get(anomaly.key);
    if (validation) validated.push({ anomaly, validation });
    else open.push(anomaly);
  }
  return { open, validated };
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

const withKey = (anomaly: Omit<HrAnomaly, "key">): HrAnomaly => ({ ...anomaly, key: anomalyKey(anomaly) });

/**
 * Anomalies d'une liste d'écritures : doublons suspects entre écritures, bénéficiaires incohérents avec la nature,
 * mois de rattachement différent de la période citée dans le libellé (simple indication, seulement pour G50 / IRG / IBS).
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
      if (found) out.push(withKey({ kind: "doublon", level: found.level, entryIds: [a.id, b.id], message: `${found.level === "certain" ? "Doublon" : "Doublon probable"} (${found.reason}) : ${describeHrEntry(a)} et ${describeHrEntry(b)}.` }));
    }
    const wrong = inconsistentBeneficiary(a);
    if (wrong) out.push(withKey({ kind: "beneficiaire", level: null, entryIds: [a.id], message: `Bénéficiaire incohérent : ${wrong}.` }));
    const cited = isPeriodNature(a.nature) ? citedPeriods(a.libelle, a.date?.slice(0, 7) || a.mois) : [];
    if (cited.length && a.monthKey && !cited.includes(a.monthKey)) {
      out.push(withKey({ kind: "periode", level: null, entryIds: [a.id], message: `Rattachée à ${monthName(a.monthKey)} alors que le libellé cite ${cited.map(monthName).join(", ")} : ${describeHrEntry(a)}.` }));
    }
  }
  const rank = (anomaly: HrAnomaly): number => (anomaly.kind === "doublon" ? (anomaly.level === "certain" ? 0 : 1) : anomaly.kind === "beneficiaire" ? 2 : 3);
  return out.sort((x, y) => rank(x) - rank(y));
}
