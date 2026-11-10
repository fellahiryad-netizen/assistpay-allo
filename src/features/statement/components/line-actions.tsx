"use client";

import { useState, useTransition, type FormEvent } from "react";
import { EyeOff, FilePlus2, Link2, Undo2 } from "lucide-react";
import { assignCandidatesAction, assignCaatAction, assignLineAction, createInvoiceFromLineAction, ignoreLineAction, reopenLineAction } from "@/app/actions/statement-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CAAT_SUCCURSALES } from "@/features/invoices/caat-constants";
import { MONTHS_FR } from "@/utils/dates";
import type { AssignCandidate, StatementLineDTO } from "@/features/statement/types";
import { round2 } from "@/utils/amounts";
import { formatDA, formatDate } from "@/utils/format";

/** Propriétés des actions sur une ligne du relevé. */
export interface LineActionsProps {
  line: StatementLineDTO;
  categories: string[];
}

/** Actions sur une ligne : affecter à des factures, ajouter au suivi, ignorer, remettre à traiter. */
export function LineActions({ line, categories }: Readonly<LineActionsProps>): React.JSX.Element {
  const [dialog, setDialog] = useState<"assign" | "create" | null>(null);
  const [candidates, setCandidates] = useState<AssignCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [caatBranch, setCaatBranch] = useState<string>(CAAT_SUCCURSALES[0]);
  const [caatPeriod, setCaatPeriod] = useState("");
  const [pending, startTransition] = useTransition();
  const keyOf = (candidate: AssignCandidate): string => `${candidate.invoiceId}:${candidate.part}`;

  function load(q: string, preselect: boolean): void {
    setError(null);
    startTransition(async () => {
      const result = await assignCandidatesAction({ lineId: line.id, q });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCandidates(result.data);
      if (preselect) {
        const exact = result.data.find((candidate) => candidate.exact);
        setSelected(exact ? new Set([keyOf(exact)]) : new Set());
      }
    });
  }

  /** Mois proposés pour un règlement CAAT : les 24 derniers mois jusqu'à celui de la ligne, le mois précédant le paiement étant présélectionné. */
  const caatPeriods = (() => {
    const base = new Date(`${String(line.date).slice(0, 10)}T12:00:00Z`);
    const list: string[] = [];
    for (let back = -1; back < 24; back += 1) {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - back, 1));
      list.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    return list;
  })();
  const caatLabel = (period: string): string => `${MONTHS_FR[Number(period.slice(5, 7)) - 1] ?? ""} ${period.slice(0, 4)}`;

  function confirmCaat(): void {
    const period = caatPeriod || caatPeriods[1] || "";
    startTransition(async () => {
      const result = await assignCaatAction({ lineId: line.id, succursale: caatBranch, period });
      if (result.success) setDialog(null);
      else setError(result.error);
    });
  }

  function openAssign(): void {
    setDialog("assign");
    setSelected(new Set());
    setCandidates(null);
    setSearch("");
    load("", true);
  }

  function runSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    load(search, false);
  }

  function confirmAssign(): void {
    if (!candidates) return;
    const items = candidates.filter((candidate) => selected.has(keyOf(candidate))).map((candidate) => ({ invoiceId: candidate.invoiceId, part: candidate.part, paid: candidate.paid }));
    startTransition(async () => {
      const result = await assignLineAction({ lineId: line.id, items });
      if (result.success) setDialog(null);
      else setError(result.error);
    });
  }

  function submitCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createInvoiceFromLineAction({
        lineId: line.id,
        categorie: String(form.get("categorie") ?? ""),
        tiers: String(form.get("tiers") ?? ""),
        numero: String(form.get("numero") ?? ""),
        libelle: String(form.get("libelle") ?? ""),
        nature: String(form.get("nature") ?? ""),
      });
      if (result.success) setDialog(null);
      else setError(result.error);
    });
  }

  function simple(action: (id: string) => Promise<{ success: boolean; error?: string }>): void {
    setError(null);
    startTransition(async () => {
      const result = await action(line.id);
      if (!result.success) setError(result.error ?? "Action impossible.");
    });
  }

  const selectedTotal = round2((candidates ?? []).filter((candidate) => selected.has(keyOf(candidate))).reduce((sum, candidate) => sum + candidate.amount, 0));
  const gap = round2(line.montant - selectedTotal);

  if (line.status !== "A_TRAITER") {
    return line.status === "IGNORE" ? (
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => simple(reopenLineAction)}>
        <Undo2 />
        Remettre à traiter
      </Button>
    ) : (
      <span />
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button type="button" size="sm" variant="outline" onClick={openAssign} disabled={pending}>
        <Link2 />
        Affecter
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setError(null);
          setDialog("create");
        }}
      >
        <FilePlus2 />
        Ajouter au suivi
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => simple(ignoreLineAction)}>
        <EyeOff />
        Ignorer
      </Button>
      {error && dialog === null ? (
        <p role="alert" className="w-full text-right text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={dialog === "assign"} onOpenChange={(open) => setDialog(open ? "assign" : null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Affecter ce paiement</DialogTitle>
            <DialogDescription>
              {formatDate(line.date)} · {formatDA(line.montant)} · {line.libelle}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={runSearch} className="flex gap-2" role="search">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Chercher : montant, succursale, nom ou n° de facture…"
              aria-label="Chercher une facture à affecter"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              Chercher
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">La recherche porte sur les factures en attente et sur celles déjà réglées.</p>
          {line.sens === "CREDIT" ? (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">Règlement CAAT : choisir la succursale et le mois concerné</p>
              <div className="flex flex-wrap items-end gap-2">
                <NativeSelect value={caatBranch} onChange={(event) => setCaatBranch(event.target.value)} aria-label="Succursale CAAT">
                  {CAAT_SUCCURSALES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect value={caatPeriod || caatPeriods[1] || ""} onChange={(event) => setCaatPeriod(event.target.value)} aria-label="Mois concerné">
                  {caatPeriods.map((value) => (
                    <option key={value} value={value}>
                      {caatLabel(value)}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="button" variant="outline" disabled={pending} onClick={confirmCaat}>
                  Affecter à cette avance CAAT
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Si la ligne d'avance de ce mois n'existe pas encore, elle est créée, puis réglée avec ce paiement.</p>
            </div>
          ) : null}
          {candidates === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{error ?? "Recherche des factures en attente…"}</p>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucune facture trouvée. Modifiez la recherche ou utilisez « Ajouter au suivi ».</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {candidates.map((candidate) => {
                const key = keyOf(candidate);
                return (
                  <li key={key}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={selected.has(key)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {candidate.label}
                        {candidate.paid ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">déjà réglée</span> : null}
                      </span>
                      <span className={candidate.exact ? "font-semibold text-success tabular-nums" : "tabular-nums"}>{formatDA(candidate.amount)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-sm">
            Sélection : <b className="tabular-nums">{formatDA(selectedTotal)}</b>
            {selected.size && Math.abs(gap) > 0.5 ? (
              <span className="text-muted-foreground"> · écart {formatDA(gap)}{gap < 0 ? " (la dernière facture sera réglée en partie)" : ""}</span>
            ) : null}
          </p>
          {error && candidates !== null ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              Annuler
            </Button>
            <Button type="button" onClick={confirmAssign} disabled={pending || selected.size === 0}>
              {candidates?.some((candidate) => selected.has(keyOf(candidate)) && !candidate.paid) ? "Affecter et marquer réglé" : "Relier à ces factures déjà réglées"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "create"} onOpenChange={(open) => setDialog(open ? "create" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter ce paiement au suivi</DialogTitle>
            <DialogDescription>
              {line.sens === "CREDIT" ? "Encaissement" : "Décaissement"} du {formatDate(line.date)} · {formatDA(line.montant)} — enregistré « réglé » à cette date.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id={`c-cat-${line.id}`} label="Catégorie">
              <Input id={`c-cat-${line.id}`} name="categorie" list={`c-cats-${line.id}`} required />
            </Field>
            <datalist id={`c-cats-${line.id}`}>
              {categories.map((categorie) => (
                <option key={categorie} value={categorie} />
              ))}
            </datalist>
            <Field id={`c-tiers-${line.id}`} label="Tiers">
              <Input id={`c-tiers-${line.id}`} name="tiers" required />
            </Field>
            <Field id={`c-num-${line.id}`} label="N° de facture (facultatif)">
              <Input id={`c-num-${line.id}`} name="numero" />
            </Field>
            <Field id={`c-nat-${line.id}`} label="Nature">
              <Input id={`c-nat-${line.id}`} name="nature" defaultValue={line.sens === "DEBIT" ? "Charge" : "Production Assistance"} />
            </Field>
            <Field id={`c-lib-${line.id}`} label="Libellé" className="sm:col-span-2">
              <Input id={`c-lib-${line.id}`} name="libelle" defaultValue={line.libelle} />
            </Field>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive sm:col-span-2">
                {error}
              </p>
            ) : null}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
