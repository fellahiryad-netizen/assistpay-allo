import { openWorkbook, sheetRows } from "@/features/regul/lib/zip-reader";
import type { ConsoRead } from "@/features/regul/services/regul-checks";
import { REGUL_PROD, REGUL_SUCCURSALES, type Fait } from "@/features/regul/services/regul-engine";

const r2 = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100;
const pad = (n: number): string => String(n).padStart(2, "0");
const serial = (n: number): { y: number; m: number } => {
  const d = new Date(Math.round((n - 25569) * 864e5));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
};

function succName(raw: string): string {
  const t = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, " ");
  const m = /ALG(?:ER|RE)\s*(III|II|I)\b/.exec(t);
  if (m) return `ALGER ${m[1]}`;
  for (const [a, b] of [["ANNABA", "ANNABA"], ["CONSTANTINE", "CONSTANTINE"], ["ORAN", "ORAN"], ["SETIF", "SETIF"], ["SUD", "SUD"], ["TLEMCEN", "TLEMCEN"], ["TELEMCEN", "TLEMCEN"]] as const) {
    if (new RegExp(`\\b${a}\\b`).test(t)) return b;
  }
  return "";
}

const isSucc = (s: string): boolean => (REGUL_SUCCURSALES as readonly string[]).includes(s);

/** Lit le consolidé CAAT : onglets TCD (total, avance), REGUL (historique) et EXTRACTION CAAT VALID (production 2026 ligne par ligne). */
export async function readConso(file: File, progress: (message: string) => void): Promise<ConsoRead> {
  const wb = await openWorkbook(file);
  const tcdPath = wb.sheets.TCD;
  const extName = Object.keys(wb.sheets).find((n) => n.startsWith("EXTRACTION CAAT VALID"));
  const extPath = extName ? wb.sheets[extName] : undefined;
  const tcdEntry = tcdPath ? wb.get(tcdPath) : undefined;
  const extEntry = extPath ? wb.get(extPath) : undefined;
  if (!tcdEntry || !extEntry) throw new Error("Onglets « TCD » et « EXTRACTION CAAT VALID 25-26 » introuvables dans ce classeur.");
  progress("Lecture des libellés…");
  const sst = await wb.sst();
  progress("Lecture du TCD…");
  const tcd: ConsoRead["tcd"] = {};
  const histT: Record<string, Record<string, Fait>> = {};
  let cur: string | null = null;
  let curK: string | null = null;
  await sheetRows(file, tcdEntry, sst, (_rn, c) => {
    const a = c[0];
    if (typeof a === "number" && a > 40000) {
      const d = serial(a);
      curK = `${d.y}-${pad(d.m)}`;
      cur = d.y === 2026 ? curK : null;
      return;
    }
    if (typeof a === "string" && curK) {
      const s = succName(a);
      if (!s || a.toUpperCase().indexOf("SUCCURSALE") < 0 || !isSucc(s)) return;
      if (cur) (tcd[s] ??= {})[cur] = { total: r2(c[2]), avance: r2(c[6]), statut: typeof c[7] === "string" ? c[7].trim() : "" };
      if (typeof c[8] === "number") (histT[s] ??= {})[curK] = { total: r2(c[2]), avance: r2(c[6]), regule: r2(c[8]), ecart: r2(c[9]), tva: r2(c[10]), pa: r2(c[11]), statut: typeof c[13] === "string" ? c[13].trim() : "", src: "TCD" };
    }
  });
  const histR: Record<string, Record<string, Fait>> = {};
  const reguPath = wb.sheets.REGUL;
  const reguEntry = reguPath ? wb.get(reguPath) : undefined;
  if (reguEntry) {
    progress("Lecture de l'historique des régularisations…");
    await sheetRows(file, reguEntry, sst, (rn, c) => {
      const d0 = c[0];
      if (rn < 2 || typeof d0 !== "number" || d0 < 40000) return;
      const d = serial(d0);
      const s = succName(String(c[1] ?? ""));
      if (!s || !isSucc(s) || typeof c[4] !== "number") return;
      (histR[s] ??= {})[`${d.y}-${pad(d.m)}`] = { total: r2(c[2]), avance: r2(c[3]), regule: r2(c[4]), ecart: r2(c[5]), tva: r2(c[6]), pa: r2(c[7]), releve: typeof c[8] === "number" ? r2(c[8]) : null, src: "REGUL" };
    });
  }
  const hist: ConsoRead["hist"] = {};
  const conflits: ConsoRead["conflits"] = [];
  for (const s of REGUL_SUCCURSALES) {
    const ks = new Set([...Object.keys(histT[s] ?? {}), ...Object.keys(histR[s] ?? {})]);
    for (const k of ks) {
      const t = histT[s]?.[k];
      const r = histR[s]?.[k];
      if (t && r && (Math.abs(t.regule - r.regule) > 1 || Math.abs(t.avance - r.avance) > 1)) conflits.push({ s, k, regul: r, tcd: t });
      const merged = r ? { ...(t ?? {}), ...r } : t;
      if (merged) (hist[s] ??= {})[k] = merged as Fait;
    }
  }
  const data: ConsoRead["data"] = {};
  const agences: Record<string, string> = {};
  let n = 0;
  let ignorees = 0;
  progress("Lecture de la production 2026…");
  await sheetRows(file, extEntry, sst, (rn, c) => {
    if (rn < 3) return;
    const a = c[0];
    if (typeof a !== "number") return;
    const d = serial(a);
    if (d.y !== 2026) return;
    const s = String(c[1] ?? "").trim().replace(/^SUCCURSALE\s+/i, "").toUpperCase();
    if (!isSucc(s)) {
      ignorees++;
      return;
    }
    const code = parseInt(String(c[6]), 10) || 0;
    const pr = String(c[13] ?? "").trim();
    const pi = (REGUL_PROD as readonly string[]).indexOf(pr);
    (data[s] ??= []).push([d.m, code, String(c[10] ?? "").trim(), String(c[2] ?? "").trim(), pi, Number((Number(c[14]) || 0).toFixed(2)), Number((Number(c[15]) || 0).toFixed(2))]);
    agences[String(code)] = String(c[3] ?? "").trim();
    if (++n % 25000 === 0) progress(`${n.toLocaleString("fr-FR")} lignes lues…`);
  });
  const baseMois: ConsoRead["baseMois"] = {};
  for (const s of Object.keys(data)) {
    const o: Record<string, number> = (baseMois[s] = {});
    for (const l of data[s] ?? []) {
      const k = `2026-${pad(l[0])}`;
      o[k] = r2((o[k] ?? 0) + l[6]);
    }
  }
  return { data, tcd, hist, conflits, baseMois, agences, lignes: n, ignorees, fichier: file.name };
}
