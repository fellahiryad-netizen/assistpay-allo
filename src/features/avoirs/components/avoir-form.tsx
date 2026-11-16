"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAvoirAction } from "@/app/actions/avoir-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { avoirAmounts } from "@/features/avoirs/lib/avoir-calc";
import { AVOIR_MOTIFS, AVOIR_MOTIF_LABELS } from "@/features/avoirs/schemas";
import type { AvoirableInvoiceDTO } from "@/features/avoirs/types";
import { formatDA, formatDate } from "@/utils/format";

type Motif = (typeof AVOIR_MOTIFS)[number];

/** Nouvel avoir en trois étapes : compagnie, facture à corriger, motif et montant. */
export function AvoirForm({ clients, invoices }: Readonly<{ clients: Array<{ code: string; label: string }>; invoices: AvoirableInvoiceDTO[] }>): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [client, setClient] = useState("");
  const [originId, setOriginId] = useState("");
  const [mode, setMode] = useState<"total" | "partiel">("total");
  const [ttc, setTtc] = useState("");
  const [categorie, setCategorie] = useState<Motif>("erreur_montant");
  const [motif, setMotif] = useState("");
  const [suite, setSuite] = useState<"aucune" | "remboursement" | "imputation">("aucune");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; num: string } | null>(null);

  const available = useMemo(() => invoices.filter((invoice) => invoice.client === client && invoice.reste > 0.005), [invoices, client]);
  const origin = invoices.find((invoice) => invoice.id === originId);
  const clientCount = (code: string): number => invoices.filter((invoice) => invoice.client === code && invoice.reste > 0.005).length;
  const typed = Number(ttc.replace(/\s/g, "").replace(",", "."));
  const preview = origin && mode === "partiel" && Number.isFinite(typed) && typed > 0 ? avoirAmounts({ ht: 0, tva: 0, ttc: origin.ttc }, "partiel", typed) : null;

  function submit(): void {
    setError("");
    if (!origin) return setError("Choisissez la facture à corriger.");
    startTransition(async () => {
      const result = await createAvoirAction({
        origineId: origin.id,
        mode,
        ttc: mode === "partiel" ? typed : undefined,
        categorie,
        motif,
        suite,
        date: date || undefined,
      });
      if (!result.success) return setError(result.error);
      setDone(result.data);
      setOriginId("");
      setTtc("");
      setMotif("");
      router.refresh();
    });
  }

  return (
    <section className="mb-6 rounded-lg border bg-card p-4" aria-label="Nouvel avoir">
      <h2 className="mb-3 text-base font-semibold">Nouvel avoir</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="avoir-client" label="1. Compagnie">
          <NativeSelect id="avoir-client" value={client} onChange={(event) => { setClient(event.target.value); setOriginId(""); setDone(null); }}>
            <option value="">Choisir…</option>
            {clients.map((item) => (
              <option key={item.code} value={item.code} disabled={clientCount(item.code) === 0}>
                {item.label} ({clientCount(item.code)} facture(s))
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="avoir-facture" label="2. Facture à corriger" hint={origin ? `Reste avoirable : ${formatDA(origin.reste)}${origin.statut === "REGLE" ? " · facture encaissée" : origin.statut === "EN_ATTENTE" ? " · non encaissée" : ""}` : undefined}>
          <NativeSelect id="avoir-facture" value={originId} disabled={!client} onChange={(event) => { setOriginId(event.target.value); setDone(null); }}>
            <option value="">{client ? "Choisir la facture…" : "Choisissez d'abord la compagnie"}</option>
            {available.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {[invoice.num, invoice.num2].filter(Boolean).join(" / ")} · {formatDate(invoice.date)}
                {invoice.succ ? ` · ${invoice.succ}` : ""} · {formatDA(invoice.ttc)}
                {invoice.statut === "REGLE" ? " · encaissée" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {origin ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field id="avoir-mode" label="3. Avoir">
            <NativeSelect id="avoir-mode" value={mode} onChange={(event) => setMode(event.target.value === "partiel" ? "partiel" : "total")}>
              <option value="total">Total (annule le reste de la facture : {formatDA(origin.reste)})</option>
              <option value="partiel">Partiel (je saisis le montant TTC)</option>
            </NativeSelect>
          </Field>
          {mode === "partiel" ? (
            <Field id="avoir-ttc" label="Montant TTC de l'avoir (DA)" hint={preview ? `HT ${formatDA(preview.ht)} + TVA ${formatDA(preview.tva)}, répartis comme sur la facture d'origine` : "La TVA suit la répartition de la facture d'origine."}>
              <Input id="avoir-ttc" inputMode="decimal" value={ttc} onChange={(event) => setTtc(event.target.value)} placeholder="0,00" />
            </Field>
          ) : null}
          <Field id="avoir-categorie" label="Motif">
            <NativeSelect id="avoir-categorie" value={categorie} onChange={(event) => setCategorie(event.target.value as Motif)}>
              {AVOIR_MOTIFS.map((key) => (
                <option key={key} value={key}>
                  {AVOIR_MOTIF_LABELS[key]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="avoir-motif" label="Précision (imprimée sur l'avoir)">
            <Input id="avoir-motif" value={motif} maxLength={300} onChange={(event) => setMotif(event.target.value)} placeholder="Ex. : production d'octobre mal ventilée" />
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
        <Button type="button" disabled={pending || !origin} onClick={submit}>
          {pending ? "Enregistrement…" : "Établir l'avoir"}
        </Button>
      </div>
    </section>
  );
}
