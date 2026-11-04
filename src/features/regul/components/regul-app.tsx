"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RegulBases } from "@/features/regul/components/regul-bases";
import { RegulCalc } from "@/features/regul/components/regul-calc";
import { RegulCtrl } from "@/features/regul/components/regul-ctrl";
import { dateFr, f0 } from "@/features/regul/components/regul-format";
import { RegulSuivi } from "@/features/regul/components/regul-suivi";
import type { RegulOverview } from "@/features/regul/services/regul-store";
import { cn } from "@/utils/cn";

type Tab = "calc" | "suivi" | "ctrl" | "bases";
const TABS: ReadonlyArray<[Tab, string]> = [["calc", "Régulariser"], ["suivi", "Suivi"], ["ctrl", "Contrôle qualité"], ["bases", "Bases de données"]];

/** CAAT Régul 10 % : quatre onglets (Régulariser, Suivi, Contrôle qualité, Bases de données). */
export function RegulApp({ overview, isAdmin, canEdit, canExport }: Readonly<{ overview: RegulOverview; isAdmin: boolean; canEdit: boolean; canExport: boolean }>): React.JSX.Element {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("calc");
  const [succ, setSucc] = useState("");
  const [nonce, setNonce] = useState(0);
  const { index, sin, saved } = overview;
  const total = Object.values(index?.lignes ?? {}).reduce((a, b) => a + b, 0);
  const histCount = Object.values(index?.faits ?? {}).reduce((a, m) => a + Object.keys(m).length, 0);
  const chip = (ok: boolean, text: string): React.JSX.Element => (
    <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm">
      <i className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-destructive")} />
      {text}
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {sin ? chip(true, `Sinistres arrêtés au ${dateFr(sin.jusqua)} · ${f0(sin.cles)} clés`) : chip(false, "Base sinistres non chargée")}
        {index?.maj ? chip(true, `Production 2026 : ${f0(total)} lignes · mise à jour le ${dateFr(index.maj)}`) : chip(false, "Base production non chargée")}
        {index?.maj ? chip(histCount > 0, `Historique des régularisations : ${histCount} mois`) : null}
      </div>
      <div className="flex flex-wrap gap-1" role="group">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={cn("rounded-md border px-3 py-1.5 text-sm", tab === key && "bg-primary text-primary-foreground")}>
            {label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "calc"}>
        <RegulCalc key={nonce} index={index} sinMeta={sin} canEdit={canEdit} canExport={canExport} initialSucc={succ} onSaved={() => router.refresh()} />
      </div>
      {tab === "suivi" ? (
        <RegulSuivi
          index={index}
          saved={saved}
          onOpen={(s) => {
            setSucc(s);
            setNonce((n) => n + 1);
            setTab("calc");
          }}
        />
      ) : null}
      {tab === "ctrl" ? <RegulCtrl index={index} saved={saved} /> : null}
      {tab === "bases" ? <RegulBases index={index} sin={sin} isAdmin={isAdmin} onSaved={() => router.refresh()} /> : null}
    </div>
  );
}
