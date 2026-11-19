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
 * Doublon et période : le message cite date, montant, bénéficiaire, libellé et chèque, donc une écriture modifiée change la clé et l'anomalie validée réapparaît.
 * Bénéficiaire : le message ne cite que la nature et le bénéficiaire ; un changement de montant ou de date ne la fait pas réapparaître.
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

/**
 * Bénéficiaire incohérent avec la nature, pour G50 / IRG / IBS / CNAS / CASNOS :
 * - « Salaires du personnel » (un libellé de salaires, pas un organisme), pour toutes ces natures ;
 * - un bénéficiaire qui reprend la nature (« G50 SEPTEMBRE »), seulement pour G50 / IRG / IBS.
 * « CNAS », « CASNOS » ou « CNAS KOLEA » (agence réelle) comme bénéficiaire d'une nature CNAS / CASNOS sont normaux : jamais signalés.
 */
export function inconsistentBeneficiary(entry: Pick<HrEntryLike, "nature" | "beneficiaire">): string | null {
  if (!isOrganismNature(entry.nature)) return null;
  const name = normalizeBeneficiary(entry.beneficiaire);
  if (!name) return null;
  if (/\bSALAIRES?\b/.test(name)) return `nature ${entry.nature} avec le bénéficiaire « ${entry.beneficiaire} » (un libellé de salaires, pas un organisme)`;
  const nature = upperPlain(entry.nature).trim();
  if (isPeriodNature(entry.nature) && (name === nature || name.startsWith(`${nature} `))) return `nature ${entry.nature} avec un bénéficiaire qui reprend la nature (« ${entry.beneficiaire} ») au lieu de l'organisme`;
  return null;
}

/** Nombre maximal de validations conservées. */
export const MAX_VALIDATIONS = 500;

/** Lecture tolérante du réglage `{ items: [...] }` : les éléments mal formés sont ignorés. */
export function parseValidations(value: unknown): HrAnomalyValidation[] {
  const items = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return [];
  const out: HrAnomalyValidation[] = [];
  for (const raw of items as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.key !== "string" || !item.key) continue;
    out.push({ key: item.key, motif: typeof item.motif === "string" ? item.motif : "", par: typeof item.par === "string" ? item.par : "", parId: typeof item.parId === "string" ? item.parId : "", le: typeof item.le === "string" ? item.le : "" });
  }
  return out;
}

/** Résultat d'une mise à jour de la liste des validations. */
export type HrValidationUpdate = { ok: true; items: HrAnomalyValidation[] } | { ok: false; error: string };

/**
 * Ajoute des validations : purge d'abord celles dont l'anomalie n'existe plus (`currentKeys` = toutes les anomalies, toutes années),
 * remplace celles de mêmes clés, puis refuse (sans rien écraser) si la limite de 500 est dépassée.
 */
export function mergeValidations(existing: readonly HrAnomalyValidation[], added: readonly HrAnomalyValidation[], currentKeys: Iterable<string>, max = MAX_VALIDATIONS): HrValidationUpdate {
  const current = new Set(currentKeys);
  const addedKeys = new Set(added.map((item) => item.key));
  const items = [...existing.filter((item) => current.has(item.key) && !addedKeys.has(item.key)), ...added];
  if (items.length > max) return { ok: false, error: `Trop d'anomalies validées (${max} au plus). Rétablissez-en quelques-unes avant d'en valider d'autres.` };
  return { ok: true, items };
}

/** Retire une validation (et purge celles dont l'anomalie n'existe plus). */
export function removeValidation(existing: readonly HrAnomalyValidation[], key: string, currentKeys: Iterable<string>): HrValidationUpdate {
  const current = new Set(currentKeys);
  return { ok: true, items: existing.filter((item) => item.key !== key && current.has(item.key)) };
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
      // Paire triée par identifiant : message et clé ne dépendent pas de l'ordre de chargement des écritures.
      const [first, second] = a.id <= b.id ? [a, b] : [b, a];
      const found = compareHrEntries(first, second);
      if (found) out.push(withKey({ kind: "doublon", level: found.level, entryIds: [first.id, second.id], message: `${found.level === "certain" ? "Doublon" : "Doublon probable"} (${found.reason}) : ${describeHrEntry(first)} et ${describeHrEntry(second)}.` }));
    }
    const wrong = inconsistentBeneficiary(a);
    if (wrong) out.push(withKey({ kind: "beneficiaire", level: null, entryIds: [a.id], message: `Bénéficiaire incohérent : ${wrong}.` }));
    const cited = isPeriodNature(a.nature) ? citedPeriods(a.libelle, a.date?.slice(0, 7) || a.mois) : [];
    if (cited.length && a.monthKey && !cited.includes(a.monthKey)) {
      out.push(withKey({ kind: "periode", level: null, entryIds: [a.id], message: `Rattachée à ${monthName(a.monthKey)} alors que le libellé cite ${cited.map(monthName).join(", ")} : ${describeHrEntry(a)}.` }));
    }
  }
  const rank = (anomaly: HrAnomaly): number => (anomaly.kind === "doublon" ? (anomaly.level === "certain" ? 0 : 1) : anomaly.kind === "beneficiaire" ? 2 : 3);
  return out.sort((x, y) => rank(x) - rank(y) || x.key.localeCompare(y.key));
}
