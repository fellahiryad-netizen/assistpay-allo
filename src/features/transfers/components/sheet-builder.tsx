"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Download, Search } from "lucide-react";
import { computeSheetAction, generateSheetAction } from "@/app/actions/transfer-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DONOR, TRANSFER_PRODUCTS, ribValid, type TransferProduct } from "@/features/transfers/services/rib";
import type { SheetInput } from "@/features/transfers/schemas";
import type { SheetLine, SheetRequest } from "@/features/transfers/types";
import { cn } from "@/utils/cn";
import { formatDA, formatDate } from "@/utils/format";
import { upperPlain } from "@/utils/text";

/** Propriétés de l'état des virements. */
export interface SheetBuilderProps {
  requests: SheetRequest[];
  others: number;
  scoped: boolean;
  canEdit: boolean;
}

type Overrides = SheetInput["overrides"];

const PROBLEMS: Readonly<Record<Exclude<SheetLine["problem"], "">, string>> = {
  rib: "RIB manquant : saisissez-le",
  cle: "Clé RIB incorrecte",
  adr: "Adresse (wilaya) à renseigner",
  nom: "Nom à renseigner",
  choix: "Plusieurs comptes connus : choisissez",
};

/**
 * État des virements à envoyer à la banque : un fichier par produit (assistance routière / BDG),
 * un virement par prestataire, découpé au-delà de 1 000 000 DA ; RIB manquants ou changés signalés.
 */
export function SheetBuilder({ requests, others, scoped, canEdit }: Readonly<SheetBuilderProps>): React.JSX.Element {
  const router = useRouter();
  const initialProduct: TransferProduct = requests.some((request) => request.selected && request.product === "A") || !requests.some((request) => request.selected) ? "A" : "B";
  const [product, setProduct] = useState<TransferProduct>(initialProduct);
  const [selected, setSelected] = useState<Set<string>>(new Set(requests.filter((request) => request.selected).map((request) => request.id)));
  const [grouped, setGrouped] = useState(true);
  const [showOld, setShowOld] = useState(false);
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Overrides>({});
  const [result, setResult] = useState<{ lines: SheetLine[]; total: number; transfers: number; problems: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const needle = upperPlain(search);
    return requests
      .filter((request) => request.product === product)
      .filter((request) => scoped || showOld || (!request.old && !request.alreadySent) || selected.has(request.id))
      .filter((request) => !needle || upperPlain(`${request.beneficiaire} ${request.ref} ${request.pieces.join(" ")}`).includes(needle))
      .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || b.ref.localeCompare(a.ref));
  }, [requests, product, scoped, showOld, selected, search]);

  const selectedIds = useMemo(() => requests.filter((request) => request.product === product && selected.has(request.id)).map((request) => request.id), [requests, product, selected]);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setResult({ lines: [], total: 0, transfers: 0, problems: 0 });
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const response = await computeSheetAction({ product, requestIds: selectedIds, grouped, overrides });
        if (response.success) setResult(response.data);
        else setError(response.error);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [product, selectedIds, grouped, overrides]);

  function override(key: string, patch: Overrides[string]): void {
    setOverrides((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function generate(): void {
    setError(null);
    startTransition(async () => {
      const response = await generateSheetAction({ product, requestIds: selectedIds, grouped, overrides });
      if (!response.success) {
        setError(response.error);
        return;
      }
      window.location.href = `/api/virements/${response.data.batchId}/fichier`;
      router.push(`/virements/${response.data.batchId}?genere=1`);
    });
  }

  const countFor = (code: TransferProduct): number => requests.filter((request) => request.product === code && selected.has(request.id)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["A", "B"] as const).map((code) => (
          <Button key={code} type="button" variant={product === code ? "default" : "outline"} onClick={() => setProduct(code)}>
            {TRANSFER_PRODUCTS[code].label} <Badge variant={product === code ? "muted" : "default"}>{countFor(code)}</Badge>
          </Button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Checkbox checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
          Un virement par prestataire (cumul de ses demandes)
        </label>
        {!scoped ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showOld} onChange={(event) => setShowOld(event.target.checked)} />
            Afficher les demandes anciennes et déjà envoyées
          </label>
        ) : null}
      </div>
      <Notice tone="info">
        {scoped
          ? `Fiche limitée aux ${requests.length} demande(s) choisie(s)${others ? ` · ${others} autre(s) non concernée(s) (chèque, produit Autre ou Tiers payant)` : ""}.`
          : "Cochez les demandes à virer. Un fichier par produit, au format de la banque : compte AGB d'ALLO en débit, puis un crédit par prestataire ; jamais plus de 1 000 000 DA par virement."}
      </Notice>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>1. Demandes de paiement à virer ({TRANSFER_PRODUCTS[product].label})</CardTitle>
          <div className="relative sm:w-80">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Prestataire, n° de demande…" className="pl-9" aria-label="Rechercher une demande" />
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucune demande de paiement par virement pour ce produit.</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {visible.map((request) => (
                <li key={request.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                    <Checkbox
                      checked={selected.has(request.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(request.id);
                          else next.delete(request.id);
                          return next;
                        })
                      }
                    />
                    <span className="w-28 shrink-0 font-medium">{request.ref}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{request.beneficiaire}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatDate(request.date)} · {request.pieces.join(" ; ")}
                      </span>
                    </span>
                    {request.alreadySent ? <Badge variant="warning">déjà dans {request.alreadySent}</Badge> : request.old ? <Badge variant="muted">ancienne</Badge> : null}
                    <b className="tabular-nums">{formatDA(request.montant)}</b>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            2. Virements : {result?.transfers ?? 0} virement(s) · {formatDA(result?.total ?? 0)}
          </CardTitle>
          <CardDescription>
            Débit AGB {DONOR.banque} {DONOR.agence} {DONOR.compte} {DONOR.cle} (EURL ALLO ASSISTANCE).
            {pending ? " Calcul en cours…" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {result?.problems ? <Notice tone="warning">À signaler avant l&apos;envoi : {result.problems} ligne(s) incomplète(s), en rouge ci-dessous.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {result && result.lines.length ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Prestataire</th>
                    <th className="px-2 py-2 text-left">RIB (20 chiffres)</th>
                    <th className="px-2 py-2 text-left">Nom</th>
                    <th className="px-2 py-2 text-left">Prénom</th>
                    <th className="px-2 py-2 text-left">Adresse</th>
                    <th className="px-2 py-2 text-right">Montant</th>
                    <th className="px-2 py-2 text-left">Virements</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((line) => (
                    <tr key={line.key} className={cn("border-t align-top", line.problem && "bg-destructive/5")}>
                      <td className="px-2 py-2">
                        <b>{line.beneficiaire}</b>
                        <span className="block text-xs text-muted-foreground">{line.requestRefs.join(", ")}</span>
                      </td>
                      <td className="px-2 py-2">
                        {line.candidates.length > 1 ? (
                          <NativeSelect
                            aria-label={`Compte de ${line.beneficiaire}`}
                            className="mb-1 h-8 text-xs"
                            value={overrides[line.key]?.accountId ?? line.accountId ?? ""}
                            onChange={(event) => override(line.key, { accountId: event.target.value || undefined, rib: undefined })}
                          >
                            <option value="">Choisir le compte…</option>
                            {line.candidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.label}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : null}
                        <Input
                          aria-label={`RIB de ${line.beneficiaire}`}
                          className="h-8 font-mono text-xs"
                          inputMode="numeric"
                          maxLength={24}
                          defaultValue={line.rib}
                          placeholder={line.rib ? "" : "RIB introuvable : saisissez-le"}
                          onBlur={(event) => {
                            const value = event.target.value.replace(/\D/g, "");
                            if (value !== line.rib) override(line.key, { rib: value });
                          }}
                        />
                        <span className={cn("mt-1 block text-xs", line.problem ? "font-medium text-destructive" : "text-success")}>
                          {line.problem ? PROBLEMS[line.problem] : line.note}
                          {line.rib && !ribValid(line.rib) && line.problem !== "cle" ? " (clé à vérifier)" : ""}
                        </span>
                      </td>
                      {(["nom", "prenom", "adresse"] as const).map((field) => (
                        <td key={field} className="px-2 py-2">
                          <Input
                            aria-label={`${field} de ${line.beneficiaire}`}
                            className="h-8 text-xs uppercase"
                            defaultValue={line[field]}
                            onBlur={(event) => {
                              const value = event.target.value.trim().toUpperCase();
                              if (value === line[field]) return;
                              override(line.key, field === "adresse" ? { adresse: value } : { nom: field === "nom" ? value : line.nom, prenom: field === "prenom" ? value : line.prenom });
                            }}
                          />
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums">{formatDA(line.montant)}</td>
                      <td className="px-2 py-2 text-xs">{line.parts.length > 1 ? `${line.parts.length} × ${line.parts.map((part) => formatDA(part)).join(" + ")}` : "1"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">Cochez des demandes pour préparer les virements.</p>
          )}
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="button" onClick={generate} disabled={pending || !result?.lines.length || Boolean(result?.problems)}>
                <Download />
                Générer {TRANSFER_PRODUCTS[product].file} (Excel banque)
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
