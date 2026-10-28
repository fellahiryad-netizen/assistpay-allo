/**
 * Modèles de facturation repris du fichier de facturation partenaires (et de l'ancienne version d'AssistPay) :
 * émetteur, fiches clients, modèles de tableau (colonnes, calculs, totaux) et préréglages par client.
 */

/** Ligne de facture : valeurs saisies, en texte, par clé de colonne. */
export type BillingRow = Record<string, string> & { info?: string };

/** Ligne calculée (valeurs numériques pour les colonnes calculées). */
export type ComputedRow = Record<string, string | number>;

/** Colonne d'un modèle. */
export interface BillingColumn {
  k: string;
  l: string;
  t?: "money" | "num";
  w?: string;
  calc?: (row: BillingRow) => number;
  sum?: boolean;
  nosum?: boolean;
  keep?: boolean;
  clear?: boolean;
}

/** Totaux d'une facture. */
export interface BillingTotals {
  lines: Array<[string, number, boolean?]>;
  ht: number;
  tva: number;
  ttc: number;
  deb?: { ht: number; tva: number; ttc: number };
  fra?: { ht: number; tva: number; ttc: number };
}

/** Modèle de tableau de facture. */
export interface BillingModel {
  lbl: string;
  cols: BillingColumn[];
  ht?: string;
  note?: string;
  sumRow?: boolean;
  numbered?: boolean;
  htRows?: (rows: ComputedRow[]) => ComputedRow[];
  totals?: (rows: BillingRow[]) => BillingTotals;
}

/** Arrondi au centime. */
export const r2 = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/** Nombre saisi (« 1 234,50 ») → nombre ; 0 si vide ou illisible. */
export function num(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  const text = String(value ?? "").replace(/[\s  ]/g, "").replace(/DA$/i, "");
  if (!text) return 0;
  const normalized = text.includes(",") && text.includes(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Émetteur des factures. */
export const ISSUER = {
  nom: "EURL ALLO ASSISTANCE",
  adresse: "Centre d'affaires Al Qods, 7ème étage, 16014 Chéraga",
  tel: "+213 982 30 40 40 / +213 23 13 59 31",
  rc: "16/00-21B1017086",
  nif: "002116101708659",
  nis: "002116500165352",
  ai: "",
  banque: "Compte AGB, Agence Dely Brahim",
  rib: "032 00001 2737851208 90",
  conditions: "10 jours après la réception de la facture.",
  ville: "Chéraga",
} as const;

/** Fiche client. */
export interface ClientCard {
  nom: string;
  adresse: string;
  tel: string;
  rc: string;
  nif: string;
  nis: string;
  ai?: string;
  prefix: string;
  cat: string;
  tiers: string;
}

/** Clients facturés. */
export const CLIENTS: Readonly<Record<string, ClientCard>> = {
  GAM: { nom: "Générale Assurance Méditerranéenne", adresse: "Centre d'affaires El Qods, 8ème étage 16014 Chéraga", tel: "+213 (0) 982 40 40 44", rc: "0017052 B01", nif: "000116001705272", nis: "000116180516557", prefix: "GAM 26-", cat: "GAM", tiers: "GAM ASSURANCE" },
  TRUST: { nom: "TRUST ALGERIA assurance et réassurance", adresse: "70 Chemin Larbi Allik, Hydra, Alger", tel: "0982 40 05 96", rc: "16/00-0003242 A 98", nif: "16994866031", nis: "099716099873505", prefix: "Trust 26-", cat: "TRUST", tiers: "TRUST ASSURANCE" },
  MLA: { nom: "MAGHREB LEASING ALGERIE", adresse: "39, Rue Djenane El Malik – Hydra, Alger", tel: "023 48 20 20", rc: "16/00-0973294 B06", nif: "000616097329491", nis: "0 006 1603 00601 68", prefix: "MLA 26-", cat: "MLA", tiers: "MLA" },
  CAAT: { nom: "SPA Compagnie Algérienne Des Assurances", adresse: "52 Avenue des Frères Bouadou, Alger", tel: "023 56 93 24 / 93 25 / 93 26 / 93 33", rc: "16/00-0008316A99", nif: "099916000831602", nis: "098616010001156", prefix: "CAAT 26-", cat: "CAAT", tiers: "CAAT" },
  CAAR: { nom: "Société Par Action (EPE-SPA CAAR)", adresse: "48, Rue Didouche Mourad - Alger 16 000", tel: "+213 21 63 21 16 | Fax : +213 21 63 13 77", rc: "16/00- 0972730 B06", nif: "000616097273083", nis: "00 976 1601 00007 47", prefix: "CAAR26-", cat: "CAAR", tiers: "CAAR" },
  TDA: { nom: "Télédiffusion d'Algérie (TDA)", adresse: "Route Bainem BP 50, Bouzaréah, Alger", tel: "", rc: "16/00.16318B01", nif: "0 001 1600 16318", nis: "", prefix: "TDA26-", cat: "TDA", tiers: "TDA" },
  AUTRE: { nom: "", adresse: "", tel: "", rc: "", nif: "", nis: "", prefix: "FA26-", cat: "", tiers: "" },
};

/** Libellés des clients. */
export const CLIENT_LABELS: Readonly<Record<string, string>> = {
  GAM: "GAM Assurances",
  TRUST: "TRUST Algeria",
  MLA: "Maghreb Leasing Algérie (MLA)",
  CAAT: "CAAT",
  CAAR: "CAAR",
  TDA: "TDA",
  AUTRE: "Autre client",
};

function simpleTotals(ht: number): BillingTotals {
  const tva = r2(ht * 0.19);
  return { lines: [["TOTAL HT", ht], ["TVA 19 %", tva], ["TOTAL TTC", r2(ht + tva), true]], ht, tva, ttc: r2(ht + tva) };
}

/** Modèles de tableau : colonnes, calculs et totaux propres à chaque type de facture. */
export const MODELS: Readonly<Record<string, BillingModel>> = {
  hono: { lbl: "Honoraire – désignation / période / montant", cols: [{ k: "des", l: "DÉSIGNATION", w: "52%" }, { k: "per", l: "PÉRIODE" }, { k: "ht", l: "MONTANT HT", t: "money" }], ht: "ht" },
  qte: {
    lbl: "Quantité × prix unitaire",
    cols: [
      { k: "des", l: "Désignation", w: "34%" },
      { k: "qte", l: "Quantité", t: "num" },
      { k: "pu", l: "Prix unitaire HT", t: "money" },
      { k: "per", l: "Période" },
      { k: "ht", l: "Montant HT", t: "money", calc: (r) => r2(num(r.qte) * num(r.pu)) },
    ],
    ht: "ht",
  },
  mens: {
    lbl: "Mensualité (forfait annuel par véhicule)",
    cols: [{ k: "des", l: "DÉSIGNATION", w: "30%" }, { k: "qte", l: "Quantité", t: "num" }, { k: "pu", l: "Prime unitaire (DA) HT", t: "money" }, { k: "per", l: "PÉRIODE" }, { k: "ht", l: "MONTANT HT", t: "money" }],
    ht: "ht",
    note: "Ligne 1 : total annuel (information, non additionné). Ligne 2 : mensualité facturée.",
    htRows: (rows) => rows.filter((row) => !row.info),
  },
  transf: {
    lbl: "Refacturation transferts (véhicules)",
    cols: [{ k: "marque", l: "Marque" }, { k: "veh", l: "Véhicule" }, { k: "immat", l: "Immatriculation" }, { k: "lieu", l: "Lieu de survenance" }, { k: "dest", l: "Destination" }, { k: "ht", l: "Prix HT (DA)", t: "money" }],
    ht: "ht",
  },
  presta: { lbl: "Prestation détaillée (grutage, remorquage…)", cols: [{ k: "des", l: "Désignation", w: "70%" }, { k: "ht", l: "Montant (DA)", t: "money" }], ht: "ht" },
  caat: {
    lbl: "Régularisation CAAT (avance 90 % + complément 10 %)",
    cols: [
      { k: "succ", l: "Succursale / mois", w: "24%" },
      { k: "tot", l: "Montant total HT", t: "money" },
      { k: "av", l: "Avance perçue 90 % HT", t: "money" },
      { k: "reg", l: "Montant régul HT", t: "money" },
      { k: "cpl", l: "Complément 10 % HT", t: "money", calc: (r) => r2(num(r.reg) - num(r.av)) },
      { k: "tva", l: "TVA sur régul", t: "money", calc: (r) => r2(num(r.reg) * 0.19) },
      { k: "part", l: "Part assisteur 10 % + TVA", t: "money", calc: (r) => r2(num(r.reg) - num(r.av) + num(r.reg) * 0.19) },
    ],
    totals: (rows) => {
      const s = (k: string): number => r2(rows.reduce((sum, row) => sum + num(row[k]), 0));
      const tot = s("tot");
      const av = s("av");
      const reg = s("reg");
      const cpl = r2(reg - av);
      const tva = r2(reg * 0.19);
      return {
        lines: [["Montant total HT", tot], ["Avance perçue 90 % HT", av], ["Montant régul total HT", reg], ["Complément 10 % HT", cpl], ["TVA 19 % sur montant régul total", tva], ["Total TTC", r2(cpl + tva), true]],
        ht: cpl,
        tva,
        ttc: r2(cpl + tva),
      };
    },
  },
  caar: {
    lbl: "CAAR succursale – part assisteur 47 % / avance 90 %",
    cols: [
      { k: "ag", l: "Agence" },
      { k: "prime", l: "Somme de PRIME", t: "money" },
      { k: "p47", l: "ASSISTEUR (47 %)", t: "money", calc: (r) => r2(num(r.prime) * 0.47) },
      { k: "p90", l: "PART ASSISTEUR (90 %)", t: "money", calc: (r) => r2(num(r.prime) * 0.47 * 0.9) },
      { k: "tva", l: "TVA sur 90 %", t: "money", calc: (r) => r2(num(r.prime) * 0.47 * 0.9 * 0.19) },
      { k: "ttc", l: "TOTAL TTC", t: "money", calc: (r) => r2(num(r.prime) * 0.47 * 0.9 * 1.19) },
    ],
    sumRow: true,
    totals: (rows) => {
      const prime = rows.reduce((sum, row) => sum + num(row.prime), 0);
      const t47 = r2(prime * 0.47);
      const t90 = r2(prime * 0.47 * 0.9);
      const tva = r2(t90 * 0.19);
      return { lines: [["Montant total HT (47 %)", t47], ["Avance perçue 90 % HT", t90], ["TVA 19 % sur 90 % HT", tva], ["Total TTC", r2(t90 + tva), true]], ht: t90, tva, ttc: r2(t90 + tva) };
    },
  },
  caardir: {
    lbl: "CAAR Direction – régularisation des polices passives",
    cols: [
      { k: "ag", l: "Agence" },
      { k: "prime", l: "Total prime prorata", t: "money" },
      { k: "p53", l: "Part Compagnie (CAAR) 53 %", t: "money", calc: (r) => r2(num(r.prime) * 0.53) },
      { k: "p47", l: "Part Prestataire (ALLO) 47 %", t: "money", calc: (r) => r2(num(r.prime) * 0.47) },
    ],
    sumRow: true,
    totals: (rows) => simpleTotals(r2(rows.reduce((sum, row) => sum + num(row.prime) * 0.47, 0))),
  },
  refglob: { lbl: "Refacturation globale (nombre de dossiers + annexe)", cols: [{ k: "des", l: "Désignation", w: "60%" }, { k: "nb", l: "Nombre de dossiers", t: "num" }, { k: "ht", l: "Montant HT (DA)", t: "money" }], ht: "ht" },
  bdgdeb: { lbl: "BDG – débours", cols: [{ k: "ag", l: "Agence", w: "52%" }, { k: "nb", l: "Nombre dossier", t: "num", sum: true }, { k: "mt", l: "Montant BDG HT", t: "money" }], ht: "mt", sumRow: true },
  bdgfra: {
    lbl: "BDG – frais de gestion",
    cols: [
      { k: "ag", l: "Agence", w: "40%" },
      { k: "nb", l: "Nombre dossier", t: "num", sum: true },
      { k: "pu", l: "Frais unitaire / dossier HT", t: "money", nosum: true },
      { k: "ft", l: "Frais total de gestion HT", t: "money", calc: (r) => r2(num(r.nb) * num(r.pu)) },
    ],
    ht: "ft",
    sumRow: true,
  },
  bdgpair: {
    lbl: "BDG – débours + frais de gestion (2 factures)",
    cols: [
      { k: "ag", l: "Agence", w: "34%" },
      { k: "nb", l: "Nb dossiers", t: "num", clear: true },
      { k: "mt", l: "Montant BDG HT (débours)", t: "money" },
      { k: "pu", l: "Frais / dossier HT", t: "money", keep: true },
      { k: "ft", l: "Frais de gestion HT", t: "money", calc: (r) => r2(num(r.nb) * num(r.pu)) },
    ],
    totals: (rows) => {
      const d = r2(rows.reduce((sum, row) => sum + num(row.mt), 0));
      const f = r2(rows.reduce((sum, row) => sum + num(row.nb) * num(row.pu), 0));
      const dt = r2(d * 0.19);
      const ft = r2(f * 0.19);
      const deb = { ht: d, tva: dt, ttc: r2(d + dt) };
      const fra = { ht: f, tva: ft, ttc: r2(f + ft) };
      return {
        lines: [["Débours HT", d], ["TVA 19 % débours", dt], ["Facture débours TTC", deb.ttc], ["Frais de gestion HT", f], ["TVA 19 % frais", ft], ["Facture frais TTC", fra.ttc], ["Total des 2 factures TTC", r2(deb.ttc + fra.ttc), true]],
        ht: r2(d + f),
        tva: r2(dt + ft),
        ttc: r2(deb.ttc + fra.ttc),
        deb,
        fra,
      };
    },
  },
  bdggam: {
    lbl: "BDG GAM – facture globale (fourniture et pose) + détail des dossiers",
    cols: [{ k: "dos", l: "N° dossier" }, { k: "mat", l: "Matricule" }, { k: "nom", l: "Nom client" }, { k: "ag", l: "Agence" }, { k: "pres", l: "Prestation" }, { k: "dt", l: "Date" }, { k: "sin", l: "N° sinistre" }, { k: "prix", l: "Prix HT", t: "money" }],
    ht: "prix",
  },
  bdggamsum: {
    lbl: "BDG GAM – synthèse",
    cols: [{ k: "nb", l: "Nombre de dossiers", t: "num" }, { k: "des", l: "Désignation", w: "38%" }, { k: "qte", l: "Quantité", t: "num" }, { k: "ht", l: "Montant HT", t: "money" }],
    ht: "ht",
  },
  transport: {
    lbl: "Transport de véhicules (châssis, poids, quantité)",
    cols: [
      { k: "des", l: "Désignation", w: "24%" },
      { k: "chassis", l: "N° de châssis" },
      { k: "poids", l: "Poids / dimensions" },
      { k: "qte", l: "Qté", t: "num" },
      { k: "pu", l: "P.U. HT (DA)", t: "money" },
      { k: "ht", l: "Total HT (DA)", t: "money", calc: (r) => r2(num(r.qte) * num(r.pu)) },
    ],
    ht: "ht",
    numbered: true,
  },
};

/** Préréglage de facture par client. */
export interface BillingPreset {
  id: string;
  c: string;
  lbl: string;
  m: string;
  objet?: string;
  objLbl?: string;
  perTitle?: string;
  colLbl?: string;
  cols?: Record<string, string>;
  row?: BillingRow;
  rows?: BillingRow[];
  notes?: string;
  lib?: string;
  nature?: string;
  cat?: string;
  typ?: string;
  succ?: boolean;
  succList?: string[];
  bc?: boolean;
  route?: boolean;
  details?: boolean;
}

/** Préréglages repris du fichier de facturation partenaires. */
export const PRESETS: readonly BillingPreset[] = [
  { id: "g_conv", c: "GAM", lbl: "Honoraire Assistance Routière Léger & Lourd (conventionnel)", m: "hono", objet: "Assistance Routière", row: { des: "Honoraire Assistance Routière Léger & Lourd" }, lib: "Honoraire Assistance routière conventionnelle {P}" },
  { id: "g_tak", c: "GAM", lbl: "Honoraire Assistance Routière Takaful", m: "hono", objet: "Assistance Routière", row: { des: "Honoraire Assistance Routière Takaful" }, lib: "Honoraire assistance routière takaful {P}" },
  { id: "g_bdgc", c: "GAM", lbl: "Honoraire BDG Conventionnel", m: "hono", objet: "BDG Conventionnel", row: { des: "Honoraire BDG Conventionnel" }, lib: "Honoraire Assistance BDG conventionnelle {P}" },
  { id: "g_bdgab_c", c: "GAM", lbl: "BDG GAM – facture globale Conventionnelle (fourniture et pose + détail)", m: "bdggam", objet: "BDG – Facture globale Conventionnelle", objLbl: "Produit", perTitle: "Période", cat: "GAM BDG", typ: "Conventionnelle", lib: "{N} DOSSIER Conventionnelle {P}", nature: "Production BDG", row: {} },
  { id: "g_bdgab_t", c: "GAM", lbl: "BDG GAM – facture globale Takaful (fourniture et pose + détail)", m: "bdggam", objet: "BDG – Facture globale Takaful", objLbl: "Produit", perTitle: "Période", cat: "GAM BDG", typ: "Takaful", lib: "{N} DOSSIER TAKAFUL {P}", nature: "Production BDG", row: {} },
  { id: "g_bdgt", c: "GAM", lbl: "Honoraire BDG Takaful", m: "hono", objet: "BDG TAKAFUL", row: { des: "Honoraire BDG TAKAFUL" }, lib: "Honoraire Assistance BDG TAKAFUL {P}" },
  { id: "g_home", c: "GAM", lbl: "Honoraire Home Assistance (domiciliaire)", m: "hono", objet: "Home ASSISTANCE", row: { des: "Honoraire Assistance Domiciliaire" }, lib: "Honoraire assistance domiciliaire {P}", nature: "Production Home Assistance" },
  { id: "g_flotte", c: "GAM", lbl: "Honoraire contrat flotte (ex. Al Salam Bank)", m: "hono", objet: "Assistance Routière", row: { des: "Honoraire Assistance Routière" }, notes: "contrat flotte AL SALAM BANK Police N°162630091260001", lib: "Honoraire contrat flotte {P}" },
  { id: "g_ref", c: "GAM", lbl: "Refacturation Assistance Routière (liste jointe)", m: "hono", objet: "Assistance Routière", row: { des: "Assistance Routière refacturation" }, notes: "Liste jointe\nReporting détaillé", lib: "Refacturation assistance routière {P}", nature: "Production Refacturation" },
  { id: "t_hono", c: "TRUST", lbl: "Honoraire mensuel (Prime HT Léger & Lourd)", m: "hono", objet: "Assistance Routière", perTitle: "Période concernée", colLbl: "RÉGION", row: { des: "Prime HT Léger & Lourd" }, lib: "Honoraire {P}" },
  {
    id: "t_flotte",
    c: "TRUST",
    lbl: "Honoraire flotte (ex. Infrarail : nb véhicules × prix)",
    m: "qte",
    objet: "Assistance Routière",
    perTitle: "Flotte concernée",
    cols: { des: "Client", qte: "N° flotte / nb véhicules", pu: "Prix unitaire HT" },
    row: { des: "SPA INFRARAIL", qte: "204", pu: "4600", per: "01 juillet 2026 – 30 juin 2027" },
    notes: "Liste véhicules ci-jointe",
    lib: "Honoraire flotte {P}",
  },
  {
    id: "t_bdg",
    c: "TRUST",
    lbl: "BDG – débours + frais de gestion 800 DA HT / dossier (2 factures)",
    m: "bdgpair",
    objet: "BDG",
    objLbl: "Produit",
    perTitle: "Période facturation",
    notes: "Liste jointe Détail Sinistre BDG",
    cols: { ag: "N° sinistre / assuré" },
    row: { ag: "", nb: "1", mt: "", pu: "800" },
  },
  {
    id: "m_mens",
    c: "MLA",
    lbl: "Honoraire mensuel (mensualité flotte)",
    m: "mens",
    objet: "Assistance Routière",
    rows: [
      { des: "Total véhicules", qte: "2090", pu: "12000", per: "Annuel 2026", ht: "25080000", info: "1" },
      { des: "Mensualité MM/12", qte: "-", pu: "-", per: "", ht: "2090000" },
    ],
    lib: "Honoraire {P}",
  },
  { id: "m_transf", c: "MLA", lbl: "Refacturation transfert de véhicules", m: "transf", objet: "Assistance Routière", bc: true, row: { marque: "", veh: "", immat: "", lieu: "", dest: "", ht: "" }, lib: "Refacturation transfert {P}", nature: "Production Refacturation" },
  { id: "m_presta", c: "MLA", lbl: "Prestation détaillée (grutage…)", m: "presta", objet: "Assistance Routière", details: true, row: { des: "Prestation de grutage — " }, lib: "Frais de grutage {P}", nature: "Production Refacturation" },
  { id: "c_regul", c: "CAAT", lbl: "Régularisation trimestrielle / mensuelle (avance 90 %)", m: "caat", objet: "Assistance Routière", succ: true, perTitle: "", row: { succ: "", tot: "", av: "", reg: "" }, lib: "Régul {P} succursale {S}" },
  {
    id: "c_bdg",
    c: "CAAT",
    lbl: "BDG – débours + frais de gestion par succursale (2 factures)",
    m: "bdgpair",
    objet: "BDG",
    objLbl: "Produit",
    perTitle: "Période facturation",
    succ: true,
    succList: ["Alger I", "Alger II", "Alger III", "Annaba", "Constantine", "Ghardaia", "Setif", "Oran", "Tlemcen"],
    notes: "Liste jointe Détail Sinistre BDG",
    row: { ag: "", nb: "", mt: "", pu: "800" },
  },
  { id: "r_succ", c: "CAAR", lbl: "Honoraire mensuel succursale (47 % / 90 %)", m: "caar", objet: "Assistance Routière", succ: true, row: { ag: "", prime: "" }, lib: "Facturation mois de {P}" },
  { id: "r_dir", c: "CAAR", lbl: "Direction – régularisation des polices passives", m: "caardir", objet: "Assistance Routière", perTitle: "", row: { ag: "", prime: "" }, lib: "Régularisation polices passives {P} – Direction CAAR" },
  {
    id: "r_passif",
    c: "CAAR",
    lbl: "Refacturation assistance routière passifs (avec annexe)",
    m: "refglob",
    objet: "Refacturation Assistance Routière Passifs",
    objLbl: "Objet",
    row: { des: "Refacturation globale des prestations d'assistance routière (remorquage, dépannage, extraction) réalisées pour le compte de la CAAR", nb: "", ht: "" },
    notes: "Ci-joint le détail de la facture — voir annexe « Détail ».",
    lib: "Refacturation assistance routière passif {P}",
    nature: "Production Refacturation",
  },
  { id: "x_transport", c: "TDA", lbl: "Transport de véhicules", m: "transport", objet: "Transport de véhicules", objLbl: "Objet", route: true, row: { des: "", chassis: "", poids: "", qte: "1", pu: "" }, lib: "Transport de véhicules {P}" },
  { id: "_bdgdeb", c: "_", lbl: "BDG débours", m: "bdgdeb", objet: "BDG", objLbl: "Produit", perTitle: "Période facturation", succ: true },
  { id: "_bdgfra", c: "_", lbl: "BDG frais de gestion", m: "bdgfra", objet: "BDG", objLbl: "Produit", perTitle: "Période facturation", succ: true },
  { id: "_bdggamsum", c: "_", lbl: "BDG GAM synthèse", m: "bdggamsum", objLbl: "Produit", perTitle: "Période" },
  { id: "a_hono", c: "AUTRE", lbl: "Facture simple (désignation / période / montant)", m: "hono", objet: "Assistance Routière", row: { des: "" }, lib: "{O} {P}" },
  { id: "a_qte", c: "AUTRE", lbl: "Facture quantité × prix unitaire", m: "qte", objet: "Prestation", row: { des: "", qte: "1", pu: "" }, lib: "{O} {P}" },
];

/** Succursales proposées par client. */
export const BRANCHES: Readonly<Record<string, string[]>> = {
  CAAT: ["Alger I", "Alger II", "Alger III", "Annaba", "Constantine", "Oran", "Sétif", "Sud", "Tlemcen"],
  CAAR: ["Chéraga (Alger)", "Bouzaréah (Alger)", "Constantine", "Annaba", "Oran", "Direction"],
};

/** Types de facture BDG (paire débours + frais, ou une seule). */
export const BDG_TYPES: Readonly<Record<string, string>> = {
  pair: "Débours + frais de gestion (2 factures)",
  deb: "Facture de débours seule",
  fra: "Facture de frais de gestion seule",
};

/** Préréglage par identifiant (le premier par défaut). */
export function presetById(id: string): BillingPreset {
  return PRESETS.find((preset) => preset.id === id) ?? (PRESETS[0] as BillingPreset);
}
