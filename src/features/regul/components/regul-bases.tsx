"use client";

import { useRef, useState, useTransition } from "react";
import { saveBaseAction, saveIndexAction, saveSinistresAction } from "@/app/actions/regul-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { dateFr, f0, fm } from "@/features/regul/components/regul-format";
import { readConso } from "@/features/regul/lib/conso-reader";
import { consoControle, histControle, type ConsoRead } from "@/features/regul/services/regul-checks";
import { basePolice, norm, REGUL_LABELS, REGUL_MOIS, REGUL_SUCCURSALES, type RegulIndex } from "@/features/regul/services/regul-engine";
import { readWorkbook } from "@/lib/spreadsheet";

interface Props {
  index: RegulIndex | null;
  sin: { jusqua: string; maj: string; dossiers: number; cles: number } | null;
  isAdmin: boolean;
  onSaved: () => void;
}

const cellText = (v: unknown): string => (v === null || v === undefined ? "" : v instanceof Date ? `${String(v.getUTCDate()).padStart(2, "0")}/${String(v.getUTCMonth() + 1).padStart(2, "0")}/${v.getUTCFullYear()}` : String(v).trim());

/** Onglet « Bases de données » : base sinistres (activités) et consolidé CAAT (production, avances, historique). */
export function RegulBases({ index, sin, isAdmin, onSaved }: Readonly<Props>): React.JSX.Element {
  const sinInput = useRef<HTMLInputElement>(null);
  const conInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "error" | "success" | "warning"; text: string } | null>(null);
  const [conso, setConso] = useState<ConsoRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const tot = Object.values(index?.lignes ?? {}).reduce((a, b) => a + b, 0);
  const histCount = Object.values(index?.faits ?? {}).reduce((a, m) => a + Object.keys(m).length, 0);

  async function onSinFile(f: File): Promise<void> {
    setMsg({ tone: "info", text: "Lecture de la base sinistres…" });
    setBusy(true);
    try {
      const sheets = readWorkbook(new Uint8Array(await f.arrayBuffer()));
      const sheet = sheets.find((s) => /activit/i.test(s.name)) ?? sheets[0];
      const rows = sheet?.rows ?? [];
      const hi = rows.findIndex((r) => r.some((c) => /^N°\s*police$/i.test(cellText(c))));
      if (hi < 0) throw new Error("Colonnes « N° police » et « Immatriculation » introuvables.");
      const h = (rows[hi] ?? []).map((c) => cellText(c).toLowerCase());
      const ip = h.findIndex((c) => /^n°\s*police$/.test(c));
      const ii = h.indexOf("immatriculation");
      const dateCols = [h.findIndex((c) => c === "créé le"), h.findIndex((c) => c === "date d'ouverture")];
      const keys = new Set<string>();
      let n = 0;
      let mx = "";
      for (const r of rows.slice(hi + 1)) {
        const police = cellText(r[ip]);
        if (!police) continue;
        n++;
        keys.add(`${basePolice(police)}|${ii >= 0 && r[ii] ? norm(cellText(r[ii])) : ""}`);
        for (const c of dateCols) {
          if (c < 0) continue;
          const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(cellText(r[c]));
          if (m) {
            const iso = `${m[3]}-${m[2]}-${m[1]}`;
            if (iso > mx) mx = iso;
          }
        }
      }
      if (!keys.size) throw new Error("Aucun dossier lu dans ce fichier.");
      const fm2 = /(\d{4})-(\d{2})-(\d{2})/.exec(f.name);
      const res = await saveSinistresAction({ keys: [...keys].sort(), jusqua: fm2 ? fm2[0] : mx, dossiers: n });
      if (!res.success) throw new Error(res.error);
      setMsg({ tone: "success", text: `Base sinistres mise à jour : ${f0(n)} dossiers.` });
      onSaved();
    } catch (error) {
      setMsg({ tone: "error", text: error instanceof Error ? error.message : "Fichier illisible." });
    }
    setBusy(false);
  }

  async function onConsoFile(f: File): Promise<void> {
    if (!/\.xlsx$/i.test(f.name)) {
      setMsg({ tone: "warning", text: "Il faut le classeur .xlsx du consolidé." });
      return;
    }
    if (typeof DecompressionStream === "undefined") {
      setMsg({ tone: "warning", text: "Ce navigateur ne sait pas lire un fichier de cette taille ; utilisez Chrome ou Edge récents." });
      return;
    }
    setConso(null);
    setBusy(true);
    try {
      setMsg({ tone: "info", text: `Lecture de « ${f.name} »…` });
      const R = await readConso(f, (text) => setMsg({ tone: "info", text }));
      if (!R.lignes) throw new Error("Aucune ligne 2026 trouvée dans l'onglet EXTRACTION CAAT VALID 25-26.");
      setConso(R);
      setMsg(null);
    } catch (error) {
      setMsg({ tone: "error", text: error instanceof Error ? error.message : "Fichier illisible." });
    }
    setBusy(false);
  }

  function saveConso(R: ConsoRead): void {
    setBusy(true);
    startTransition(async () => {
      try {
        const lignes: Record<string, number> = {};
        for (const s of REGUL_SUCCURSALES) {
          const rows = R.data[s];
          if (!rows?.length) continue;
          setMsg({ tone: "info", text: `Enregistrement de ${REGUL_LABELS[s]} (${f0(rows.length)} lignes)…` });
          const res = await saveBaseAction({ succursale: s, rows });
          if (!res.success) throw new Error(`${REGUL_LABELS[s]} : ${res.error}`);
          lignes[s] = rows.length;
        }
        const res = await saveIndexAction({ lignes, tcd: R.tcd, hist: R.hist, baseMois: R.baseMois, agences: R.agences, source: R.fichier, total: R.lignes });
        if (!res.success) throw new Error(res.error);
        setConso(null);
        setMsg({ tone: "success", text: `Base mise à jour : ${f0(R.lignes)} lignes.` });
        onSaved();
      } catch (error) {
        setMsg({ tone: "error", text: error instanceof Error ? error.message : "Enregistrement impossible." });
      }
      setBusy(false);
    });
  }

  const C = conso ? consoControle(conso, index) : [];
  const H = conso ? histControle(conso) : null;
  const pill = (ok: boolean, text: string): React.JSX.Element => <span className={`rounded-full px-2 py-0.5 text-xs ${ok ? "bg-success/15 text-success" : "bg-warning/25"}`}>{text}</span>;

  return (
    <div className="flex flex-col gap-4">
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Card className="p-4">
        <h3 className="font-semibold">Base sinistres</h3>
        <p className="text-sm text-muted-foreground">Export « activités » du système (onglet Activités). Seules les clés police + immatriculation sont mémorisées : le contenu n&apos;apparaît dans aucun export.</p>
        <p className="mt-2 text-sm">
          {sin ? (
            <>
              {pill(true, "chargée")} arrêtée au <b>{dateFr(sin.jusqua)}</b> · {f0(sin.dossiers)} dossiers · {f0(sin.cles)} clés · mise à jour le {dateFr(sin.maj)}
            </>
          ) : (
            pill(false, "non chargée")
          )}
        </p>
        {isAdmin ? (
          <>
            <input ref={sinInput} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onSinFile(f); e.target.value = ""; }} />
            <Button type="button" variant="outline" className="mt-3" disabled={busy} onClick={() => sinInput.current?.click()}>Déposer la base sinistres (.xlsx)</Button>
            <span className="ml-2 text-xs text-muted-foreground">fichier activites-CAAT-AAAA-MM-JJ.xlsx</span>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Seul un administrateur peut mettre à jour cette base.</p>
        )}
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold">Production, avances mensuelles et historique des régularisations</h3>
        <p className="text-sm text-muted-foreground">Consolidé CAAT : onglets EXTRACTION CAAT VALID 25-26 (production ligne par ligne), TCD (avances) et REGUL (régularisations passées).</p>
        <p className="mt-2 text-sm">
          {index?.maj ? (
            <>
              {pill(true, "chargée")} <b>{f0(tot)}</b> lignes de production 2026 · {histCount} régularisations · mise à jour le {dateFr(index.maj)}
              <span className="block text-xs text-muted-foreground">{index.source}</span>
            </>
          ) : (
            pill(false, "non chargée")
          )}
        </p>
        {isAdmin ? (
          <>
            <input ref={conInput} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onConsoFile(f); e.target.value = ""; }} />
            <Button type="button" variant="outline" className="mt-3" disabled={busy} onClick={() => conInput.current?.click()}>Déposer le consolidé CAAT (.xlsx)</Button>
            <span className="ml-2 text-xs text-muted-foreground">la lecture prend quelques secondes, même pour 60 Mo</span>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Seul un administrateur peut mettre à jour cette base.</p>
        )}
        {conso && H ? (
          <div className="mt-4 flex flex-col gap-3">
            <p>
              <b>{f0(conso.lignes)} lignes 2026</b> lues dans « {conso.fichier} »{conso.ignorees ? ` (${conso.ignorees} ignorées : succursale inconnue)` : ""}.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs">
                    {["Succursale", "Lignes en base", "Lignes du fichier", "Mois couverts", "Contrôle TCD", "Avances"].map((h) => (
                      <th key={h} className="px-2 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {C.map((c) => (
                    <tr key={c.s} className="border-t">
                      <td className="px-2 py-1.5 font-medium">{REGUL_LABELS[c.s]}</td>
                      <td className="px-2 py-1.5 tabular-nums">{f0(c.avant)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{f0(c.n)}</td>
                      <td className="px-2 py-1.5">{c.mois.map((m) => `${(REGUL_MOIS[m - 1] ?? "").slice(0, 4).toLowerCase()}.`).join(" ") || "—"}</td>
                      <td className="px-2 py-1.5" title={c.ecarts.map((e) => `${REGUL_MOIS[Number(e.k.slice(5)) - 1]} : TCD ${fm(e.tcd)} / lignes ${fm(e.lignes)}`).join(" ; ")}>{c.ecarts.length ? pill(false, `${c.ecarts.length} écart(s)`) : pill(true, "cohérent")}</td>
                      <td className="px-2 py-1.5" title={c.atyp.map((e) => `${REGUL_MOIS[Number(e.k.slice(5)) - 1]} : avance ${fm(e.avance)} pour une part assisteur de ${fm(e.total)} (90 % = ${fm(e.total * 0.9)})`).join(" ; ")}>{c.atyp.length ? pill(false, `${c.atyp.length} à vérifier`) : pill(true, "cohérentes")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Contrôle TCD : somme des parts assisteur des lignes comparée, mois par mois, au total du TCD. Avances : montant reçu comparé à 90 % de la part assisteur (écart de plus de 10 % = à vérifier avec le relevé bancaire). Les avances déjà confirmées par le relevé bancaire et enregistrées dans le suivi restent prioritaires sur le TCD.</p>
            <div className="rounded-lg border bg-card p-3 text-sm">
              <b>Historique des régularisations</b> : {H.n} mois lus (onglet REGUL en priorité, TCD sinon).
              <ul className="ml-5 mt-1 list-disc">
                <li>Arithmétique (écart = régule − avance ; TVA = 19 % du régule ; part = écart + TVA) : {H.arith.length ? <b>{H.arith.length} ligne(s) incohérente(s) : {H.arith.slice(0, 6).map((a) => `${REGUL_LABELS[a.s]} ${a.k}`).join(", ")}</b> : "toutes cohérentes"}</li>
                <li>Deux sources en désaccord (REGUL ≠ colonnes du TCD) : {H.conflits.length ? `${H.conflits.length} (${[...new Set(H.conflits.map((c) => c.k))].join(", ")}) — l'onglet REGUL est retenu` : "aucun"}</li>
                <li>Avance enregistrée ≠ relevé bancaire (colonne RELEVE) : {H.releve.length ? H.releve.map((a) => `${REGUL_LABELS[a.s]} ${a.k} : ${f0(a.avance)} / ${f0(a.releve)}`).join(" ; ") : "aucun"}</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => saveConso(conso)}>Enregistrer dans la base</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConso(null)}>Annuler</Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
