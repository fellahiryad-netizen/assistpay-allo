"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CaarRegulBases } from "@/features/caar-regul/components/caar-regul-bases";
import { CaarRegulCalc } from "@/features/caar-regul/components/caar-regul-calc";
import { CaarRegulSuivi } from "@/features/caar-regul/components/caar-regul-suivi";
import type { CaarSucc } from "@/features/caar-regul/services/caar-regul-engine";
import type { CaarRegulOverview } from "@/features/caar-regul/services/caar-regul-store";
import { dateFr, f0 } from "@/features/regul/components/regul-format";
import { cn } from "@/utils/cn";

type Tab = "calc" | "suivi" | "bases";
const TABS: ReadonlyArray<[Tab, string]> = [["calc", "Régulariser"], ["suivi", "Suivi"], ["bases", "Bases de données"]];

interface Props {
  overview: CaarRegulOverview;
  isAdmin: boolean;
  canEdit: boolean;
  canExport: boolean;
  signataire: string;
}

/** CAAR Régul 10 % : trois onglets (Régulariser, Suivi, Bases de données). */
export function CaarRegulApp({ overview, isAdmin, canEdit, canExport, signataire }: Readonly<Props>): React.JSX.Element {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("calc");
  const [succ, setSucc] = useState<CaarSucc | "">("");
  const [year, setYear] = useState(2026);
  const [nonce, setNonce] = useState(0);
  const { index, sin, saved } = overview;
  const total = Object.values(index?.lignes ?? {}).reduce((a, b) => a + b, 0);
  const chip = (ok: boolean, text: string): React.JSX.Element => (
    <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm">
      <i className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-destructive")} />
      {text}
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {index?.maj ? chip(true, `Consolidé ALLO & CAAR : ${f0(total)} lignes · mis à jour le ${dateFr(index.maj)}`) : chip(false, "Consolidé ALLO & CAAR non chargé")}
        {sin ? chip(true, `Base activité arrêtée au ${dateFr(sin.jusqua)} · ${f0(sin.dossiers)} dossiers CAAR`) : chip(false, "Base activité non chargée")}
      </div>
      <div className="flex flex-wrap gap-1" role="group">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={cn("rounded-md border px-3 py-1.5 text-sm", tab === key && "bg-primary text-primary-foreground")}>
            {label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "calc"}>
        <CaarRegulCalc key={nonce} index={index} sinMeta={sin} canEdit={canEdit} canExport={canExport} initialSucc={succ} initialYear={year} signataire={signataire} onSaved={() => router.refresh()} />
      </div>
      {tab === "suivi" ? (
        <CaarRegulSuivi
          index={index}
          saved={saved}
          onOpen={(s, y) => {
            setSucc(s);
            setYear(y);
            setNonce((n) => n + 1);
            setTab("calc");
          }}
        />
      ) : null}
      {tab === "bases" ? <CaarRegulBases index={index} sin={sin} isAdmin={isAdmin} onSaved={() => router.refresh()} /> : null}
    </div>
  );
}
