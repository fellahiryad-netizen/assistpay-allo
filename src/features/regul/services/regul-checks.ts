import { REGUL_PROD, REGUL_SUCCURSALES, succId, type Fait, type RegulIndex, type RegulSaved } from "@/features/regul/services/regul-engine";
import { round2 } from "@/utils/amounts";

/* Contrôles de cohérence du consolidé et de l'historique : fonctions pures. */

/** Contenu lu dans un consolidé CAAT (avant enregistrement). */
export interface ConsoRead {
  data: Record<string, Array<[number, number, string, string, number, number, number]>>;
  tcd: Record<string, Record<string, { total: number; avance: number; statut: string }>>;
  hist: Record<string, Record<string, Fait>>;
  conflits: Array<{ s: string; k: string; regul: Fait; tcd: Fait }>;
  baseMois: Record<string, Record<string, number>>;
  agences: Record<string, string>;
  lignes: number;
  ignorees: number;
  fichier: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Cohérence de l'historique lu : arithmétique, relevé bancaire, plausibilité 90 %. */
export function histControle(r: ConsoRead): { n: number; arith: Array<{ s: string; k: string }>; releve: Array<{ s: string; k: string; avance: number; releve: number }>; conflits: ConsoRead["conflits"] } {
  const arith: Array<{ s: string; k: string }> = [];
  const releve: Array<{ s: string; k: string; avance: number; releve: number }> = [];
  let n = 0;
  for (const s of Object.keys(r.hist)) {
    for (const [k, h] of Object.entries(r.hist[s] ?? {})) {
      n++;
      const e = h.regule - h.avance;
      const tv = h.regule * 0.19;
      if (Math.abs(e - h.ecart) > 0.05 || Math.abs(tv - h.tva) > 0.05 || Math.abs(e + tv - h.pa) > 0.05) arith.push({ s, k });
      if (h.releve != null && Math.abs(h.releve - h.avance) > 0) releve.push({ s, k, avance: h.avance, releve: h.releve });
    }
  }
  return { n, arith, releve, conflits: r.conflits };
}

/** Contrôle du consolidé lu, succursale par succursale : lignes, mois couverts, écarts avec le TCD, avances atypiques. */
export function consoControle(r: ConsoRead, idx: RegulIndex | null): Array<{ s: string; n: number; avant: number; mois: number[]; ecarts: Array<{ k: string; tcd: number; lignes: number }>; atyp: Array<{ k: string; total: number; avance: number }> }> {
  return REGUL_SUCCURSALES.map((s) => {
    const L = r.data[s] ?? [];
    const pa: Record<string, number> = {};
    for (const l of L) {
      const k = `2026-${pad(l[0])}`;
      pa[k] = (pa[k] ?? 0) + l[6];
    }
    const mois = Object.keys(pa).sort();
    const tcd = r.tcd[s] ?? {};
    const ecarts: Array<{ k: string; tcd: number; lignes: number }> = [];
    for (const k of new Set([...mois, ...Object.keys(tcd)])) {
      const t = tcd[k];
      const v = pa[k] ?? 0;
      if (t && Math.abs(t.total - v) > 1 && v > 0) ecarts.push({ k, tcd: t.total, lignes: v });
    }
    const atyp: Array<{ k: string; total: number; avance: number }> = [];
    for (const [k, t] of Object.entries(tcd)) {
      if (t.total > 0 && t.avance > 0) {
        const ratio = t.avance / (0.9 * t.total);
        if (ratio < 0.9 || ratio > 1.1) atyp.push({ k, total: t.total, avance: t.avance });
      }
    }
    return { s, n: L.length, avant: idx?.lignes?.[s] ?? 0, mois: mois.map((k) => Number(k.slice(5))), ecarts, atyp };
  });
}

/** Régularisation connue pour une succursale et un mois : résultat enregistré dans AssistPay, sinon classeur. */
export function faitsOf(idx: RegulIndex | null, saved: Record<string, RegulSaved>, s: string, k: string): (Fait & { src: string }) | null {
  const sv = saved[`${succId(s)}-${k}`];
  const f = idx?.faits?.[s]?.[k];
  if (sv) return { ...(f ?? { total: 0, avance: 0, regule: 0, ecart: 0, tva: 0, pa: 0 }), total: sv.total, avance: sv.avance, regule: sv.regule, ecart: sv.ecart, tva: sv.tva, pa: sv.pa, base: sv.base, top: sv.top, src: "AssistPay" };
  if (!f) return null;
  return { ...f, src: f.src === "REGUL" || f.src === "TCD" ? "classeur" : (f.src ?? "classeur") };
}

/** Ligne du contrôle qualité des régularisations. */
export interface CtrlRow {
  s: string;
  k: string;
  y: number;
  regule: number;
  avance: number;
  pa: number;
  base: number;
  gap: number;
  pct: number;
  fl: string[];
  top: string;
  impact: number;
  src: string;
}

/** Rapproche chaque régularisation de la production en base (écart, avance atypique, relevé, lignes décalées). */
export function ctrlRows(idx: RegulIndex | null, saved: Record<string, RegulSaved>): CtrlRow[] {
  const keys = new Set<string>();
  for (const s of Object.keys(idx?.faits ?? {})) for (const k of Object.keys(idx?.faits[s] ?? {})) keys.add(`${s}|${k}`);
  for (const v of Object.values(saved)) if (v?.succ && v.annee) keys.add(`${v.succ}|${v.annee}-${pad(v.mois)}`);
  const baseOf = (s: string, k: string, x: Fait): number => {
    const bm = idx?.baseMois?.[s]?.[k];
    return Number(k.slice(0, 4)) === 2026 && bm != null ? bm : (x.base ?? x.total);
  };
  const out: CtrlRow[] = [];
  for (const key of keys) {
    const [s = "", k = ""] = key.split("|");
    const x = faitsOf(idx, saved, s, k);
    if (!x) continue;
    const y = Number(k.slice(0, 4));
    const base = baseOf(s, k, x);
    const gap = round2(x.regule - base);
    const pct = base ? gap / base : 0;
    const fl: string[] = [];
    if (x.pa < 0) fl.push("part assisteur négative");
    if (Math.abs(gap) >= 5000 && Math.abs(pct) >= 0.05) fl.push(gap < 0 ? "production absente du fichier de régularisation" : "production en plus dans le fichier de régularisation");
    if (base > 0 && x.avance > 0 && Math.abs(x.avance / (0.9 * base) - 1) > 0.03 && Math.abs(x.avance - 0.9 * base) > 3000) fl.push(`avance atypique (90 % = ${Math.round(0.9 * base).toLocaleString("fr-FR")})`);
    if (x.releve != null && x.releve !== x.avance) fl.push(`relevé ${Math.round(x.releve).toLocaleString("fr-FR")} ≠ avance`);
    if (fl.length && base > 0) {
      const other = REGUL_SUCCURSALES.filter((t) => t !== s).find((t) => {
        const f2 = faitsOf(idx, saved, t, k);
        const b2 = Number(k.slice(0, 4)) === 2026 && idx?.baseMois?.[t]?.[k] != null ? (idx.baseMois[t]?.[k] ?? 0) : f2 ? (f2.base ?? f2.total) : 0;
        return b2 > 0 && Math.abs(x.regule - b2) / b2 < 0.0005 && Math.abs(x.regule - base) / base > 0.05;
      });
      if (other) fl.push(`montant régularisé = production de ${other} : lignes décalées ?`);
    }
    out.push({ s, k, y, regule: x.regule, avance: x.avance, pa: x.pa, base, gap, pct, fl, top: x.top ?? "", impact: gap < 0 ? round2(-gap * 1.19) : 0, src: x.src });
  }
  return out.sort((a, b) => (b.fl.length ? 1 : 0) - (a.fl.length ? 1 : 0) || Math.abs(b.gap) - Math.abs(a.gap));
}

export { REGUL_PROD };
