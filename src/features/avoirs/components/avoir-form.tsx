"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAvoirAction } from "@/app/actions/avoir-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { avoirAmounts, manualAvoirAmounts, remainingAvoirable } from "@/features/avoirs/lib/avoir-calc";
import { filterAvoirable } from "@/features/avoirs/lib/avoir-filter";
import { AVOIR_MOTIFS, AVOIR_MOTIF_LABELS } from "@/features/avoirs/schemas";
import type { AvoirableInvoiceDTO } from "@/features/avoirs/types";
import { parseLooseAmount } from "@/utils/amounts";
import { formatDA, formatDate } from "@/utils/format";

type Motif = (typeof AVOIR_MOTIFS)[number];
type Mode = "total" | "partiel" | "manuel";
type Saisie = "ht" | "ttc";

/** Propriétés du formulaire de nouvel avoir. */
export interface AvoirFormProps {
  clients: Array<{ code: string; label: string }>;
  invoices: AvoirableInvoiceDTO[];
  /** Facture d'origine présélectionnée (lien depuis la fiche d'une facture). */
  initialOriginId?: string;
}

/** Nouvel avoir : choix explicite de la facture d'origine (recherche), montant libre HT ou TTC, motif obligatoire. */
export function AvoirForm({ clients, invoices, initialOriginId = "" }: Readonly<AvoirFormProps>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [client, setClient] = useState("");
  const [query, setQuery] = useState("");
  const [originId, setOriginId] = useState(invoices.some((invoice) => invoice.id === initialOriginId) ? initialOriginId : "");
  const [mode, setMode] = useState<Mode>("manuel");
  const [saisie, setSaisie] = useState<Saisie>("ht");
  const [montant, setMontant] = useState("");
  const [categorie, setCategorie] = useState<Motif>("erreur_montant");
  const [motif, setMotif] = useState("");
  const [suite, setSuite] = useState<"aucune" | "remboursement" | "imputation">("aucune");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; num: string } | null>(null);

  const origin = invoices.find((invoice) => invoice.id === originId);
  const matches = useMemo(() => filterAvoirable(invoices, client, query), [invoices, client, query]);
  const shown = matches.slice(0, 50);
  const typed = parseLooseAmount(montant);
  const hasAmount = Number.isFinite(typed) && typed > 0;

  const amounts = useMemo(() => {
    if (!origin) return null;
    if (mode === "total") return { ...(origin.avoirs > 0 ? avoirAmounts(origin, "partiel", origin.reste) : avoirAmounts(origin, "total")), ecartArrondi: 0, coherent: true };
    if (!hasAmount) return null;
    if (mode === "partiel") return { ...avoirAmounts(origin, "partiel", typed), ecartArrondi: 0, coherent: true };
    return manualAvoirAmounts(saisie, typed);
  }, [origin, mode, saisie, typed, hasAmount]);

  const wanted = origin && mode === "total" ? origin.reste : (amounts?.ttc ?? 0);
  const exceeds = Boolean(origin && amounts && wanted > origin.reste + 0.005);
  const apres = origin && amounts && !exceeds ? remainingAvoirable(origin.ttc, [origin.avoirs, wanted]) : null;
  const motifOk = motif.trim().length >= 3;
  const canSubmit = Boolean(origin) && motifOk && !exceeds && (mode === "total" || Boolean(amounts)) && !pending;

  function submit(): void {
    setError("");
    if (!origin) return setError("Choisissez la facture d'origine dans la liste.");
    if (!motifOk) return setError("Le motif est obligatoire (3 caractères au moins).");
    if (exceeds) return setError(`Le montant dépasse le reste avoirable (${formatDA(origin.reste)}).`);
    startTransition(async () => {
      const result = await createAvoirAction({
        origineId: origin.id,
        mode,
        ttc: mode === "partiel" ? typed : undefined,
        saisie: mode === "manuel" ? saisie : undefined,
        montant: mode === "manuel" ? typed : undefined,
        categorie,
        motif,
        suite,
        date: date || undefined,
      });
      if (!result.success) return setError(result.error);
      setDone(result.data);
      setOriginId("");
      setMontant("");
      setMotif("");
      router.refresh();
    });
  }

  return (
    <section className="mb-6 rounded-lg border bg-card p-4" aria-label="Nouvel avoir">
      <h2 className="mb-3 text-base font-semibold">Nouvel avoir</h2>
      <p className="mb-2 text-sm font-medium">1. Facture d&apos;origine (celle à laquelle l&apos;avoir sera rattaché)</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="avoir-client" label="Compagnie (filtre)">
          <NativeSelect id="avoir-client" value={client} onChange={(event) => setClient(event.target.value)}>
            <option value="">Toutes les compagnies</option>
            {clients.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="avoir-recherche" label="Rechercher" hint="Par n° de facture, compagnie, succursale, période ou montant TTC.">
          <Input id="avoir-recherche" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. : CAAT 26-000142, Oran, 1 190 000" />
        </Field>
      </div>
      <div role="radiogroup" aria-label="Facture d'origine" className="mt-3 max-h-64 overflow-y-auto rounded-md border">
        {shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Aucune facture ne correspond (ou elles sont toutes déjà couvertes par des avoirs).</p>
        ) : (
          shown.map((invoice) => (
            <label key={invoice.id} className={`flex cursor-pointer items-start gap-3 border-b p-2 text-sm last:border-b-0 ${invoice.id === originId ? "bg-muted font-medium" : ""}`}>
              <input type="radio" name="avoir-origine" className="mt-1" checked={invoice.id === originId} onChange={() => { setOriginId(invoice.id); setDone(null); setError(""); }} />
              <span className="min-w-0 flex-1">
                <span className="block">
                  {[invoice.num, invoice.num2].filter(Boolean).join(" / ")} · {invoice.clientLabel} · {formatDate(invoice.date)}
                  {invoice.succ ? ` · ${invoice.succ}` : ""}
                </span>
                <span className="block text-xs text-muted-foreground">
                  TTC {formatDA(invoice.ttc)}
                  {invoice.avoirs > 0 ? ` · avoirs déjà établis ${formatDA(invoice.avoirs)}` : ""} · reste avoirable {formatDA(invoice.reste)}
                  {invoice.statut === "REGLE" ? " · encaissée" : invoice.statut === "EN_ATTENTE" ? " · non encaissée" : ""}
                </span>
              </span>
            </label>
          ))
        )}
      </div>
      {matches.length > shown.length ? <p className="mt-1 text-xs text-muted-foreground">{matches.length - shown.length} autre(s) facture(s) : affinez la recherche.</p> : null}
      {origin ? (
        <p className="mt-2 text-sm" role="status">
          Avoir rattaché à la facture <strong>{[origin.num, origin.num2].filter(Boolean).join(" / ")}</strong> ({origin.clientLabel}) : TTC {formatDA(origin.ttc)}, reste avoirable {formatDA(origin.reste)}.
        </p>
      ) : null}
      {origin ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field id="avoir-mode" label="2. Montant de l'avoir">
            <NativeSelect id="avoir-mode" value={mode} onChange={(event) => setMode(event.target.value === "total" ? "total" : event.target.value === "partiel" ? "partiel" : "manuel")}>
              <option value="manuel">Montant libre (je saisis HT ou TTC)</option>
              <option value="partiel">Partiel : TTC réparti comme sur la facture d&apos;origine</option>
              <option value="total">Total : tout le reste de la facture ({formatDA(origin.reste)})</option>
            </NativeSelect>
          </Field>
          {mode === "manuel" ? (
            <Field id="avoir-saisie" label="Je saisis le montant en">
              <NativeSelect id="avoir-saisie" value={saisie} onChange={(event) => setSaisie(event.target.value === "ttc" ? "ttc" : "ht")}>
                <option value="ht">HT (TVA 19 % calculée)</option>
                <option value="ttc">TTC (HT et TVA déduits)</option>
              </NativeSelect>
            </Field>
          ) : null}
          {mode !== "total" ? (
            <Field
              id="avoir-montant"
              label={mode === "partiel" ? "Montant TTC de l'avoir (DA)" : `Montant ${saisie === "ht" ? "HT" : "TTC"} de l'avoir (DA)`}
              error={exceeds && origin ? `Dépasse le reste avoirable (${formatDA(origin.reste)}).` : undefined}
            >
              <Input id="avoir-montant" inputMode="decimal" value={montant} onChange={(event) => setMontant(event.target.value)} placeholder="0,00" />
            </Field>
          ) : null}
          {amounts ? (
            <div className="rounded-md border p-3 text-sm md:col-span-2" role="status" aria-live="polite">
              <p>
                HT <strong>{formatDA(amounts.ht)}</strong> + TVA <strong>{formatDA(amounts.tva)}</strong> = TTC <strong>{formatDA(amounts.ttc)}</strong>
                {apres !== null ? ` · reste avoirable après cet avoir : ${formatDA(apres)}` : ""}
              </p>
              {mode === "manuel" && saisie === "ttc" ? (
                <p className={amounts.coherent && amounts.ecartArrondi === 0 ? "text-xs text-muted-foreground" : "text-xs font-medium"}>
                  Contrôle d&apos;arrondi : {amounts.coherent ? (amounts.ecartArrondi === 0 ? "HT × 19 % = TVA, aucun écart." : `écart de ${formatDA(amounts.ecartArrondi)} entre la TVA et HT × 19 %, absorbé par la TVA (le TTC saisi est conservé).`) : "incohérence, vérifiez le montant."}
                </p>
              ) : null}
            </div>
          ) : null}
          <Field id="avoir-categorie" label="3. Catégorie du motif">
            <NativeSelect id="avoir-categorie" value={categorie} onChange={(event) => setCategorie(event.target.value as Motif)}>
              {AVOIR_MOTIFS.map((key) => (
                <option key={key} value={key}>
                  {AVOIR_MOTIF_LABELS[key]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="avoir-motif" label="Motif (obligatoire, imprimé sur l'avoir)">
            <Input id="avoir-motif" required value={motif} maxLength={300} onChange={(event) => setMotif(event.target.value)} placeholder="Ex. : production d'octobre mal ventilée" />
          </Field>
          <Field id="avoir-suite" label="Que devient la somme ?" hint={origin.statut === "REGLE" ? "La facture est encaissée : choisissez remboursement ou imputation." : undefined}>
            <NativeSelect id="avoir-suite" value={suite} onChange={(event) => setSuite(event.target.value as typeof suite)}>
              <option value="aucune">Rien de précisé</option>
              <option value="remboursement">Remboursement au client</option>
              <option value="imputation">Imputation sur la prochaine facture</option>
            </NativeSelect>
          </Field>
          <Field id="avoir-date" label="Date de l'avoir" hint="Aujourd'hui par défaut.">
            <Input id="avoir-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-3 text-sm">
          Avoir <strong>{done.num}</strong> enregistré.{" "}
          <Link href={`/imprimer/avoirs?id=${done.id}`} target="_blank" className="font-medium underline">
            Ouvrir pour imprimer
          </Link>
        </p>
      ) : null}
      <div className="mt-4">
        <Button type="button" disabled={!canSubmit} onClick={submit}>
          {pending ? "Enregistrement…" : "Établir l'avoir"}
        </Button>
      </div>
    </section>
  );
}
