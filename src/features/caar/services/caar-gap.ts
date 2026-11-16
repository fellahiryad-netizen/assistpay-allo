/** Ligne d'un fichier de production, réduite à ce qu'il faut pour expliquer un écart. */
export interface GapRow {
  line: number;
  agence: string;
  police: string;
  nom: string;
  prime: number | null;
  include: boolean;
  flags: string[];
}

/** Piste d'explication d'un écart : un groupe de lignes et leur montant cumulé. */
export interface GapCause {
  key: string;
  label: string;
  /** Sens : « added » = lignes du fichier non retenues ; « removed » = lignes retenues dans notre total. */
  effect: "added" | "removed";
  count: number;
  total: number;
  lines: Array<{
    line: number;
    agence: string;
    police: string;
    nom: string;
    prime: number | null;
  }>;
}

/** Détail d'un écart entre le total déclaré dans le fichier et le total recalculé. */
export interface CaarGapDetail {
  declared: number;
  declaredLine: number;
  ours: number;
  /** Total recalculé moins total déclaré. */
  gap: number;
  /** Somme de toutes les lignes de détail du fichier (retenues ou non). */
  allLinesTotal: number;
  /** Nombre de lignes de total repérées dans le fichier (plus d'une : sous-totaux possibles). */
  totalLines: number[];
  causes: GapCause[];
  /** Phrase de conclusion prête à afficher. */
  conclusion: string;
  /** Lignes dont la prime vaut exactement l'écart. */
  singleLines: GapRow[];
}

const money = (value: number): number => Math.round(value * 100) / 100;
const fmt = (value: number): string =>
  value.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const view = (row: GapRow): GapCause["lines"][number] => ({
  line: row.line,
  agence: row.agence,
  police: row.police,
  nom: row.nom,
  prime: row.prime,
});

/**
 * Cherche d'où vient un écart entre le total déclaré et le total recalculé.
 * Lecture seule : aucune règle de calcul n'est modifiée, on ne fait que rapprocher les lignes du fichier.
 * Renvoie null s'il n'y a pas de total déclaré ou pas d'écart (moins de 1 DA).
 */
export function explainGap(
  rows: GapRow[],
  declared: number | null,
  declaredLine: number | null,
  ours: number,
): CaarGapDetail | null {
  if (declared === null || declaredLine === null) return null;
  const gap = money(ours - declared);
  if (Math.abs(gap) < 1) return null;
  const detail = rows.filter(
    (row) => !row.flags.includes("TOTAL") && !row.flags.includes("HEADER"),
  );
  const withPrime = (row: GapRow): row is GapRow & { prime: number } =>
    row.prime !== null;
  const group = (
    key: string,
    label: string,
    effect: GapCause["effect"],
    picked: GapRow[],
  ): GapCause | null => {
    if (picked.length === 0) return null;
    return {
      key,
      label,
      effect,
      count: picked.length,
      total: money(
        picked.filter(withPrime).reduce((sum, row) => sum + row.prime, 0),
      ),
      lines: picked.slice(0, 40).map(view),
    };
  };
  const causes = [
    group(
      "TUNISIE",
      "Lignes « Tunisie » comptées dans le fichier mais exclues de notre total",
      "added",
      detail.filter((row) => row.flags.includes("TUNISIE")),
    ),
    group(
      "DUP",
      "Lignes en double retenues dans notre total",
      "removed",
      detail.filter((row) => row.include && row.flags.includes("DUP")),
    ),
    group(
      "PRIME_NEG",
      "Primes négatives (ristournes) retenues dans notre total",
      "removed",
      detail.filter((row) => row.include && row.flags.includes("PRIME_NEG")),
    ),
    group(
      "PRIME_MISSING",
      "Lignes dont la prime est manquante ou illisible (non comptées chez nous)",
      "added",
      detail.filter((row) => row.flags.includes("PRIME_MISSING")),
    ),
    group(
      "ETAT_KO",
      "Quittances annulées ou non encaissées retenues dans notre total",
      "removed",
      detail.filter((row) => row.include && row.flags.includes("ETAT_KO")),
    ),
  ].filter((cause): cause is GapCause => cause !== null);

  // Ce qu'il faut ajouter à notre total pour retrouver le déclaré : -gap.
  const target = money(-gap);
  const signed = (cause: GapCause): number =>
    cause.effect === "added" ? cause.total : -cause.total;
  let best: GapCause[] | null = null;
  for (let mask = 1; mask < 1 << causes.length; mask += 1) {
    const subset = causes.filter((_, index) => (mask >> index) & 1);
    if (
      Math.abs(
        money(subset.reduce((sum, cause) => sum + signed(cause), 0)) - target,
      ) < 1 &&
      (!best || subset.length < best.length)
    )
      best = subset;
  }
  const allLinesTotal = money(
    detail.filter(withPrime).reduce((sum, row) => sum + row.prime, 0),
  );
  const singleLines = detail
    .filter(
      (row) =>
        row.prime !== null &&
        Math.abs(Math.abs(row.prime) - Math.abs(gap)) < 0.01,
    )
    .slice(0, 10);
  const totalLines = rows
    .filter((row) => row.flags.includes("TOTAL"))
    .map((row) => row.line);

  let conclusion: string;
  if (best)
    conclusion = `L'écart de ${fmt(gap)} DA s'explique exactement par : ${best.map((cause) => cause.label.toLowerCase()).join(" ; ")}.`;
  else if (Math.abs(money(allLinesTotal - declared)) < 1)
    conclusion = `Le total déclaré correspond à la somme de toutes les lignes du fichier (${fmt(allLinesTotal)} DA), y compris celles que nous écartons du contrôle.`;
  else if (singleLines.length)
    conclusion = `Aucune explication globale, mais ${singleLines.length === 1 ? "une ligne a" : `${singleLines.length} lignes ont`} une prime égale à l'écart : ligne${singleLines.length > 1 ? "s" : ""} ${singleLines.map((row) => row.line).join(", ")}. Total oublié, ajouté deux fois ou ligne ajoutée après le calcul du total ?`;
  else
    conclusion =
      "Aucune cause évidente trouvée : le total déclaré n'a probablement pas été recalculé après des modifications du fichier (formule de somme sur une plage incomplète, lignes ajoutées ou supprimées). À demander à la succursale.";
  if (totalLines.length > 1)
    conclusion += ` Attention : ${totalLines.length} lignes de total dans le fichier (lignes ${totalLines.join(", ")}) ; seule la dernière sert de référence, les autres peuvent être des sous-totaux.`;
  return {
    declared: money(declared),
    declaredLine,
    ours: money(ours),
    gap,
    allLinesTotal,
    totalLines,
    causes,
    conclusion,
    singleLines,
  };
}
