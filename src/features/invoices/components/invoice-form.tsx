"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SensChoice } from "@/features/invoices/components/sens-choice";
import { initialInvoiceValues, useInvoiceForm, type InvoiceFormValues } from "@/features/invoices/hooks/use-invoice-form";
import {
  INVOICE_STATUS_KEYS,
  MODE_LABELS,
  PAYMENT_MODE_KEYS,
  STATUS_LABELS,
  type InvoiceDTO,
  type InvoiceStatusKey,
  type PaymentModeKey,
  type SensKey,
} from "@/features/invoices/types";

/** Propriétés du formulaire de facture. */
export interface InvoiceFormProps {
  invoice: InvoiceDTO | null;
  defaultSens: SensKey | null;
  allowedSens: SensKey[];
  categories: string[];
  today: string;
  cancelHref: string;
}

function isStatus(value: string): value is InvoiceStatusKey {
  return (INVOICE_STATUS_KEYS as readonly string[]).includes(value);
}

type TextKey = Exclude<keyof InvoiceFormValues, "sens" | "status" | "mode">;

function isMode(value: string): value is PaymentModeKey | "" {
  return value === "" || (PAYMENT_MODE_KEYS as readonly string[]).includes(value);
}

/** Formulaire d'ajout ou de modification d'une facture client / fournisseur. */
export function InvoiceForm({ invoice, defaultSens, allowedSens, categories, today, cancelHref }: Readonly<InvoiceFormProps>): React.JSX.Element {
  const { values, errors, pending, setValue, submit } = useInvoiceForm(initialInvoiceValues(invoice, defaultSens, today), invoice?.id ?? null);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit();
  }

  const text = (key: TextKey, label: string, props: { placeholder?: string; list?: string; inputMode?: "decimal"; type?: string } = {}): React.JSX.Element => (
    <Field id={`f-${key}`} label={label} error={errors[key]}>
      <Input
        id={`f-${key}`}
        value={values[key]}
        onChange={(event) => setValue(key, event.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `f-${key}-error` : undefined}
        {...props}
      />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 sm:pt-5 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <SensChoice value={values.sens} allowed={allowedSens} onChange={(sens) => setValue("sens", sens)} error={errors.sens} />
          </div>
          {text("tiers", "Tiers (client ou fournisseur)")}
          {text("numero", "N° de facture")}
          {text("montant", "Montant (DA)", { inputMode: "decimal", placeholder: "0,00" })}
          {text("categorie", "Catégorie", { list: "categories-list" })}
          <datalist id="categories-list">
            {categories.map((categorie) => (
              <option key={categorie} value={categorie} />
            ))}
          </datalist>
          {text("nature", "Nature")}
          {text("dateFacture", "Date de facture", { type: "date" })}
          <div className="sm:col-span-2 lg:col-span-3">{text("libelle", "Libellé")}</div>
          {text("succursale", "Succursale")}
          {text("periode", "Période", { placeholder: "ex. Septembre 2026" })}
          <Field id="f-status" label="État" error={errors.status}>
            <NativeSelect id="f-status" value={values.status} onChange={(event) => isStatus(event.target.value) && setValue("status", event.target.value)}>
              {INVOICE_STATUS_KEYS.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {text("dateOperation", "Date de règlement", { type: "date" })}
          <Field id="f-mode" label="Mode de règlement" error={errors.mode}>
            <NativeSelect id="f-mode" value={values.mode} onChange={(event) => isMode(event.target.value) && setValue("mode", event.target.value)}>
              <option value="">—</option>
              {PAYMENT_MODE_KEYS.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {text("cheque", "N° de chèque / référence")}
          {text("banque", "Banque")}
          {errors.form ? (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive sm:col-span-2 lg:col-span-3">
              {errors.form}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end lg:col-span-3">
            <Button variant="ghost" asChild>
              <Link href={cancelHref}>Annuler</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              <Save />
              {pending ? "Enregistrement…" : invoice ? "Enregistrer les modifications" : "Ajouter la facture"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
