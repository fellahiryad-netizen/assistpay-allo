import { caarSucc, CAAR_SUCCURSALES, isoDate, monthInText, agenceCode, policeBase, txt, ym, ymKey, type CaarBaseRow, type CaarFacture, type CaarMoisBase } from "@/features/caar-regul/services/caar-regul-engine";
import { openWorkbook, sheetRows, type StreamCell } from "@/features/regul/lib/zip-reader";

/** Contenu lu dans le consolidé ALLO & CAAR. */
export interface CaarConsoRead {
  /** Production par succursale puis par mois (AAAAMM). */
  data: Record<string, Record<number, CaarBaseRow[]>>;
  mois: Record<string, Record<string, CaarMoisBase>>;
  factures: Record<string, Record<string, CaarFacture>>;
  forms: string[];
  lignes: number;
  ignorees: number;
  fichier: string;
}

const r2 = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100;
const str = (v: StreamCell): string => (v === null || v === undefined ? "" : String(v).trim());

/** Lit le consolidé ALLO & CAAR en flux : onglets CONSOLIDE (production facturée à l'avance) et RECAP FACTURES (factures d'avance). */
export async function readCaarConso(file: File, progress: (message: string) => void): Promise<CaarConsoRead> {
  const wb = await openWorkbook(file);
  const consoPath = wb.sheets.CONSOLIDE;
  const consoEntry = consoPath ? wb.get(consoPath) : undefined;
  if (!consoEntry) throw new Error("Onglet « CONSOLIDE » introuvable dans ce classeur.");
  progress("Lecture des libellés…");
  const sst = await wb.sst();
  const factures: CaarConsoRead["factures"] = {};
  const recapPath = wb.sheets["RECAP FACTURES"];
  const recapEntry = recapPath ? wb.get(recapPath) : undefined;
  if (recapEntry) {
    progress("Lecture du récapitulatif des factures…");
    await sheetRows(file, recapEntry, sst, (_rn, c) => {
      const s = caarSucc(c[0]);
      const mt = monthInText(str(c[1]));
      if (!s || !mt?.y || typeof c[3] !== "number") return;
      const date = typeof c[10] === "number" ? isoDate(c[10]) : str(c[10]);
      (factures[s] ??= {})[ymKey(ym(mt.y, mt.m))] = { fact: str(c[2]), ttc: r2(c[3]), date, etat: str(c[11]) };
    });
  }
  const forms: string[] = [];
  const fIx = new Map<string, number>();
  const data: CaarConsoRead["data"] = {};
  const mois: CaarConsoRead["mois"] = {};
  let n = 0;
  let ignorees = 0;
  progress("Lecture de l'onglet CONSOLIDE…");
  await sheetRows(file, consoEntry, sst, (rn, c) => {
    if (rn < 2) return;
    const s = caarSucc(c[0]);
    const mt = monthInText(str(c[1]));
    if (!s || !mt?.y) {
      if (c[0] !== null && c[0] !== undefined) ignorees++;
      return;
    }
    const v = ym(mt.y, mt.m);
    const f = str(c[10]);
    let fi = fIx.get(f);
    if (fi === undefined) {
      fi = forms.length;
      fIx.set(f, fi);
      forms.push(f);
    }
    const incl = /INCLU/i.test(str(c[11])) ? 1 : 0;
    const com = txt(c[18]);
    const motif = incl ? 0 : /ANTERIEURE/.test(com) ? 1 : /IMPAY|IMAPAY|QUITTANCE/.test(com) ? 2 : 3;
    // Date d'effet tolérante : « 08/07/2026 07/07/2027 » → première date ; date et immatriculation inversées → remises en place ; sinon vide.
    let de = isoDate(c[6]);
    let immat = str(c[8]);
    if (!de && isoDate(c[8]) && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(str(c[6]))) {
      de = isoDate(c[8]);
      immat = str(c[6]);
    }
    const row: CaarBaseRow = [v, agenceCode(c[3]).slice(0, 20), str(c[4]).slice(0, 200), policeBase(c[5]).slice(0, 40), de, immat.slice(0, 60), fi, incl, r2(c[12]), r2(c[13]), r2(c[14]), motif];
    ((data[s] ??= {})[v] ??= []).push(row);
    const o = ((mois[s] ??= {})[ymKey(v)] ??= { n: 0, nIncl: 0, allo: 0, p90: 0 });
    o.n++;
    if (incl) {
      o.nIncl++;
      o.allo = r2(o.allo + row[10]);
      o.p90 = r2(o.p90 + r2(c[15]));
    }
    if (++n % 20000 === 0) progress(`${n.toLocaleString("fr-FR")} lignes lues…`);
  });
  for (const s of Object.keys(data)) if (!(CAAR_SUCCURSALES as readonly string[]).includes(s)) delete data[s];
  return { data, mois, factures, forms, lignes: n, ignorees, fichier: file.name };
}
