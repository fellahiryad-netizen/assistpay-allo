import { REGUL_LABELS, type RegulAnalysis, type RegulLine } from "@/features/regul/services/regul-engine";
import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";
import { round2 } from "@/utils/amounts";
import { MONTHS_FR } from "@/utils/dates";

type Row = SheetToWrite["rows"][number];

const monthName = (m: number): string => (MONTHS_FR[m - 1] ?? "").toUpperCase().replace("É", "E").replace("Û", "U");
const HEAD = ["MOIS", "IMMATRICULATION", "AGENCE", "CLIENT", "CODE_AGENCE", "VILLE", "MARQUE", "DATE_EMMISSION", "POLICE", "DATE_DEBUT", "DATE_FIN", "PRODUIT", "PRIME", "PART_ASSISTEUR"];
const WIDTHS = [11, 16, 28, 22, 10, 14, 16, 14, 20, 12, 12, 16, 12, 14];

function line(x: RegulLine): Row {
  return [monthName(x.m), x.immat, x.agence, x.client, x.code, x.ville, x.marque, x.emis, x.police, x.debut, x.fin, x.produit, x.prime, x.pa];
}

/** Classeur de régularisation : mêmes onglets que le classeur de référence (sans base sinistres). */
export function writeRegulWorkbook(a: RegulAnalysis): Uint8Array {
  const label = REGUL_LABELS[a.succursale] ?? a.succursale;
  const per = `${a.periode} ${a.annee}`;
  const feuil: Row[] = [["Mois ", "Succursale", "Montant Total ", "Somme Avance ", "Montant Régule ", "ECARTS 10% HT", "TVA", "Part Assisteur "]];
  a.rows.forEach((r, i) => {
    const n = i + 2;
    feuil.push([`${MONTHS_FR[r.m - 1] ?? ""} ${a.annee}`, `SUCCURSALE ${a.succursale}`, r.total, r.avance, r.regule, { f: `E${n}-D${n}`, v: r.ecart }, { f: `E${n}*0.19`, v: r.tva }, { f: `F${n}+G${n}`, v: r.pa }]);
  });
  const last = a.rows.length + 1;
  const t = a.totals;
  feuil.push([`TOTAL ${per}`, "", { f: `SUM(C2:C${last})`, v: t.total }, { f: `SUM(D2:D${last})`, v: t.avance }, { f: `SUM(E2:E${last})`, v: t.regule }, { f: `SUM(F2:F${last})`, v: t.ecart }, { f: `SUM(G2:G${last})`, v: t.tva }, { f: `SUM(H2:H${last})`, v: t.pa }]);
  feuil.push([]);
  feuil.push(["Sources : Somme Avance = avances 90 % HT d'AssistPay (modifiables) ; Montant Régule = somme des PART_ASSISTEUR des fichiers déposés (valides + annulations + changements de garantie) ; ECARTS 10% HT = Régule − Avance ; TVA = 19 % sur 100 % du Régule ; Part Assisteur = ECARTS + TVA."]);

  const annulHead = [...HEAD, "Ligne positive (« plus ») de la même police ?", "Solde Prime (immat)", "Solde Part Assisteur (immat)", "Nb garanties distinctes"];
  const agencyHead: Row = ["Code", "Agence"];
  for (const m of a.months) agencyHead.push(`Fichiers — ${MONTHS_FR[m - 1] ?? ""} (nb)`, `Fichiers — ${MONTHS_FR[m - 1] ?? ""} (PA)`);
  agencyHead.push("Total PA");
  const agencies: Row[] = [agencyHead];
  for (const ag of a.agences) agencies.push([ag.code, ag.nom, ...ag.mois.flatMap((c) => [c.n, c.pa]), round2(ag.mois.reduce((s, c) => s + c.pa, 0))]);

  const plus = a.annul.filter((x) => x.plus).length;
  const method: Row[] = [
    [`MÉTHODOLOGIE — RÉGULARISATION 10 % + TVA — SUCCURSALE ${a.succursale} (${per})`],
    [],
    [`• Fichiers déposés : ${a.fichiers.filter((f) => !f.hors).map((f) => f.name).join(" ; ")} — ${a.valid.length + a.annul.length + a.garan.length} lignes → ${a.valid.length} valides / ${a.annul.length + a.garan.length} lignes négatives → ${a.garan.length} changements de garantie exclus → ${a.annul.length} vraies annulations.`],
    [`• Plus et moins : ${plus} annulation(s) sur ${a.annul.length} ont leur ligne positive dans la période ; ${a.annul.length - plus} n'ont que la ligne négative (contrat souscrit avant la période).`],
    [`• Mois sans fichier : ${a.sansFichier.length ? a.sansFichier.map((m) => MONTHS_FR[m - 1]).join(", ") : "aucun"}.`],
    [`• Lignes émises un autre mois que celui du fichier : ${a.horsMois}. Immatriculations illisibles : ${a.illisibles}.`],
    [`• Flottes décalées (même police sur deux mois) : ${a.flottes.length || "aucune"}.`],
    [],
    ["MÉTHODE"],
    ["• Montant Régule = somme PART_ASSISTEUR ; ECARTS 10% HT = Régule − Avance ; TVA = 19 % × Régule ; Part Assisteur = ECARTS + TVA. Annulée = PRIME < 0 ; changement de garantie = plusieurs produits pour une même immatriculation."],
    [`• Succursale ${label}.`],
  ];
  return writeWorkbook([
    { name: "Feuil1", widths: [18, 26, 16, 16, 16, 16, 16, 16], rows: feuil },
    { name: "Polices Valides", widths: WIDTHS, rows: [HEAD, ...a.valid.map(line)] },
    {
      name: "Polices Annulées",
      widths: [...WIDTHS, 26, 14, 16, 12],
      rows: [annulHead, ...a.annul.map((x) => [...line(x), x.plus ? "OUI" : "NON — contrat avant la période", x.soldePrime, x.soldePa, x.nprod])],
    },
    { name: "Polices Changement Garantie", widths: [...WIDTHS, 30], rows: [[...HEAD, "Autre(s) garantie(s) trouvée(s) (même immat)"], ...a.garan.map((x) => [...line(x), x.autres])] },
    { name: "Contrôle Agences", widths: [8, 30], rows: agencies },
    { name: "Méthodologie", widths: [150], rows: method },
  ]);
}
