"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { filterBranches } from "@/features/courrier/lib/address-book";
import { COURRIER_COMPANIES, type BranchAddress, type CourrierCompany } from "@/features/courrier/types";
import { cn } from "@/utils/cn";

/** Propriétés de la fenêtre de choix des succursales du bordereau. */
export interface BordereauPickerDialogProps {
  open: boolean;
  branches: BranchAddress[];
  /** Dernier envoi par fiche (`AAAA-MM-JJ`), pour repérer ce qui n'a pas été envoyé depuis longtemps. */
  lastSent: Record<string, string>;
  onClose: () => void;
}

/** Fenêtre de sélection des succursales présentes pour établir un bordereau d'envoi (recherche, filtre par compagnie, tout cocher / décocher, compteur). */
export function BordereauPickerDialog({ open, branches, lastSent, onClose }: Readonly<BordereauPickerDialogProps>): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">{open ? <PickerBody branches={branches} lastSent={lastSent} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

function PickerBody({ branches, lastSent, onClose }: Readonly<Omit<BordereauPickerDialogProps, "open">>): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<CourrierCompany | "">("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const sorted = useMemo(() => [...branches].sort((a, b) => a.compagnie.localeCompare(b.compagnie) || a.nom.localeCompare(b.nom, "fr", { numeric: true })), [branches]);
  const visible = useMemo(() => filterBranches(sorted, company, query), [sorted, company, query]);
  const count = selected.size;
  // L'ordre des lignes du bordereau est celui de la liste, pas celui des clics.
  const ids = sorted.filter((item) => selected.has(item.id)).map((item) => item.id);
  const allVisible = visible.length > 0 && visible.every((item) => selected.has(item.id));

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const checkAll = (): void => setSelected((current) => new Set([...current, ...visible.map((item) => item.id)]));
  const uncheckAll = (): void => setSelected((current) => new Set([...current].filter((id) => !visible.some((item) => item.id === id))));
  const href = `/adresses-courrier/bordereau?ids=${ids.map(encodeURIComponent).join(",")}`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Établir un bordereau d&apos;envoi</DialogTitle>
        <DialogDescription>Cochez les succursales auxquelles vous envoyez du courrier aujourd&apos;hui. Vous pourrez ensuite ajuster les lignes avant d&apos;enregistrer.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une succursale" aria-label="Rechercher une succursale" className="pl-9" />
        </div>
        <div className="sm:w-48">
          <NativeSelect value={company} onChange={(event) => setCompany(event.target.value === "CAAR" ? "CAAR" : event.target.value === "CAAT" ? "CAAT" : "")} aria-label="Filtrer par compagnie">
            <option value="">Toutes les compagnies</option>
            {COURRIER_COMPANIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={checkAll} disabled={visible.length === 0 || allVisible}>
          Tout cocher
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={uncheckAll} disabled={!visible.some((item) => selected.has(item.id))}>
          Tout décocher
        </Button>
        <p className="text-sm font-medium" aria-live="polite">
          {count} {count > 1 ? "succursales sélectionnées" : "succursale sélectionnée"}
        </p>
      </div>
      <ul className="max-h-[45vh] overflow-y-auto rounded-md border" aria-label="Succursales">
        {visible.length === 0 ? <li className="p-4 text-sm text-muted-foreground">Aucune succursale ne correspond.</li> : null}
        {visible.map((item) => (
          <li key={item.id} className="border-b last:border-b-0">
            <label className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/50">
              <Checkbox checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="mt-1" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.nom}</span>
                <span className="block text-xs text-muted-foreground">{item.adresse}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{lastSent[item.id] ? `Dernier envoi : ${lastSent[item.id]?.split("-").reverse().join("/")}` : "Jamais envoyé"}</span>
            </label>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuler
        </Button>
        {count > 0 ? (
          <Link href={href} className={buttonVariants()}>
            <FileText />
            Établir le bordereau
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(buttonVariants(), "pointer-events-none opacity-50")}>
            <FileText />
            Établir le bordereau
          </span>
        )}
      </DialogFooter>
    </>
  );
}
