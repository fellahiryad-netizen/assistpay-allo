"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { fpCreateAction, fpDeleteAction, fpMoveAction, fpNoteAction, fpSavePrestAction } from "@/app/actions/provider-invoice-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ageDays, demandePar, enRetard, FP_PRODUITS, FP_RETARD_JOURS, FP_STATUTS, FP_SUIVANT, fullName, relanceText, traitePar, type FpProduit, type FpRequest, type FpStatut } from "@/features/provider-invoices/services/fp-engine";
import type { FpOverview } from "@/features/provider-invoices/services/fp-store";
import { cn } from "@/utils/cn";
import { formatDA, formatDate } from "@/utils/format";
import { upperPlain } from "@/utils/text";

const TONE: Readonly<Record<FpStatut, "warning" | "default" | "success" | "muted">> = { A_ETABLIR: "warning", ENVOYEE: "default", A_PAYER: "success", PAYEE: "muted", ANNULEE: "muted" };
const NEXT_LABEL: Readonly<Partial<Record<FpStatut, string>>> = { ENVOYEE: "Facture établie et envoyée", A_PAYER: "Original reçu", PAYEE: "Marquer payée" };

/** Suivi des factures prestataires : demande, établissement, envoi, original reçu, paiement. */
export function FpApp({ data, canEdit }: Readonly<{ data: FpOverview; canEdit: boolean }>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [p, setP] = useState<FpProduit>("A");
  const [view, setView] = useState<"suivi" | "prest">("suivi");
  const [filter, setFilter] = useState<FpStatut | "TOUS" | "RETARD">("TOUS");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [num, setNum] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pNom, setPNom] = useState("");
  const [pMail, setPMail] = useState("");

  const info = data.info[p];
  const mine = useMemo(() => data.reqs.filter((r) => r.p === p), [data.reqs, p]);
  const toIssue = mine.filter((r) => r.st === "A_ETABLIR");
  const count = (st: FpStatut): number => mine.filter((r) => r.st === st).length;
  const late = mine.filter((r) => enRetard(r, data.today));
  const rows = mine
    .filter((r) => (filter === "TOUS" ? r.st !== "ANNULEE" : filter === "RETARD" ? enRetard(r, data.today) : r.st === filter))
    .filter((r) => !search || upperPlain(`${r.nom} ${r.prenom} ${r.num} ${r.obs}`).includes(upperPlain(search)));
  const emailOf = (r: FpRequest): string => data.prest.find((x) => x.actif && upperPlain(x.nom) === upperPlain(fullName(r)))?.email ?? data.prest.find((x) => x.actif && upperPlain(fullName(r)).split(" ").every((w) => upperPlain(x.nom).includes(w)))?.email ?? "";

  function run(task: () => Promise<{ success: boolean; error?: string }>, done?: string): void {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const r = await task();
      if (!r.success) setError(r.error ?? "Action impossible.");
      else {
        if (done) setOkMsg(done);
        router.refresh();
      }
    });
  }

  function create(): void {
    const words = name.replace(/\s+/g, " ").trim().split(" ");
    run(async () => {
      const r = await fpCreateAction({ p, nom: words[0] ?? "", prenom: words.slice(1).join(" "), num: num || info.next });
      if (r.success) {
        setName("");
        setNum("");
      }
      return r;
    }, "Demande enregistrée : le chargé de facturation la voit dans « À établir ».");
  }

  const tab = (active: boolean): string => cn("rounded-md px-3 py-1.5 text-sm font-medium", active ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-muted");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["A", "B"] as const).map((code) => (
          <button key={code} type="button" className={tab(p === code && view === "suivi")} onClick={() => { setP(code); setView("suivi"); setFilter("TOUS"); }}>
            {FP_PRODUITS[code]} <Badge variant={p === code && view === "suivi" ? "muted" : "default"}>{data.reqs.filter((r) => r.p === code && r.st === "A_ETABLIR").length}</Badge>
          </button>
        ))}
        <button type="button" className={cn(tab(view === "prest"), "ml-auto")} onClick={() => setView("prest")}>
          Prestataires et e-mails ({data.prest.length})
        </button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {okMsg ? <Notice tone="success">{okMsg}</Notice> : null}

      {view === "prest" ? (
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted-foreground">Prestataires à qui l&apos;on envoie la facture pour cachet et signature. L&apos;adresse sert aux messages de relance.</p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Input className="w-64" placeholder="Nom Prénom" value={pNom} onChange={(e) => setPNom(e.target.value)} />
              <Input className="w-72" placeholder="adresse e-mail" value={pMail} onChange={(e) => setPMail(e.target.value)} />
              <Button type="button" disabled={pending || !pNom || !pMail} onClick={() => run(() => fpSavePrestAction({ nom: pNom, email: pMail, actif: true }).then((r) => { if (r.success) { setPNom(""); setPMail(""); } return r; }), "Prestataire enregistré.")}>
                Ajouter
              </Button>
            </div>
          ) : null}
          <div className="max-h-[28rem] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr><th className="px-2 py-2 text-left">Prestataire</th><th className="px-2 py-2 text-left">E-mail</th><th className="px-2 py-2" /></tr>
              </thead>
              <tbody>
                {data.prest.map((x) => (
                  <tr key={x.id} className={cn("border-t", !x.actif && "opacity-50")}>
                    <td className="px-2 py-1.5 font-medium">{x.nom}</td>
                    <td className="px-2 py-1.5">{x.email}</td>
                    <td className="px-2 py-1.5 text-right">
                      {canEdit ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => fpSavePrestAction({ id: x.id, nom: x.nom, email: x.email, actif: !x.actif }))}>{x.actif ? "Désactiver" : "Réactiver"}</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Dernier numéro utilisé</p>
              <p className="text-lg font-bold tabular-nums">{info.last?.num ?? "—"}</p>
              <p className="truncate text-xs text-muted-foreground">{info.last ? `${fullName(info.last)} · ${formatDate(info.last.date)}` : ""}</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Prochain numéro proposé</p>
              <p className="text-lg font-bold tabular-nums text-primary">{info.next}</p>
              <p className="text-xs text-muted-foreground">À confirmer avec le portail</p>
            </Card>
            <Card className={cn("p-3", toIssue.length && "border-warning")}>
              <p className="text-xs text-muted-foreground">À établir</p>
              <p className="text-lg font-bold">{toIssue.length}</p>
            </Card>
            <Card className={cn("p-3", late.length && "border-destructive")}>
              <p className="text-xs text-muted-foreground">Originaux en retard (&gt; {FP_RETARD_JOURS} j)</p>
              <p className="text-lg font-bold">{late.length}</p>
            </Card>
          </div>
          {info.gaps.length ? <Notice tone="warning">Numéros absents du suivi parmi les 40 derniers : {info.gaps.join(", ")}. Vérifiez qu&apos;ils n&apos;ont pas été oubliés.</Notice> : null}

          {canEdit ? (
            <Card className="flex flex-col gap-2 p-4">
              <h3 className="font-semibold">Nouvelle demande ({FP_PRODUITS[p]})</h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor="fp-nom">Prestataire (nom puis prénom)</label>
                  <Input id="fp-nom" list="fp-prest" className="w-72" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. BOUAFIA MOHAMED" />
                  <datalist id="fp-prest">{data.prest.filter((x) => x.actif).map((x) => <option key={x.id} value={x.nom} />)}</datalist>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor="fp-num">N° de facture (portail)</label>
                  <Input id="fp-num" className="w-44 font-mono" value={num} onChange={(e) => setNum(e.target.value.toUpperCase())} placeholder={info.next} />
                </div>
                <Button type="button" disabled={pending || name.trim().length < 2} onClick={create}>Envoyer la demande au chargé de facturation</Button>
              </div>
            </Card>
          ) : null}

          {toIssue.length ? (
            <Card className="flex flex-col gap-2 border-warning p-4">
              <h3 className="font-semibold">À établir : {toIssue.length} facture(s)</h3>
              <p className="text-xs text-muted-foreground">Établissez la facture dans le système interne, saisissez son montant, puis validez : elle quitte cette liste et arrive dans les factures fournisseurs (en attente).</p>
              {toIssue.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                  <b className="w-40 font-mono">{r.num}</b>
                  <span className="min-w-0 flex-1 truncate">{fullName(r)} <span className="text-xs text-muted-foreground">· demandée le {formatDate(r.date)}{demandePar(r) ? ` par ${demandePar(r)?.par}` : ""}</span></span>
                  {canEdit ? (
                    <>
                      <Input className="w-36 text-right" inputMode="decimal" placeholder="Montant (DA)" value={amounts[r.id] ?? ""} onChange={(e) => setAmounts((c) => ({ ...c, [r.id]: e.target.value }))} />
                      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => fpMoveAction({ id: r.id, to: "ENVOYEE", mt: Number((amounts[r.id] ?? "").replace(/\s/g, "").replace(",", ".")) || undefined }))}>
                        Facture établie et envoyée
                      </Button>
                    </>
                  ) : null}
                </div>
              ))}
            </Card>
          ) : null}

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["TOUS", "ENVOYEE", "A_PAYER", "PAYEE", "RETARD"] as const).map((key) => (
                <button key={key} type="button" className={tab(filter === key)} onClick={() => setFilter(key)}>
                  {key === "TOUS" ? "Toutes" : key === "RETARD" ? `En retard (${late.length})` : `${FP_STATUTS[key]} (${count(key)})`}
                </button>
              ))}
              <Input className="ml-auto w-60" placeholder="Prestataire, n° de facture…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher" />
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">N° facture</th>
                    <th className="px-2 py-2 text-left">Prestataire</th>
                    <th className="px-2 py-2 text-left">Demandée par</th>
                    <th className="px-2 py-2 text-right">Montant</th>
                    <th className="px-2 py-2 text-left">Étape / traitée par</th>
                    <th className="px-2 py-2 text-left">Observation</th>
                    <th className="px-2 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const mail = emailOf(r);
                    const late1 = enRetard(r, data.today);
                    const msg = relanceText(r);
                    const next = FP_SUIVANT[r.st];
                    return (
                      <tr key={r.id} className={cn("border-t align-top", late1 && "bg-destructive/5")}>
                        <td className="px-2 py-1.5 font-mono font-medium">{r.num}</td>
                        <td className="px-2 py-1.5">{fullName(r)}{mail ? <span className="block text-xs text-muted-foreground">{mail}</span> : null}</td>
                        <td className="px-2 py-1.5">{demandePar(r)?.par ?? "—"}<span className="block text-xs text-muted-foreground">{formatDate(r.date)}</span></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.mt ? formatDA(r.mt) : "—"}</td>
                        <td className="px-2 py-1.5">
                          <Badge variant={TONE[r.st]}>{FP_STATUTS[r.st]}</Badge>
                          <span className="block text-xs text-muted-foreground">{traitePar(r) ? `traitée par ${traitePar(r)?.par} le ${formatDate((traitePar(r)?.le ?? "").slice(0, 10))}` : "pas encore traitée"}</span>
                          {r.st === "ENVOYEE" ? <span className={cn("block text-xs", late1 ? "font-medium text-destructive" : "text-muted-foreground")}>envoyée il y a {ageDays(r.envoyeLe ?? r.date, data.today)} j</span> : null}
                        </td>
                        <td className="px-2 py-1.5"><Input className="h-8 w-44 text-xs" defaultValue={r.obs} disabled={!canEdit} onBlur={(e) => { if (e.target.value !== r.obs) void fpNoteAction({ id: r.id, obs: e.target.value }); }} aria-label={`Observation ${r.num}`} /></td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {canEdit && next && r.st !== "A_ETABLIR" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => fpMoveAction({ id: r.id, to: next }))}>{NEXT_LABEL[next]}</Button> : null}
                            {r.st === "ENVOYEE" && mail ? (
                              <a className={cn("inline-flex h-8 items-center rounded-md border px-2 text-xs font-medium hover:bg-muted", late1 && "border-destructive text-destructive")} href={`mailto:${mail}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`}>
                                Relancer
                              </a>
                            ) : null}
                            {canEdit ? <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { if (window.confirm(`Supprimer définitivement la ligne ${r.num} (${fullName(r)}) du suivi ?${r.invoiceLegacyId ? " La facture fournisseur déjà créée reste dans Factures fournisseurs." : ""}`)) run(() => fpDeleteAction({ id: r.id }), "Ligne supprimée."); }}>Supprimer</Button> : null}
                            {canEdit && r.st !== "ANNULEE" && r.st !== "PAYEE" ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm(`Annuler la facture ${r.num} ?`)) run(() => fpMoveAction({ id: r.id, to: "ANNULEE" })); }}>Annuler</Button> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 ? <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">Aucune facture.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
