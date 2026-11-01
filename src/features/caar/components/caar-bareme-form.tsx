"use client";

import { useState, useTransition } from "react";
import { saveCaarBaremeAction } from "@/app/actions/caar-actions";
import { Notice } from "@/components/common/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CaarBareme, CaarOptions } from "@/features/caar/services/caar-engine";

/** Produit affiché dans le barème (sérialisable). */
export interface BaremeProduct {
  id: string;
  label: string;
  cg: string;
}

const OPTION_LABELS: ReadonlyArray<[keyof CaarOptions, string]> = [
  ["prorata", "Accepter le prorata temporis (jours ÷ 365)"],
  ["avFull", "Accepter le tarif annuel complet quelle que soit la durée (échéance alignée sur la police, flottes)"],
  ["avAnyCoef", "Accepter un autre palier du barème (1, 3 ou 6 mois)"],
  ["palierAll", "Appliquer ces règles à toutes les lignes, même sans n° d'avenant"],
  ["feeAll", "Accepter les frais fixes d'avenant sur toutes les lignes"],
];
const COEF_LABELS = ["Jusqu'à 1 mois", "Jusqu'à 3 mois", "Jusqu'à 6 mois", "Plus de 6 mois (12 mois)"];
const percent = (value: number): number => Math.round(value * 1000) / 10;

/** Formulaire du barème CAAR : tarifs, coefficients de durée, cas acceptés, taux et frais d'avenant. */
export function CaarBaremeForm({ initial, products, canEdit }: Readonly<{ initial: CaarBareme; products: BaremeProduct[]; canEdit: boolean }>): React.JSX.Element {
  const [prices, setPrices] = useState<Record<string, number>>(initial.prices);
  const [coefs, setCoefs] = useState<number[]>(initial.coefs.map(percent));
  const [rates, setRates] = useState({ allo: percent(initial.rates.allo), av: percent(initial.rates.av), tva: percent(initial.rates.tva) });
  const [options, setOptions] = useState<CaarOptions>(initial.options);
  const [avFee, setAvFee] = useState(initial.avFee);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(next: CaarBareme): void {
    setPrices(next.prices);
    setCoefs(next.coefs.map(percent));
    setRates({ allo: percent(next.rates.allo), av: percent(next.rates.av), tva: percent(next.rates.tva) });
    setOptions(next.options);
    setAvFee(next.avFee);
  }

  function save(reset: boolean): void {
    if (reset && !window.confirm("Rétablir le barème et les taux d'origine ?")) return;
    startTransition(async () => {
      const result = await saveCaarBaremeAction({ prices, coefs, avFee, options, rates, reset });
      if (result.success) {
        apply(result.data);
        setMessage({ tone: "success", text: reset ? "Barème d'origine rétabli." : "Barème enregistré : il s'applique aux prochains contrôles." });
      } else setMessage({ tone: "error", text: result.error });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Le barème sert à contrôler chaque prime : prime attendue = tarif annuel × coefficient de durée (ou prorata jours / 365). Il est commun à tous les utilisateurs
        {canEdit ? "." : " ; seul un administrateur peut le modifier."}
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produit</TableHead>
                <TableHead>Code garantie</TableHead>
                <TableHead className="text-right">Tarif annuel (DA)</TableHead>
                {[2, 1, 0].map((index) => (
                  <TableHead key={index} className="text-right">
                    {["1 mois", "3 mois", "6 mois"][index]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const annual = prices[product.id] ?? 0;
                return (
                  <TableRow key={product.id}>
                    <TableCell>{product.label}</TableCell>
                    <TableCell className="text-muted-foreground">{product.cg || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        value={annual}
                        disabled={!canEdit}
                        aria-label={`Tarif annuel ${product.label}`}
                        className="ml-auto h-8 w-28 text-right"
                        onChange={(event) => setPrices({ ...prices, [product.id]: Number(event.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Math.round(annual * ((coefs[2] ?? 0) / 100))}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.round(annual * ((coefs[1] ?? 0) / 100))}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.round(annual * ((coefs[0] ?? 0) / 100))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Taux de facturation</h3>
            {(
              [
                ["allo", "Part ALLO (assisteur)"],
                ["av", "Avance perçue"],
                ["tva", "TVA"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                {label}
                <span className="flex items-center gap-1">
                  <Input type="number" step={0.5} min={0} max={100} value={rates[key]} disabled={!canEdit} className="h-8 w-20 text-right" onChange={(event) => setRates({ ...rates, [key]: Number(event.target.value) })} /> %
                </span>
              </label>
            ))}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Coefficients de durée</h3>
            {COEF_LABELS.map((label, index) => (
              <label key={label} className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                {label}
                <span className="flex items-center gap-1">
                  <Input
                    type="number"
                    step={1}
                    min={0}
                    max={100}
                    value={coefs[index] ?? 0}
                    disabled={!canEdit}
                    className="h-8 w-20 text-right"
                    onChange={(event) => setCoefs(coefs.map((value, position) => (position === index ? Number(event.target.value) : value)))}
                  />{" "}
                  %
                </span>
              </label>
            ))}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Cas acceptés</h3>
            {OPTION_LABELS.map(([key, label]) => (
              <label key={key} className="mb-1.5 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={options[key]} disabled={!canEdit} onChange={(event) => setOptions({ ...options, [key]: event.target.checked })} />
                {label}
              </label>
            ))}
          </section>
          <label className="flex items-center justify-between gap-2 text-sm">
            Frais fixe d&apos;avenant (changement d&apos;immatriculation…)
            <span className="flex items-center gap-1">
              <Input type="number" min={0} step={1} value={avFee} disabled={!canEdit} className="h-8 w-20 text-right" onChange={(event) => setAvFee(Number(event.target.value))} /> DA
            </span>
          </label>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => save(false)}>
                {pending ? "Enregistrement…" : "Enregistrer le barème"}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => save(true)}>
                Rétablir le barème d&apos;origine
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
