import { REGUL_LABELS, REGUL_MOIS, type Analysis } from "@/features/regul/services/regul-engine";

/** Ligne de calcul utile au message (écart par mois). */
export interface MessageRow {
  m: number;
  avance: number;
  regule: number;
  ecart: number;
}

const da = (value: number): string => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
const mois = (m: number): string => (REGUL_MOIS[m - 1] ?? "").toLowerCase();
const agence = (code: number, nom: string): string => (nom ? `${code} (${nom.replace(/^\d+\s*-\s*/, "")})` : String(code));

/**
 * Message à envoyer à la succursale : écarts négatifs détectés et agences absentes des fichiers.
 * Renvoie null quand il n'y a rien à signaler.
 */
export function buildRegulMessage(a: Analysis, rows: ReadonlyArray<MessageRow>, periodeTxt: string): { subject: string; body: string } | null {
  const succ = REGUL_LABELS[a.s] ?? a.s;
  const negatifs = rows.filter((r) => r.ecart < 0);
  const absentes = new Map<number, { nom: string; mois: number[] }>();
  for (const x of a.manquantes) {
    const cur = absentes.get(x.code) ?? { nom: x.nom, mois: [] };
    cur.mois.push(x.m);
    absentes.set(x.code, cur);
  }
  if (!negatifs.length && !absentes.size) return null;
  const nbMois = new Set(a.files.map((f) => f.mois)).size;
  const parts: string[] = ["Bonjour,", "", `Nous avons contrôlé les fichiers de production de la succursale ${succ} pour ${periodeTxt}. Deux points nécessitent votre vérification.`];

  if (negatifs.length) {
    parts.push("", "1. Écarts négatifs");
    for (const r of negatifs) {
      const causes = a.agTab
        .map((ag) => {
          const p = ag.par.find((x) => x.m === r.m);
          return { code: ag.code, nom: ag.nom, d: p ? Math.round((p.f.pa - p.b.pa) * 100) / 100 : 0 };
        })
        .filter((x) => x.d <= -500)
        .sort((x, y) => x.d - y.d)
        .slice(0, 5);
      const annulees = a.annul.filter((x) => x.m === r.m).length;
      parts.push(`- ${mois(r.m)} : régule de ${da(r.regule)} pour une avance de ${da(r.avance)}, soit un écart de ${da(r.ecart)}.`);
      if (causes.length) parts.push(`  Agences les plus concernées : ${causes.map((x) => `${agence(x.code, x.nom)} ${da(x.d)}`).join(" ; ")}.`);
      if (annulees) parts.push(`  ${annulees} police(s) annulée(s) sur ce mois.`);
    }
    parts.push("Merci de nous confirmer que ces annulations sont bien justifiées, ou de nous renvoyer les fichiers corrigés.");
  }

  if (absentes.size) {
    parts.push("", `${negatifs.length ? "2" : "1"}. Agences absentes des fichiers`);
    for (const [code, v] of absentes) {
      const complet = nbMois > 0 && v.mois.length >= nbMois;
      parts.push(complet ? `- Agence ${agence(code, v.nom)} : aucune ligne reçue sur toute la période alors qu'elle figure dans notre base de production.` : `- Agence ${agence(code, v.nom)} : aucune ligne reçue pour ${v.mois.map(mois).join(", ")}.`);
    }
    parts.push("Merci de nous transmettre les fichiers manquants, ou de nous indiquer si l'agence n'a pas eu de production.");
  }

  parts.push("", "Nous restons à votre disposition.", "", "Cordialement,", "Riad FELLAHI", "Allo Assistance");
  return { subject: `Régularisation CAAT 10 % – ${succ} – ${periodeTxt} : points à vérifier`, body: parts.join("\n") };
}
