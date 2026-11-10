import { CAAR_LABELS, calc, periodeText, SITUATIONS, ymLabel, type CaarAnalysis, type CaarRegulIndex, type CaarSaisie, type LineA } from "@/features/caar-regul/services/caar-regul-engine";
import { writeWorkbook, type SheetToWrite } from "@/lib/spreadsheet";

type Row = SheetToWrite["rows"][number];

const r2 = (n: number): number => Math.round(n * 100) / 100;
const MN = (v: number): string => ymLabel(v).toUpperCase();
const dateFr = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const HEAD = ["Mois", "Agence", "Assuré", "Police", "Avenant", "Date d'effet", "Immatriculation", "Formule", "Prime HT", "Allo 47 % HT"];
const line = (x: LineA): Row => [MN(x.ym), x.agence, x.assure, x.police, x.avenant, dateFr(x.de), x.immat, x.formule, x.prime, r2(x.allo)];

/** Classeur de régularisation CAAR (sans onglet Méthodologie) : Feuil1, Écart, Détail par agence, annulations, alertes, polices réintégrées et détail des fichiers. */
export function writeCaarRegulWorkbook(a: CaarAnalysis, idx: CaarRegulIndex | null, saisies: Readonly<Record<string, CaarSaisie>>, sinJusqua: string | null): Uint8Array {
  const c = calc(a, idx, saisies);
  const S = CAAR_LABELS[a.s];
  const per = periodeText(a.months);
  const sheets: SheetToWrite[] = [];

  const f1: Row[] = [
    [`RÉGULARISATION 10 % — CAAR SUCCURSALE ${S.toUpperCase()} — ${per.toUpperCase()}`],
    [],
    ["Mois", "Succursale", "Montant Total", "Somme Avance", "Montant Régule", "ECARTS HT", "TVA 19 %", "Part Assisteur TTC", "N° facture avance", "Avance réglée TTC"],
    ["", "", "production facturée à l'avance (Allo 47 % HT)", "90 % HT payés par la CAAR", "fichier de la succursale (Allo 47 % HT)", "Régule − Avance", "sur l'écart", "à facturer", "", ""],
  ];
  const r0 = f1.length + 1;
  c.rows.forEach((r, i) => {
    const n = r0 + i;
    f1.push([MN(r.ym), `CAAR ${S.toUpperCase()}`, r.total, r.avance, r.regule, { f: `E${n}-D${n}`, v: r.ecart }, { f: `ROUND(F${n}*0.19,2)`, v: r.tva }, { f: `F${n}+G${n}`, v: r.pa }, r.fact, r.ttc ?? ""]);
  });
  const rl = r0 + c.rows.length - 1;
  const t = c.tot;
  f1.push(["TOTAL", "", ...(["C", "D", "E", "F", "G", "H"] as const).map((col, i) => ({ f: `SUM(${col}${r0}:${col}${rl})`, v: [t.total, t.avance, t.regule, t.ecart, t.tva, t.pa][i] ?? 0 })), "", { f: `SUM(J${r0}:J${rl})`, v: r2(c.rows.reduce((x, r) => x + (r.ttc ?? 0), 0)) }]);
  f1.push([], ["LECTURE DE L'ÉCART"], ["Mois", "", "Complément 10 %", "Écart de production", "ECARTS HT"]);
  const l0 = f1.length + 1;
  c.rows.forEach((r, i) => {
    const n = r0 + i;
    f1.push([MN(r.ym), "", { f: `C${n}-D${n}`, v: r.complement }, { f: `E${n}-C${n}`, v: r.prod }, { f: `C${l0 + i}+D${l0 + i}`, v: r.ecart }]);
  });
  f1.push([], ["Complément 10 % = Montant Total − Somme Avance. Écart de production = Montant Régule − Montant Total (polices en plus, en moins, réintégrées ou modifiées : voir l'onglet Écart). TVA 19 % sur l'écart seulement, l'avance ayant été réglée TTC. Somme Avance = montant TTC de la facture d'avance ÷ 1,19."]);
  sheets.push({ name: "Feuil1", rows: f1, widths: [16, 20, 20, 20, 20, 16, 15, 18, 16, 17] });

  const ec: Row[] = [["ÉCARTS POLICE PAR POLICE — facture d'avance vs fichiers de la succursale (montants HT = Allo 47 %)"], []];
  for (const v of a.months) {
    ec.push([MN(v)], ["Situation", "Nb polices", "Écart HT"]);
    for (const sit of SITUATIONS) {
      const h = a.ecarts.filter((e) => e.ym === v && e.sit === sit);
      ec.push([sit, h.length, r2(h.reduce((x, e) => x + e.d, 0))]);
    }
    const hh = a.ecarts.filter((e) => e.ym === v);
    ec.push([`Total ${MN(v).toLowerCase()}`, hh.length, r2(hh.reduce((x, e) => x + e.d, 0))], []);
  }
  ec.push(["DÉTAIL"], ["Mois", "Agence", "Assuré", "N° Police", "Situation", "Montant avance HT", "Montant fichier HT", "Écart HT", "Explication"]);
  for (const v of a.months) {
    const h = a.ecarts.filter((e) => e.ym === v).sort((x, y) => SITUATIONS.indexOf(x.sit) - SITUATIONS.indexOf(y.sit) || Math.abs(y.d) - Math.abs(x.d));
    for (const e of h) ec.push([MN(v), e.ag, e.as, e.pb, e.sit, e.aC, e.aN, e.d, e.ex]);
  }
  sheets.push({ name: "Écart", rows: ec, widths: [16, 9, 36, 13, 22, 15, 15, 14, 70] });

  const map = Object.entries(a.agMap);
  const dag: Row[] = [["DÉTAIL PAR AGENCE — production facturée à l'avance vs fichiers de la succursale (montants HT = Allo 47 %)"], [map.length ? `Codes agence du consolidé alignés sur ceux de la succursale : ${map.map(([x, y]) => `${x} → ${y}`).join(", ")}` : ""], []];
  for (const v of a.months) {
    const T = a.agTab[v] ?? [];
    dag.push([MN(v)], ["Agence", "Lignes avance", "Lignes fichier", "Montant Total (avance)", "Montant Régule (fichier)", "Écart HT", "Statut", "Explication"]);
    for (const o of T) dag.push([o.a, o.nB, o.nF, o.aB, o.aF, o.d, o.statut, o.expl]);
    dag.push(["TOTAL", T.reduce((x, o) => x + o.nB, 0), T.reduce((x, o) => x + o.nF, 0), r2(T.reduce((x, o) => x + o.aB, 0)), r2(T.reduce((x, o) => x + o.aF, 0)), r2(T.reduce((x, o) => x + o.d, 0)), `${T.filter((o) => o.statut === "ANOMALIE").length} en anomalie`, ""], []);
  }
  sheets.push({ name: "Détail par agence", rows: dag, widths: [12, 10, 10, 18, 18, 14, 20, 90] });

  sheets.push({ name: "Polices Annulées", rows: [[...HEAD, "Ligne positive de la même police ?", "Sinistre associé ? (base activité)"], ...a.annul.map((x): Row => [...line(x), x.plus ? "OUI" : "NON — contrat avant la période", x.sinistre === null ? "base activité non chargée" : x.sinistre ? "OUI" : "NON"])] });
  if (a.garan.length) sheets.push({ name: "Changement Garantie", rows: [[...HEAD, "Autre(s) formule(s) sur la même immatriculation"], ...a.garan.map((x): Row => [...line(x), x.autres])] });
  const al = a.annul.filter((x) => x.sinistre);
  sheets.push({
    name: "ALERTE Annulée+Sinistre",
    rows: [
      [`POLICES ANNULÉES AYANT UN SINISTRE ASSOCIÉ — ${S} ${per}`],
      [sinJusqua ? `Rapprochement sur la clé Police + Immatriculation. Base activité arrêtée au ${dateFr(sinJusqua)}.` : "Base activité non chargée : croisement non fait."],
      [],
      ["Mois", "Police", "Immatriculation", "Agence", "Assuré", "Formule", "Prime annulée HT", "Allo 47 % annulé"],
      ...al.map((x): Row => [MN(x.ym), x.police, x.immat, x.agence, x.assure, x.formule, x.prime, r2(x.allo)]),
      [],
      [`${al.length} police(s) annulée(s) sur ${a.annul.length} avec un sinistre associé.`],
    ],
  });
  if (a.tunisie.length) {
    sheets.push({
      name: "ALERTE Tunisie",
      rows: [
        ["ALERTE — FORMULE ASSISTANCE TUNISIE AVEC UN MONTANT (doit être à 0 DA)"],
        [],
        ["Où", "Mois", "Agence", "Assuré", "Police", "Date d'effet", "Immatriculation", "Formule", "Montant trouvé", "Retenu"],
        ...a.tunisie.map((x): Row => [x.ou === "fichier" ? "Fichier de la succursale (prime HT)" : "Facture d'avance (part ALLO 47 %)", MN(x.ym), x.agence, x.assure, x.police, dateFr(x.de), x.immat, x.formule, x.montant, 0]),
      ],
    });
  }
  const rei = a.ecarts.filter((e) => e.sit === "Police réintégrée");
  if (rei.length) sheets.push({ name: "Polices réintégrées", rows: [["POLICES RÉINTÉGRÉES — exclues de l'avance, comptées dans la régule"], [], ["Mois", "Agence", "Assuré", "N° Police", "Allo 47 % HT retenu", "Origine"], ...rei.map((e): Row => [MN(e.ym), e.ag, e.as, e.pb, e.d, e.liste ? "liste d'exclusion de la succursale" : "détail du fichier"])] });
  const nc = a.L.filter((x) => x.motif !== "");
  if (nc.length) sheets.push({ name: "Polices non comptées", rows: [["POLICES NON COMPTÉES"], [], [...HEAD, "Motif"], ...nc.map((x): Row => [...line(x).slice(0, 8), x.prime, 0, x.motif])] });
  sheets.push({ name: `Détail ${S}`.slice(0, 31), rows: [[...HEAD, "Comptée", "Origine", "Fichier"], ...a.L.map((x): Row => [...line(x), x.compte ? "OUI" : "NON", x.reprise ? "liste d'exclusion" : "détail", `${x.fichier} (${x.feuille})`])] });
  return writeWorkbook(sheets);
}
