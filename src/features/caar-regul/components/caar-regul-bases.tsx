"use client";

import { useRef, useState } from "react";
import { saveCaarBaseAction, saveCaarIndexAction, saveCaarSinistresAction } from "@/app/actions/caar-regul-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { readCaarConso, type CaarConsoRead } from "@/features/caar-regul/lib/caar-conso-reader";
import { CAAR_LABELS, CAAR_SUCCURSALES, immatNorm, isoDate, policeBase, txt, type CaarRegulIndex } from "@/features/caar-regul/services/caar-regul-engine";
import { dateFr, f0 } from "@/features/regul/components/regul-format";
import { REGUL_MOIS } from "@/features/regul/services/regul-engine";
import { readWorkbook, type SheetCell } from "@/lib/spreadsheet";

interface Props {
  index: CaarRegulIndex | null;
  sin: { jusqua: string; maj: string; dossiers: number; cles: number } | null;
  isAdmin: boolean;
  onSaved: () => void;
}

type Msg = { tone: "info" | "error" | "success" | "warning"; text: string } | null;

const cellText = (v: SheetCell | undefined): string => (v === null || v === undefined ? "" : v instanceof Date ? isoDate(v) : String(v).trim());

/** Lit la base activité : clés « police | immatriculation » des dossiers CAAR (les autres compagnies sont écartées si la colonne existe). */
function readActivite(rows: ReadonlyArray<ReadonlyArray<SheetCell>>): { keys: string[]; dossiers: number; jusqua: string } {
  const hi = rows.findIndex((r) => r.some((c) => /^(N°\s*)?POLICE$/.test(txt(c).trim())));
  if (hi < 0) throw new Error("Colonnes « N° police » et « Immatriculation » introuvables.");
  const h = (rows[hi] ?? []).map((c) => txt(c).trim());
  const ip = h.findIndex((c) => /^(N°\s*)?POLICE$/.test(c));
  const ii = h.findIndex((c) => /IMMATRICULATION/.test(c));
  const dateCols = [h.indexOf("CREE LE"), h.indexOf("DATE D'OUVERTURE")];
  const ic = h.findIndex((c) => /COMPAGNIE|ASSUREUR|^CLIENT$|DONNEUR/.test(c));
  const data = rows.slice(hi + 1);
  const filtre = ic >= 0 && data.some((r) => /\bCAAR\b/.test(txt(r[ic])));
  const keys = new Set<string>();
  let n = 0;
  let mx = "";
  for (const r of data) {
    const police = cellText(r[ip]);
    if (!police) continue;
    if (filtre && !/\bCAAR\b/.test(txt(r[ic]))) continue;
    n++;
    keys.add(`${policeBase(police)}|${ii >= 0 ? immatNorm(cellText(r[ii])) : ""}`);
    for (const c of dateCols) {
      if (c < 0) continue;
      const iso = isoDate(r[c]);
      if (iso > mx) mx = iso;
    }
  }
  return { keys: [...keys].sort(), dossiers: n, jusqua: mx };
}

/** Onglet « Bases de données » : consolidé ALLO & CAAR et base activité. */
export function CaarRegulBases({ index, sin, isAdmin, onSaved }: Readonly<Props>): React.JSX.Element {
  const sinInput = useRef<HTMLInputElement>(null);
  const conInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [conso, setConso] = useState<CaarConsoRead | null>(null);
  const [busy, setBusy] = useState(false);
  const tot = Object.values(index?.lignes ?? {}).reduce((a, b) => a + b, 0);

  async function onSinFile(f: File): Promise<void> {
    setMsg({ tone: "info", text: "Lecture de la base activité…" });
    setBusy(true);
    try {
      const sheets = readWorkbook(new Uint8Array(await f.arrayBuffer()));
      const sheet = sheets.find((s) => /activit/i.test(s.name)) ?? sheets[0];
      const res0 = readActivite(sheet?.rows ?? []);
      if (!res0.keys.length) throw new Error("Aucun dossier CAAR lu dans ce fichier.");
      const fm2 = /(\d{4})-(\d{2})-(\d{2})/.exec(f.name);
      const res = await saveCaarSinistresAction({ keys: res0.keys, jusqua: fm2 ? fm2[0] : res0.jusqua, dossiers: res0.dossiers });
      if (!res.success) throw new Error(res.error);
      setMsg({ tone: "success", text: `Base activité mise à jour : ${f0(res0.dossiers)} dossiers CAAR.` });
      onSaved();
    } catch (error) {
      setMsg({ tone: "error", text: error instanceof Error ? error.message : "Fichier illisible." });
    }
    setBusy(false);
  }

  async function onConsoFile(f: File): Promise<void> {
    if (!/\.xlsx$/i.test(f.name)) {
      setMsg({ tone: "warning", text: "Il faut le classeur .xlsx du consolidé ALLO & CAAR." });
      return;
    }
    setConso(null);
    setBusy(true);
    try {
      const r = await readCaarConso(f, (t) => setMsg({ tone: "info", text: t }));
      if (!r.lignes) throw new Error("Aucune ligne lue dans l'onglet CONSOLIDE.");
      setConso(r);
      setMsg(null);
    } catch (error) {
      setMsg({ tone: "error", text: error instanceof Error ? error.message : "Fichier illisible." });
    }
    setBusy(false);
  }

  async function saveConso(r: CaarConsoRead): Promise<void> {
    setBusy(true);
    try {
      const lignes: Record<string, number> = {};
      for (const [s, months] of Object.entries(r.data)) {
        lignes[s] = 0;
        for (const [m, rows] of Object.entries(months)) {
          setMsg({ tone: "info", text: `Enregistrement : ${CAAR_LABELS[s as keyof typeof CAAR_LABELS] ?? s} ${REGUL_MOIS[(Number(m) % 100) - 1] ?? ""}…` });
          const res = await saveCaarBaseAction({ succursale: s, ym: Number(m), rows });
          if (!res.success) throw new Error(res.error);
          lignes[s] += rows.length;
        }
      }
      const res = await saveCaarIndexAction({ forms: r.forms, mois: r.mois, factures: r.factures, lignes, source: r.fichier, total: r.lignes });
      if (!res.success) throw new Error(res.error);
      setConso(null);
      setMsg({ tone: "success", text: `Consolidé enregistré : ${f0(r.lignes)} lignes.` });
      onSaved();
    } catch (error) {
      setMsg({ tone: "error", text: error instanceof Error ? error.message : "Enregistrement impossible." });
    }
    setBusy(false);
  }

  const ks = conso ? [...new Set(Object.values(conso.mois).flatMap((o) => Object.keys(o)))].sort() : [];
  return (
    <div className="flex flex-col gap-4">
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Card className="p-4">
        <h3 className="font-semibold">Consolidé ALLO &amp; CAAR</h3>
        <p className="text-sm text-muted-foreground">
          Le classeur alimenté chaque mois : onglet CONSOLIDE (production facturée à l&apos;avance, polices incluses et exclues) et onglet RECAP FACTURES (n° et montant TTC des factures d&apos;avance). Redéposez-le à chaque mise à jour : il remplace l&apos;ancien.
        </p>
        <p className="mt-2 text-sm">{index?.maj ? `Chargé : ${f0(tot)} lignes · mis à jour le ${dateFr(index.maj)}` : "Non chargé"}</p>
        {index?.source ? <p className="text-xs text-muted-foreground">{index.source}</p> : null}
        {isAdmin ? (
          <>
            <input ref={conInput} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onConsoFile(f); }} />
            <Button type="button" className="mt-3" variant="outline" disabled={busy} onClick={() => conInput.current?.click()}>Déposer le consolidé ALLO &amp; CAAR (.xlsx)</Button>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Seul un administrateur peut mettre à jour cette base.</p>
        )}
        {conso ? (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm"><b>{f0(conso.lignes)} lignes</b> lues dans « {conso.fichier} »{conso.ignorees ? ` (${conso.ignorees} ignorées : succursale ou mois illisible)` : ""}.</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs">
                    <th className="px-2 py-1.5 text-left">Succursale</th>
                    {ks.map((k) => <th key={k} className="px-2 py-1.5 text-right">{(REGUL_MOIS[Number(k.slice(5)) - 1] ?? "").slice(0, 4)}. {k.slice(0, 4)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {CAAR_SUCCURSALES.map((s) => (
                    <tr key={s} className="border-t">
                      <td className="px-2 py-1 font-medium">{CAAR_LABELS[s]}</td>
                      {ks.map((k) => {
                        const o = conso.mois[s]?.[k];
                        const f = conso.factures[s]?.[k];
                        return (
                          <td key={k} className="px-2 py-1 text-right tabular-nums">
                            {o ? `${f0(o.n)} l.` : "—"}
                            {f ? <span className="block text-xs text-muted-foreground">{f.fact}</span> : o ? <span className="block text-xs text-destructive">pas de facture</span> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Nombre de lignes par mois et facture d&apos;avance trouvée dans RECAP FACTURES. Un mois sans facture garde l&apos;avance calculée ligne par ligne (Part Assisteur 90 %), modifiable au moment du calcul.</p>
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => void saveConso(conso)}>Enregistrer dans la base</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConso(null)}>Annuler</Button>
            </div>
          </div>
        ) : null}
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold">Base activité (sinistres)</h3>
        <p className="text-sm text-muted-foreground">Export « activités » du système d&apos;assistance. Seules les clés police + immatriculation des dossiers CAAR sont gardées, pour repérer les polices annulées qui ont eu une assistance : le contenu de la base n&apos;apparaît dans aucun export.</p>
        <p className="mt-2 text-sm">{sin ? `Chargée : arrêtée au ${dateFr(sin.jusqua)} · ${f0(sin.dossiers)} dossiers CAAR · mise à jour le ${dateFr(sin.maj)}` : "Non chargée"}</p>
        {isAdmin ? (
          <>
            <input ref={sinInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onSinFile(f); }} />
            <Button type="button" className="mt-3" variant="outline" disabled={busy} onClick={() => sinInput.current?.click()}>Déposer la base activité (.xlsx)</Button>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Seul un administrateur peut mettre à jour cette base.</p>
        )}
      </Card>
    </div>
  );
}
