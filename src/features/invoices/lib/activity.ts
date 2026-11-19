/** Activités d'une facture fournisseur : assistance routière, bris de glace (BDG) ou autre. */
export const ACTIVITIES = ["assistance", "bdg", "autre"] as const;

/** Activité d'une facture fournisseur. */
export type Activity = (typeof ACTIVITIES)[number];

/** Libellés français des activités. */
export const ACTIVITY_LABELS: Readonly<Record<Activity, string>> = { assistance: "Assistance", bdg: "BDG", autre: "Autre" };

/** Clé du champ stocké dans `Invoice.extra`. */
export const ACTIVITY_KEY = "activite";

/** Texte en minuscules, sans accents, tirets et ponctuation ramenés à des espaces. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Reconnaît une valeur d'activité écrite (casse et accents ignorés) ; `null` si ce n'en est pas une. */
export function parseActivity(value: unknown): Activity | null {
  if (typeof value !== "string") return null;
  const wanted = normalize(value);
  return ACTIVITIES.find((activity) => activity === wanted) ?? null;
}

/**
 * Activité écrite dans le JSON `extra` d'une facture (`extra.activite`).
 * Tolérant : `extra` absent, non objet, tableau ou valeur inconnue donnent `null`, jamais d'erreur.
 */
export function explicitActivityOf(extra: unknown): Activity | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  return parseActivity((extra as Record<string, unknown>)[ACTIVITY_KEY]);
}

/** Déduit une activité d'un texte libre (`null` si le texte n'en mentionne aucune). BDG l'emporte si les deux sont cités. */
function activityFromText(value: string): Activity | null {
  const text = normalize(value);
  if (!text) return null;
  if (/\bbdg\b/.test(text) || /\bbris de glaces?\b/.test(text)) return "bdg";
  if (/assistance|assistane|depann|remorqu/.test(text)) return "assistance";
  return null;
}

/** Catégories sans activité dans leur nom (TVA, ABG SERVICE) : l'activité vient alors des autres factures du même tiers. */
function isAmbiguousCategory(categorie: string): boolean {
  return /^prestataires? tva$/.test(normalize(categorie)) || /^abg service$/.test(normalize(categorie));
}

/** Clé de regroupement d'un tiers (casse, accents et ponctuation ignorés). */
export function tiersKey(tiers: string | null | undefined): string {
  return normalize(tiers ?? "");
}

/** Activité retenue par tiers (clé = `tiersKey`) : voir `buildActivityHints`. */
export type ActivityHints = ReadonlyMap<string, Activity>;

/**
 * Activité majoritaire de chaque tiers, calculée sur ses factures dont l'activité est sûre
 * (explicite, ou mot-clé « assistance » / « BDG » dans la catégorie). Égalité : aucun indice pour ce tiers.
 * Sert uniquement à classer les catégories ambiguës ; aucun montant n'est concerné.
 */
export function buildActivityHints(rows: ReadonlyArray<Pick<ActivitySource, "categorie" | "extra" | "tiers">>): ActivityHints {
  const counts = new Map<string, Record<"assistance" | "bdg", number>>();
  for (const row of rows) {
    const known = explicitActivityOf(row.extra) ?? activityFromText(row.categorie ?? "");
    if (known !== "assistance" && known !== "bdg") continue;
    const key = tiersKey(row.tiers);
    if (!key) continue;
    const entry = counts.get(key) ?? { assistance: 0, bdg: 0 };
    entry[known] += 1;
    counts.set(key, entry);
  }
  const hints = new Map<string, Activity>();
  for (const [key, entry] of counts) {
    if (entry.assistance > entry.bdg) hints.set(key, "assistance");
    else if (entry.bdg > entry.assistance) hints.set(key, "bdg");
  }
  return hints;
}

/** Cette facture a-t-elle besoin des indices par tiers pour être classée ? */
export function needsActivityHints(source: Pick<ActivitySource, "categorie" | "extra">): boolean {
  return explicitActivityOf(source.extra) === null && isAmbiguousCategory(source.categorie ?? "");
}

/**
 * Activité à écrire dans `extra.activite` lors d'une modification : `null` = ne rien écrire.
 * On n'écrit pas l'activité simplement déduite (pour ne pas figer une déduction) : seulement si la facture
 * en avait déjà une explicite, ou si le choix diffère de ce que la déduction donnerait.
 */
export function activityToStore(chosen: Activity, hasExplicit: boolean, deduced: Activity): Activity | null {
  return hasExplicit || chosen !== deduced ? chosen : null;
}

/**
 * Activité suggérée par une catégorie saisie : « assistance » ou « bdg » si elle les mentionne, sinon `null`
 * (à l'écran, le choix reste alors vide et l'utilisateur doit trancher, au lieu de recevoir « Autre » par défaut).
 */
export function suggestActivity(categorie: string): Activity | null {
  return activityFromText(categorie);
}

/** Éléments d'une facture utiles pour déterminer son activité. */
export interface ActivitySource {
  categorie?: string | null;
  /** Contenu du JSON `extra` (n'importe quelle valeur : une valeur illisible est ignorée). */
  extra?: unknown;
  nature?: string | null;
  tiers?: string | null;
  libelle?: string | null;
}

/**
 * Activité d'une facture fournisseur : « assistance », « bdg » ou « autre ». Règles, dans l'ordre :
 * 1. l'activité explicite de `extra.activite` l'emporte toujours (casse et accents ignorés) ; une valeur inconnue ou un `extra` illisible est ignoré ;
 * 2. sinon la catégorie : « BDG » (mot entier) ou « bris de glace » donne « bdg » ; « assistance », « dépannage » ou « remorquage » donne « assistance ».
 *    Si les deux sont cités, BDG l'emporte (plus précis). Exemples : « Prestataire BDG », « prestataires BDG », « Avenant BDG » → bdg ;
 *    « Prestataire assistance routière » → assistance ;
 * 3. une catégorie sans mention d'activité (« Prestataire TPA », « Prestataire IT », « Fournisseur ») reste « autre » :
 *    on ne cherche pas ailleurs, pour ne pas classer à tort. Exception : « Prestataires TVA » et « ABG SERVICE » prennent l'activité
 *    majoritaire des autres factures du même tiers (`hints`, voir `buildActivityHints`), sinon « autre » ;
 * 4. seulement si la catégorie est vide : mêmes mots-clés cherchés dans la nature, puis le libellé, puis le tiers
 *    (« Allo Assistance » retiré du tiers : c'est notre propre nom) ; « assistane » (faute courante) est reconnu ;
 * 5. à défaut, « autre ».
 */
export function activityOf(source: ActivitySource, hints?: ActivityHints): Activity {
  const explicit = explicitActivityOf(source.extra);
  if (explicit) return explicit;
  const categorie = (source.categorie ?? "").trim();
  if (categorie) return activityFromText(categorie) ?? (isAmbiguousCategory(categorie) ? hints?.get(tiersKey(source.tiers)) : undefined) ?? "autre";
  // Le nom de la société elle-même (« Allo Assistance ») ne dit rien de l'activité du fournisseur.
  const tiers = (source.tiers ?? "").replace(/allo\s+assistance/gi, " ");
  for (const text of [source.nature, source.libelle, tiers]) {
    const found = activityFromText(text ?? "");
    if (found) return found;
  }
  return "autre";
}

/**
 * Fusionne l'activité dans un objet `extra` sans perdre aucune autre clé.
 * Un `extra` illisible (absent, tableau, valeur simple) est remplacé par un objet ne contenant que l'activité.
 */
export function mergeActivityIntoExtra(extra: unknown, activity: Activity): Record<string, unknown> {
  const base = extra && typeof extra === "object" && !Array.isArray(extra) ? (extra as Record<string, unknown>) : {};
  return { ...base, [ACTIVITY_KEY]: activity };
}
