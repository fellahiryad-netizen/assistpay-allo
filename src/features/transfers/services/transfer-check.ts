import type { SheetCell } from "@/lib/spreadsheet";
import type { CheckedLine, FileCheck, Severity, TransferAnalysis } from "@/features/transfers/types";
import type { TransferLine } from "@/features/transfers/services/transfer-lines";
import { BANKS, DONOR_RIB, MONTHLY_DOUBLE_CHECK, TRANSFER_CEILING, ribKey, type TransferProduct } from "@/features/transfers/services/rib";
import { round2 } from "@/utils/amounts";
import { formatDA } from "@/utils/format";
import { nameSimilarity, nameTokens, upperPlain } from "@/utils/text";

const RANK: Readonly<Record<Severity, number>> = { ok: 0, info: 1, warn: 2, err: 3 };

/** Compte connu du référentiel, avec son historique de virements validés. */
export interface KnownAccount {
  key: string;
  noms: string[];
  types: string[];
  rib: string;
  oldRibs: string[];
  refusedRibs: string[];
  status: string;
  history: Array<{ batchId: string; ref: string; mois: string; amount: number }>;
}

/** Envoi déjà enregistré (pour repérer un fichier envoyé deux fois). */
export interface KnownBatch {
  id: string;
  ref: string;
  mois: string;
  src: string;
  status: string;
  signature: string;
}

/** Base de connaissance : référentiel RIB et envois. */
export interface TransferKnowledge {
  accounts: Map<string, KnownAccount>;
  batches: KnownBatch[];
  byName: Map<string, Set<string>>;
  /** Seuil de double validation (paramètre « controle », 2 000 000 DA par défaut). */
  monthlyThreshold?: number;
}

const COLUMN_TESTS: ReadonlyArray<[keyof ColumnMap, (header: string) => boolean]> = [
  ["banque", (h) => /^(CODE )?BANQUE/.test(h)],
  ["agence", (h) => /AGENCE/.test(h)],
  ["compte", (h) => /^(N |NUM |NUMERO )?COMPTE/.test(h)],
  ["cle", (h) => /^CLE/.test(h)],
  ["prenom", (h) => /PRENOM/.test(h)],
  ["nom", (h) => /^NOM|RAISON|BENEFICIAIRE/.test(h)],
  ["adresse", (h) => /ADRESSE|WILAYA|VILLE/.test(h)],
  ["montant", (h) => /MONTANT/.test(h)],
  ["sens", (h) => /^SENS|^D C$/.test(h)],
  ["rib", (h) => /^RIB/.test(h)],
];

interface ColumnMap {
  banque?: number;
  agence?: number;
  compte?: number;
  cle?: number;
  prenom?: number;
  nom?: number;
  adresse?: number;
  montant?: number;
  sens?: number;
  rib?: number;
}

const headerText = (cell: SheetCell | undefined): string =>
  upperPlain(cell === null || cell === undefined ? "" : String(cell))
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Repère l'en-tête d'un fichier de virements (BANQUE, AGENCE, COMPTE, Clé, NOM, PRENOM, ADRESSE, MONTANT, SENS). */
export function detectTransferSheet(rows: SheetCell[][]): { headerRow: number; map: ColumnMap } | null {
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const map: ColumnMap = {};
    (rows[index] ?? []).forEach((cell, column) => {
      const header = headerText(cell);
      if (!header) return;
      for (const [name, test] of COLUMN_TESTS) {
        if (map[name] === undefined && test(header)) {
          map[name] = column;
          break;
        }
      }
    });
    if (map.montant !== undefined && map.sens !== undefined && (map.compte !== undefined || map.rib !== undefined)) return { headerRow: index, map };
  }
  if ((rows[0]?.length ?? 0) >= 9) return { headerRow: -1, map: { banque: 0, agence: 1, compte: 2, cle: 3, nom: 4, prenom: 5, adresse: 6, montant: 7, sens: 8 } };
  return null;
}

function codeField(value: SheetCell | undefined, length: number): string {
  if (value === null || value === undefined || value === "") return "";
  const text = typeof value === "number" ? String(Math.round(value)) : String(value).replace(/[\s.-]/g, "");
  return /^\d+$/.test(text) && text.length < length ? text.padStart(length, "0") : text;
}

function amountField(value: SheetCell | undefined): number {
  if (typeof value === "number") return value;
  let text = String(value ?? "").replace(/[\s  ]/g, "").replace(/DA$/i, "");
  if (!text) return Number.NaN;
  if (/,\d{1,6}$/.test(text) && !text.includes(".")) text = text.replace(",", ".");
  return Number(text.replace(/,/g, ""));
}

/** Lit les lignes d'un fichier de virements. */
export function extractTransferLines(rows: SheetCell[][], detected: { headerRow: number; map: ColumnMap }): TransferLine[] {
  const out: TransferLine[] = [];
  const m = detected.map;
  for (let index = detected.headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((cell) => cell === null || cell === "")) continue;
    const get = (key: keyof ColumnMap): SheetCell | undefined => (m[key] !== undefined ? row[m[key] as number] : undefined);
    let banque: string;
    let agence: string;
    let compte: string;
    let cle: string;
    if (m.compte === undefined && m.rib !== undefined) {
      const rib = String(get("rib") ?? "").replace(/\D/g, "");
      banque = rib.slice(0, 3);
      agence = rib.slice(3, 8);
      compte = rib.slice(8, 18);
      cle = rib.slice(18);
    } else {
      banque = codeField(get("banque"), 3);
      agence = codeField(get("agence"), 5);
      compte = codeField(get("compte"), 10);
      cle = codeField(get("cle"), 2);
    }
    const amount = amountField(get("montant"));
    out.push({
      row: index + 1,
      banque,
      agence,
      compte,
      cle,
      nom: String(get("nom") ?? "").trim(),
      prenom: String(get("prenom") ?? "").trim(),
      adresse: String(get("adresse") ?? "").trim(),
      montant: Number.isFinite(amount) ? amount : Number.NaN,
      sens: String(get("sens") ?? "").trim().toUpperCase(),
    });
  }
  return out;
}

const monthKey = (value: string): string => upperPlain(value).replace(/\s.*$/, "");

/** Signature d'un envoi : comptes et montants des lignes C, triés. */
export function batchSignature(lines: TransferLine[]): string {
  return lines
    .filter((line) => line.sens === "C")
    .map((line) => `${line.banque}${line.compte}|${round2(line.montant).toFixed(2)}`)
    .sort()
    .join(";");
}

/**
 * Contrôle d'un fichier de virements — reprise des règles de l'ancienne version :
 * format des RIB et clé, ligne D sur le compte ALLO, débit = somme des crédits, plafond de 1 000 000 DA,
 * fichier identique à un envoi déjà fait, changement ou ancien RIB, nouveau prestataire, même montant déjà viré,
 * cumul mensuel au-delà du seuil de double validation.
 */
export function analyseTransfer(
  lines: TransferLine[],
  knowledge: TransferKnowledge,
  options: { type: TransferProduct | "auto"; mois: string; fileName: string; selfId: string | null },
): TransferAnalysis {
  const checks: FileCheck[] = [];
  const add = (severity: Severity, title: string, detail: string): void => {
    checks.push({ severity, title, detail });
  };
  const currentMonth = monthKey(options.mois);
  const threshold = knowledge.monthlyThreshold ?? MONTHLY_DOUBLE_CHECK;
  let type: TransferProduct = "A";
  if (options.type === "auto") {
    const votes = { A: 0, B: 0 };
    for (const line of lines) {
      const account = knowledge.accounts.get(`${line.banque}${line.compte}`);
      if (account && line.sens === "C") for (const t of account.types) if (t === "A" || t === "B") votes[t] += 1;
    }
    const name = options.fileName.toUpperCase();
    type = /BDG|BRIS|GLACE/.test(name) ? "B" : /ASSIS/.test(name) ? "A" : votes.B > votes.A ? "B" : "A";
  } else {
    type = options.type;
  }

  const checked: CheckedLine[] = lines.map((line) => {
    const issues: CheckedLine["issues"] = [];
    const issue = (severity: Severity, message: string): void => {
      issues.push({ severity, message });
    };
    let ribOk = false;
    let expectedKey: number | null = null;
    if (line.sens !== "C" && line.sens !== "D") issue("err", line.sens ? `Sens « ${line.sens} » invalide : C (crédit) ou D (débit) attendu` : "Sens (C/D) manquant");
    if (Number.isNaN(line.montant)) issue("err", "Montant manquant ou illisible");
    else if (line.montant <= 0) issue("err", "Montant nul ou négatif");
    else if (Math.abs(line.montant * 100 - Math.round(line.montant * 100)) > 1e-6) issue("warn", `Montant à plus de 2 décimales (${line.montant}) : arrondir au centime`);
    const okBank = /^\d{3}$/.test(line.banque);
    const okAgency = /^\d{5}$/.test(line.agence);
    const okAccount = /^\d{10}$/.test(line.compte);
    if (!okBank) issue("err", line.banque ? `Code banque « ${line.banque} » invalide (3 chiffres)` : "Code banque manquant");
    else if (!BANKS[line.banque]) issue("err", `Code banque ${line.banque} inconnu`);
    if (!okAgency) issue("err", line.agence ? `Code agence « ${line.agence} » invalide (5 chiffres)` : "Code agence manquant");
    if (!okAccount) issue("err", line.compte ? `N° de compte « ${line.compte} » invalide (10 chiffres)` : "N° de compte manquant");
    if (okBank && line.banque === "007" && okAgency && line.agence !== "99999") issue("err", `Compte CCP : l'agence doit être 99999 (lu : ${line.agence})`);
    if (okAgency && okAccount) {
      expectedKey = ribKey(line.agence, line.compte);
      const expected = String(expectedKey).padStart(2, "0");
      if (!line.cle) issue("err", `Clé RIB absente — clé calculée : ${expected}`);
      else if (!/^\d{1,2}$/.test(line.cle)) issue("err", `Clé RIB « ${line.cle} » invalide — clé calculée : ${expected}`);
      else if (Number(line.cle) !== expectedKey) issue("err", `Clé RIB erronée : ${line.cle} au lieu de ${expected}`);
      else ribOk = okBank;
    }
    if (line.sens === "C") {
      if (!line.nom && !line.prenom) issue("warn", "Nom du bénéficiaire manquant");
      if (line.montant > TRANSFER_CEILING) issue("warn", `Dépasse le plafond bancaire de ${TRANSFER_CEILING.toLocaleString("fr-FR")} DA par virement : à fractionner`);
    }
    return { ...line, ribOk, expectedKey, kind: "", issues, severity: "ok", otherAccounts: [], overMonthly: false };
  });

  const debits = checked.filter((line) => line.sens === "D");
  const credits = checked.filter((line) => line.sens === "C");
  const sumCredits = round2(credits.reduce((sum, line) => sum + (Number.isNaN(line.montant) ? 0 : line.montant), 0));
  const debit = debits.length ? round2(debits.reduce((sum, line) => sum + (Number.isNaN(line.montant) ? 0 : line.montant), 0)) : null;
  if (debits.length === 0) add("err", "Aucune ligne de débit (D)", "Le fichier doit contenir une ligne D pour le compte EURL ALLO ASSISTANCE.");
  else if (debits.length > 1) add("err", `${debits.length} lignes de débit (D)`, "Une seule ligne D est attendue par fichier.");
  else {
    const line = debits[0];
    const full = line ? `${line.banque}${line.agence}${line.compte}${line.cle.padStart(2, "0")}` : "";
    if (full === DONOR_RIB) add("ok", "Compte débité : EURL ALLO ASSISTANCE", "032 00001 2737851208 90 (AGB)");
    else add("err", "Le compte débité n'est pas celui d'EURL ALLO ASSISTANCE", `Lu : ${line?.banque} ${line?.agence} ${line?.compte} ${line?.cle} — attendu : 032 00001 2737851208 90`);
  }
  if (credits.length === 0) add("err", "Aucune ligne de crédit (C)", "Aucun prestataire à payer dans le fichier.");
  if (debit !== null) {
    const gap = round2(debit - sumCredits);
    if (Math.abs(gap) < 0.005) add("ok", "Débit = somme des crédits", `${formatDA(debit)} sur ${credits.length} virement(s)`);
    else add("err", `Écart débit / crédits : ${formatDA(gap)}`, `Débit ${formatDA(debit)} — total des crédits ${formatDA(sumCredits)}`);
  }
  const signature = batchSignature(checked);
  const same = credits.length ? knowledge.batches.filter((batch) => batch.signature === signature && batch.id !== options.selfId) : [];
  const sameBatch = same[same.length - 1];
  if (sameBatch) add("warn", "Fichier identique à un envoi déjà enregistré", `Mêmes comptes et mêmes montants que « ${sameBatch.ref} » (${sameBatch.mois}). Vérifier qu'il ne s'agit pas d'un double envoi.`);

  const perAccount = new Map<string, CheckedLine[]>();
  for (const line of credits) perAccount.set(`${line.banque}${line.compte}`, [...(perAccount.get(`${line.banque}${line.compte}`) ?? []), line]);
  for (const line of credits) {
    const issue = (severity: Severity, message: string): void => {
      line.issues.push({ severity, message });
    };
    const key = `${line.banque}${line.compte}`;
    const full = `${line.banque}${line.agence}${line.compte}${line.cle.padStart(2, "0")}`;
    const name = `${line.nom} ${line.prenom}`.trim();
    const account = knowledge.accounts.get(key);
    if (account) {
      if (account.status === "remplace") {
        issue("warn", "Compte remplacé par un nouveau compte dans le référentiel : vérifier avec le prestataire avant paiement");
        line.kind = "remplace";
      } else if (account.status === "supprime") {
        issue("err", "RIB supprimé du référentiel : ne pas payer sur ce compte sans nouvelle attestation RIB");
        line.kind = "supprime";
      } else if (account.status === "a_valider") {
        issue("warn", "RIB en attente de validation dans le référentiel : à confirmer avant paiement");
      }
      const best = Math.max(0, ...account.noms.map((known) => nameSimilarity(known, name)));
      if (name && account.noms.length && best < 0.5) {
        issue("warn", `Nom différent de celui connu pour ce compte : ${account.noms.join(" / ")}`);
        line.kind = line.kind || "nom";
      }
      if (line.ribOk && account.rib && account.rib !== full) {
        if (account.oldRibs.includes(full)) {
          issue("warn", `ANCIEN RIB : remplacé dans le référentiel par ${account.rib} — payer sur le nouveau RIB`);
          line.kind = "ancien";
        } else if (account.refusedRibs.includes(full)) {
          issue("err", "RIB refusé dans le référentiel : ne pas payer sur ce RIB");
          line.kind = "refuse";
        } else {
          issue("warn", `CHANGEMENT DE RIB : agence ou clé différente du référentiel (${account.rib}) — vérifier l'attestation RIB`);
          line.kind = "rib";
        }
      }
      const amounts = account.history.map((entry) => entry.amount);
      if (amounts.length >= 3 && line.montant > 100_000 && line.montant > 3 * Math.max(...amounts)) issue("warn", `Montant inhabituel : plus de 3 fois le plus gros virement à ce compte (${formatDA(Math.max(...amounts))})`);
      if (!sameBatch) {
        const previous = account.history.filter((entry) => Math.abs(entry.amount - line.montant) < 0.005 && entry.batchId !== options.selfId);
        const last = previous[previous.length - 1];
        if (last) {
          if (monthKey(last.mois) === currentMonth && line.montant >= 250_000) issue("info", `Même montant déjà viré ce mois dans « ${last.ref} » : fractionnement probable`);
          else if (monthKey(last.mois) === currentMonth) issue("warn", `Même montant déjà viré à ce compte ce mois-ci (« ${last.ref} ») : double paiement possible`);
          else issue("warn", `Même montant déjà viré à ce compte en ${last.mois} (« ${last.ref} ») : vérifier qu'il ne s'agit pas d'un double paiement`);
        }
      }
    } else {
      const tokenKey = nameTokens(name).sort().join(" ");
      let others = tokenKey ? knowledge.byName.get(tokenKey) : undefined;
      if (!others && nameTokens(name).length >= 2) {
        for (const [known, keys] of knowledge.byName) {
          if (nameSimilarity(known, name) >= 1 && Math.min(nameTokens(known).length, nameTokens(name).length) >= 2) {
            others = keys;
            break;
          }
        }
      }
      if (others?.size) {
        line.otherAccounts = [...others];
        const ribs = line.otherAccounts.map((other) => knowledge.accounts.get(other)?.rib || other);
        issue("warn", `CHANGEMENT DE RIB : ce prestataire est connu avec un autre compte (${ribs.join(" ; ")}). Exiger une attestation RIB avant paiement`);
        line.kind = "compte";
      } else {
        issue("warn", "Nouveau prestataire, absent du référentiel : vérifier le RIB avec l'attestation du prestataire");
        line.kind = "nouveau";
      }
    }
    const group = perAccount.get(key) ?? [];
    if (group[0] === line) {
      const fileTotal = group.reduce((sum, entry) => sum + (Number.isNaN(entry.montant) ? 0 : entry.montant), 0);
      const monthTotal = account ? account.history.filter((entry) => monthKey(entry.mois) === currentMonth && entry.batchId !== options.selfId).reduce((sum, entry) => sum + entry.amount, 0) : 0;
      const cumulative = round2(fileTotal + monthTotal);
      if (cumulative > threshold) {
        issue("warn", `Cumul du mois pour ce prestataire : ${formatDA(cumulative)}, au-delà du seuil de double validation (${formatDA(threshold)}) : validation par un administrateur`);
        line.overMonthly = true;
      }
      if (group.length > 1) issue("info", `${group.length} virements vers ce compte dans le fichier (total ${formatDA(round2(fileTotal))})`);
    }
  }
  const ribBad = credits.filter((line) => !line.ribOk).length;
  if (credits.length) {
    if (ribBad === 0) add("ok", "Tous les RIB sont conformes", `${credits.length} RIB vérifiés : longueur, code banque et clé de contrôle`);
    else add("err", `${ribBad} RIB non conforme(s)`, "Voir les lignes en rouge : clé erronée ou absente, code banque / agence / compte invalide.");
  }
  const ribChanges = credits.filter((line) => line.kind === "rib" || line.kind === "compte").length;
  const newProviders = credits.filter((line) => line.kind === "nouveau").length;
  const overMonthly = credits.filter((line) => line.overMonthly).length;
  if (ribChanges) add("warn", `${ribChanges} changement(s) de RIB`, "Signalés au référentiel à la validation de l'envoi : à valider ou refuser.");
  if (newProviders) add("warn", `${newProviders} nouveau(x) prestataire(s)`, "Ajoutés au référentiel à la validation de l'envoi.");
  if (overMonthly) add("warn", `${overMonthly} prestataire(s) au-delà du seuil mensuel de ${threshold.toLocaleString("fr-FR")} DA`, "Double validation : seul un administrateur peut valider cet envoi.");
  const overCeiling = credits.filter((line) => line.montant > TRANSFER_CEILING).length;
  if (overCeiling) add("warn", `${overCeiling} virement(s) au-dessus de ${TRANSFER_CEILING.toLocaleString("fr-FR")} DA`, "La banque plafonne chaque virement : fractionner en plusieurs lignes.");
  else if (credits.length) add("ok", `Aucun virement au-dessus de ${TRANSFER_CEILING.toLocaleString("fr-FR")} DA`, "Plafond bancaire respecté");

  for (const line of checked) line.severity = line.issues.reduce<Severity>((worst, entry) => (RANK[entry.severity] > RANK[worst] ? entry.severity : worst), "ok");
  const lineErrors = checked.filter((line) => line.severity === "err").length;
  const lineWarnings = checked.filter((line) => line.severity === "warn").length;
  const fileErrors = checks.filter((check) => check.severity === "err").length;
  const fileWarnings = checks.filter((check) => check.severity === "warn").length;
  return {
    type,
    lines: checked,
    checks,
    debit,
    credit: sumCredits,
    gap: debit === null ? null : round2(debit - sumCredits),
    credits: credits.length,
    verdict: lineErrors || fileErrors ? "err" : lineWarnings || fileWarnings ? "warn" : "ok",
    errors: lineErrors + fileErrors,
    warnings: lineWarnings + fileWarnings,
    newProviders,
    ribChanges,
    overMonthly,
  };
}
