"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createInvoiceAction, updateInvoiceAction } from "@/app/actions/invoice-actions";
import { invoiceInputSchema } from "@/features/invoices/schemas";
import type { InvoiceDTO, InvoiceStatusKey, PaymentModeKey, SensKey } from "@/features/invoices/types";

/** Valeurs du formulaire (tout en texte, comme les champs HTML). */
export interface InvoiceFormValues {
  sens: SensKey | "";
  status: InvoiceStatusKey;
  categorie: string;
  tiers: string;
  numero: string;
  libelle: string;
  montant: string;
  dateFacture: string;
  dateOperation: string;
  mode: PaymentModeKey | "";
  cheque: string;
  banque: string;
  nature: string;
  succursale: string;
  periode: string;
}

/** Erreurs par champ. */
export type InvoiceFormErrors = Partial<Record<keyof InvoiceFormValues | "form", string>>;

/** État et actions exposés au formulaire. */
export interface UseInvoiceForm {
  values: InvoiceFormValues;
  errors: InvoiceFormErrors;
  pending: boolean;
  setValue: <K extends keyof InvoiceFormValues>(key: K, value: InvoiceFormValues[K]) => void;
  submit: () => void;
}

/** Valeurs initiales : facture existante, ou formulaire vide pour le sens demandé. */
export function initialInvoiceValues(invoice: InvoiceDTO | null, sens: SensKey | null, today: string): InvoiceFormValues {
  if (!invoice) {
    return {
      sens: sens ?? "",
      status: "EN_ATTENTE",
      categorie: "",
      tiers: "",
      numero: "",
      libelle: "",
      montant: "",
      dateFacture: today,
      dateOperation: "",
      mode: "",
      cheque: "",
      banque: "",
      nature: "",
      succursale: "",
      periode: "",
    };
  }
  return {
    sens: invoice.sens,
    status: invoice.status,
    categorie: invoice.categorie,
    tiers: invoice.tiers,
    numero: invoice.numero,
    libelle: invoice.libelle,
    montant: String(invoice.montant),
    dateFacture: invoice.dateFacture ?? "",
    dateOperation: invoice.dateOperation ?? "",
    mode: invoice.mode ?? "",
    cheque: invoice.cheque,
    banque: invoice.banque,
    nature: invoice.nature,
    succursale: invoice.succursale,
    periode: invoice.periode,
  };
}

/**
 * Logique du formulaire de facture : validation Zod côté navigateur (messages par champ),
 * puis enregistrement par server action et retour sur la fiche.
 */
export function useInvoiceForm(initial: InvoiceFormValues, invoiceId: string | null): UseInvoiceForm {
  const router = useRouter();
  const [values, setValues] = useState<InvoiceFormValues>(initial);
  const [errors, setErrors] = useState<InvoiceFormErrors>({});
  const [pending, startTransition] = useTransition();

  function setValue<K extends keyof InvoiceFormValues>(key: K, value: InvoiceFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
  }

  function submit(): void {
    const payload = { ...values, montant: values.montant.replace(/\s/g, "").replace(",", ".") };
    const parsed = invoiceInputSchema.safeParse(payload);
    if (!parsed.success) {
      const next: InvoiceFormErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && key in values && !next[key as keyof InvoiceFormValues]) {
          next[key as keyof InvoiceFormValues] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    startTransition(async () => {
      const result = invoiceId ? await updateInvoiceAction(invoiceId, parsed.data) : await createInvoiceAction(parsed.data);
      if (!result.success) {
        setErrors({ form: result.error });
        return;
      }
      router.push(`/factures/${result.data.id}`);
      router.refresh();
    });
  }

  return { values, errors, pending, setValue, submit };
}
