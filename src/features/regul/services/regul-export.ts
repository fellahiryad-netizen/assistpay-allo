import { calc, REGUL_LABELS, REGUL_MOIS, type Analysis, type AnalysedLine, type RegulIndex, type RegulSin, type Saisie } from "@/features/regul/services/regul-engine";
import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import { round2 } from "@/utils/amounts";

type Row = SheetToWrite["rows"][number];

const monthUp = (m: number): string => (REGUL_MOIS[m - 1] ?? "").toUpperCase().replace("É", "E").replace("Û", "U");
const dateFr = (iso: string | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
};
const HEAD = ["MOIS", "IMMATRICULATION", "AGENCE", "CLIENT", "CODE_AGENCE", "VILLE", "MARQUE", "DATE_EMMISSION", "POLICE", "DATE_DEBUT", "DATE_FIN", "PRODUIT", "PRIME", "PART_ASSISTEUR"];
const WIDTHS = [11, 16, 28, 22, 10, 14, 16, 14, 20, 12, 12, 16, 12, 14];
const line = (x: AnalysedLine): Row => [monthUp(x.m), x.immat, x.agence, x.client, x.code, x.ville, x.marque, x.emis, x.police, x.debut, x.fin, x.produit, x.prime, x.pa];

/** Classeur de régularisation (même contenu que la version claude.ai) ; la base sinistres n'y figure jamais, seule l'alerte. */
export function writeRegulWorkbook(a: Analysis, periode: string, year: number, idx: RegulIndex | null, saisies: Record<string, Saisie>, sin: RegulSin | null): Uint8Array {
  const c = calc(a, year, idx, saisies);
  const label = REGUL_LABELS[a.s] ?? a.s;
  const per = `${periode} ${year}`;
  const f1: Row[] = [["Mois ", "Succursale", "Montant Total ", "Somme Avance ", "Montant Régule ", "ECARTS 10% HT", "TVA", "Part Assisteur "]];
  c.rows.forEach((r, i) => {
    const n = i + 2;
    f1.push([`${REGUL_MOIS[r.m - 1]} ${year}`, `SUCCURSALE ${a.s}`, r.total, r.avance, r.regule, { f: `E${n}-D${n}`, v: r.ecart }, { f: `E${n}*0.19`, v: r.tva }, { f: `F${n}+G${n}`, v: r.pa }]);
  });
  const last = c.rows.length + 1;
  const t = c.tot;
  f1.push([`TOTAL ${per}`, "", ...(["C", "D", "E", "F", "G", "H"] as const).map((col, i) => ({ f: `SUM(${col}2:${col}${last})`, v: [t.total, t.avance, t.regule, t.ecart, t.tva, t.pa][i] ?? 0 }))]);
  f1.push([]);
  f1.push(["Sources : Montant Total et Somme Avance = TCD du consolidé CAAT (modifiables dans AssistPay) ; Montant Régule = somme des PART_ASSISTEUR des fichiers déposés (valides + annulations + changements de garantie) ; ECARTS 10% HT = Régule − Avance ; TVA = 19% sur 100% du Régule ; Part Assisteur = ECARTS + TVA."]);

  const alerte = a.annul.filter((x) => x.sinistre);
  const alerteRows: Row[] = [
    [`⚠ POLICES ANNULÉES AYANT UN SINISTRE ASSOCIÉ — ${label} ${per}`],
    [sin ? `Rapprochement sur la clé Police (hors avenant) + Immatriculation. Base sinistres arrêtée au ${dateFr(sin.jusqua)} : les sinistres déclarés après cette date ne sont pas couverts.` : "Base sinistres non chargée."],
    [],
    ["Mois", "Police", "Immatriculation", "Agence", "Client", "Produit", "Prime annulée", "Part Assisteur annulée", "Solde Prime (immat)", "Solde Part Assisteur (immat)"],
    ...alerte.map((x): Row => [monthUp(x.m), x.police, x.immat, x.agence, x.client, x.produit, x.prime, x.pa, x.soldePrime, x.soldePa]),
    [],
    [`${alerte.length} police(s) annulée(s) sur ${a.annul.length} avec un sinistre associé.`],
  ];

  const ch: Row = ["Code", "Agence"];
  for (const m of a.months) ch.push(`Consolidé — ${REGUL_MOIS[m - 1]}`);
  ch.push("Consolidé — Total");
  for (const m of a.months) ch.push(`Fichiers — ${REGUL_MOIS[m - 1]}`);
  ch.push("Fichiers — Total");
  for (const m of a.months) ch.push(`Écart — ${REGUL_MOIS[m - 1]}`);
  ch.push("Écart — Total");
  const sum = (v: number[]): number => round2(v.reduce((x, y) => x + y, 0));
  const ca: Row[] = [ch];
  for (const ag of a.agTab) {
    const b = ag.par.map((p) => round2(p.b.pa));
    const f = ag.par.map((p) => round2(p.f.pa));
    const e = ag.par.map((p) => round2(p.f.pa - p.b.pa));
    ca.push([ag.code, ag.nom, ...b, sum(b), ...f, sum(f), ...e, sum(e)]);
  }
  const ec: Row[] = [["Sens", "Mois", "Police", "Immatriculation", "Agence", "Produit", "Prime", "Part Assisteur"]];
  for (const x of a.onlyFile) ec.push(["Dans le fichier, absente du consolidé", monthUp(x.m), x.police, x.immat, x.code, x.produit, x.prime, x.pa]);
  for (const x of a.onlyBase) ec.push(["Dans le consolidé, absente du fichier", monthUp(x.m), x.police, x.immat, x.code, x.produit, x.prime, x.pa]);

  const plus = a.annul.filter((x) => x.plus).length;
  const me: Row[] = [
    [`MÉTHODOLOGIE — RÉGULARISATION 10 % + TVA — SUCCURSALE ${a.s} (${per})`],
    [],
    [`• Fichiers déposés : ${a.files.map((f) => f.name).join(" ; ")} — ${a.L.length} lignes → ${a.valid.length} valides / ${a.annul.length + a.garan.length} lignes négatives → ${a.garan.length} changements de garantie exclus → ${a.annul.length} vraies annulations.`],
    [`• Plus et moins : ${plus} annulations sur ${a.annul.length} ont leur ligne positive dans la période ; ${a.annul.length - plus} n'ont que la ligne négative (contrat souscrit avant la période).`],
    [`• Sinistres : ${sin ? `${alerte.length} annulation(s) avec sinistre associé (base arrêtée au ${dateFr(sin.jusqua)})` : "base sinistres non chargée"}.`],
    [`• Agences manquantes par rapport au consolidé : ${a.manquantes.length ? a.manquantes.map((x) => `${x.code} (${(REGUL_MOIS[x.m - 1] ?? "").toLowerCase()})`).join(", ") : "aucune"}.`],
    [`• Écart ligne à ligne avec le consolidé : ${a.onlyFile.length} ligne(s) seulement dans les fichiers, ${a.onlyBase.length} ligne(s) seulement dans le consolidé.`],
    [`• Flottes décalées (même police sur deux mois) : ${a.flottes.length || "aucune"}.`],
    [],
    ["MÉTHODE"],
    ["• Montant Régule = somme PART_ASSISTEUR ; ECARTS 10% HT = Régule − Avance ; TVA = 19% × Régule ; Part Assisteur = ECARTS + TVA. Annulée = PRIME < 0 ; changement de garantie = plusieurs produits pour une même immatriculation ; sinistre = clé Police (sans avenant) + immatriculation."],
  ];
  return writeWorkbook([
    { name: "Feuil1", widths: [18, 26, 16, 16, 16, 16, 16, 16], rows: f1 },
    { name: "Polices Valides", widths: WIDTHS, rows: [HEAD, ...a.valid.map(line)] },
    {
      name: "Polices Annulées",
      widths: [...WIDTHS, 26, 22, 14, 16, 12],
      rows: [
        [...HEAD, "Ligne positive (« plus ») de la même police ?", "Sinistre associé ? (croisement interne)", "Solde Prime (immat)", "Solde Part Assisteur (immat)", "Nb garanties distinctes"],
        ...a.annul.map((x): Row => [...line(x), x.plus ? "OUI" : "NON — contrat avant la période", x.sinistre == null ? "base sinistres non chargée" : x.sinistre ? "OUI" : "NON", x.soldePrime, x.soldePa, x.nprod]),
      ],
    },
    { name: "Polices Changement Garantie", widths: [...WIDTHS, 30], rows: [[...HEAD, "Autre(s) garantie(s) trouvée(s) (même immat)"], ...a.garan.map((x): Row => [...line(x), x.autres])] },
    { name: "ALERTE Annulée+Sinistre", widths: [11, 20, 18, 26, 22, 14, 14, 16, 16, 18], rows: alerteRows },
    { name: "Contrôle Agences", widths: [8, 30], rows: ca },
    { name: "Écarts ligne à ligne", widths: [36, 11, 20, 18, 10, 14, 12, 14], rows: ec },
    { name: "Méthodologie", widths: [150], rows: me },
  ]);
}
