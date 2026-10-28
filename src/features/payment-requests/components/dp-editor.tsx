"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Link2, Printer, Save, Trash2 } from "lucide-react";
import { deleteRequestAction, linkRequestAction, updateRequestAction } from "@/app/actions/payment-request-actions";
import { Notice } from "@/components/common/notice";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DpSheet } from "@/features/payment-requests/components/dp-sheet";
import { InvoicePickerDialog } from "@/features/payment-requests/components/invoice-picker-dialog";
import { dpUpdateSchema } from "@/features/payment-requests/schemas";
import { DP_PRODUCTS, type DpMode, type DpProduct, type PaymentRequestDTO } from "@/features/payment-requests/types";
import { parseLooseAmount } from "@/utils/amounts";

/** Propriétés de l'éditeur de demande. */
export interface DpEditorProps {
  request: PaymentRequestDTO;
  canEdit: boolean;
  isAdmin: boolean;
}

function isProduct(value: string): value is DpProduct {
  return (DP_PRODUCTS as readonly string[]).includes(value);
}

/** Vérification, modification, validation et impression d'une demande de paiement (aperçu en direct). */
export function DpEditor({ request, canEdit, isAdmin }: Readonly<DpEditorProps>): React.JSX.Element {
  const router = useRouter();
  const [values, setValues] = useState({
    date: request.date ?? "",
    beneficiaire: request.beneficiaire,
    adresse: request.adresse,
    montant: String(request.montant),
    nature: request.nature,
    mode: (request.mode === "CHEQUE" ? "CHEQUE" : "VIRMT") as DpMode,
    produit: (isProduct(request.produit) ? request.produit : "Autre") as DpProduct,
    pieces: request.pieces.join("\n"),
  });
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [pending, startTransition] = useTransition();
  const amount = parseLooseAmount(values.montant);

  function save(validate: boolean): void {
    const parsed = dpUpdateSchema.safeParse({
      id: request.id,
      ...values,
      montant: Number.isFinite(amount) ? amount : values.montant,
      pieces: values.pieces.split("\n").map((line) => line.trim()).filter(Boolean),
      validate,
    });
    if (!parsed.success) {
      setMessage({ tone: "error", text: parsed.error.issues[0]?.message ?? "Formulaire incomplet." });
      return;
    }
    startTransition(async () => {
      const result = await updateRequestAction(parsed.data);
      setMessage(result.success ? { tone: "success", text: validate ? `Demande ${request.ref} validée.` : `Demande ${request.ref} enregistrée.` } : { tone: "error", text: result.error });
    });
  }

  function remove(): void {
    if (!window.confirm(`Supprimer définitivement la demande ${request.ref} ?`)) return;
    startTransition(async () => {
      const result = await deleteRequestAction(request.id);
      if (result.success) router.push("/demandes");
      else setMessage({ tone: "error", text: result.error });
    });
  }

  const field = (key: "beneficiaire" | "adresse" | "nature" | "montant" | "date", label: string, type = "text"): React.JSX.Element => (
    <Field id={`dp-${key}`} label={label}>
      <Input id={`dp-${key}`} type={type} value={values[key]} disabled={!canEdit} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 sm:pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {request.status === "a_valider" ? <Badge variant="warning">Nouvelle, à valider</Badge> : <Badge variant="success">Émise</Badge>}
            <Badge variant={request.payment.state === "payee" ? "success" : request.payment.state === "non_reliee" ? "muted" : "warning"}>{request.payment.label}</Badge>
            {request.transferSent ? <Badge variant="accent">Virement envoyé</Badge> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("date", "Date", "date")}
            {field("montant", "Montant (DA)")}
            <div className="sm:col-span-2">{field("beneficiaire", "Bénéficiaire (nom et prénom ou raison sociale)")}</div>
            <div className="sm:col-span-2">{field("adresse", "Adresse")}</div>
            <div className="sm:col-span-2">{field("nature", "Nature de la dépense")}</div>
            <Field id="dp-mode" label="Type de règlement">
              <NativeSelect id="dp-mode" value={values.mode} disabled={!canEdit} onChange={(event) => setValues((current) => ({ ...current, mode: event.target.value === "CHEQUE" ? "CHEQUE" : "VIRMT" }))}>
                <option value="VIRMT">Virement</option>
                <option value="CHEQUE">Chèque</option>
              </NativeSelect>
            </Field>
            <Field id="dp-produit" label="Type de prestataire">
              <NativeSelect
                id="dp-produit"
                value={values.produit}
                disabled={!canEdit}
                onChange={(event) => isProduct(event.target.value) && setValues((current) => ({ ...current, produit: event.target.value as DpProduct }))}
              >
                {DP_PRODUCTS.map((product) => (
                  <option key={product} value={product}>
                    {product}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="dp-pieces" label="Pièces jointes (une par ligne)" className="sm:col-span-2">
              <textarea
                id="dp-pieces"
                rows={5}
                value={values.pieces}
                disabled={!canEdit}
                onChange={(event) => setValues((current) => ({ ...current, pieces: event.target.value }))}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            {request.payment.invoices.length
              ? `Facture(s) du suivi : ${request.payment.invoices.map((invoice) => `${invoice.label} (${invoice.status === "REGLE" ? "réglée" : "en attente"})`).join(", ")}`
              : "Aucune facture du suivi reliée."}
          </p>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <>
                <Button type="button" onClick={() => save(false)} disabled={pending}>
                  <Save />
                  Enregistrer
                </Button>
                {request.status === "a_valider" ? (
                  <Button type="button" variant="success" onClick={() => save(true)} disabled={pending}>
                    <CheckCircle2 />
                    Valider la demande
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => setPicker(true)}>
                  <Link2 />
                  Relier des factures
                </Button>
              </>
            ) : null}
            <Link href={`/imprimer/demandes?ids=${request.id}`} target="_blank" className={buttonVariants({ variant: "outline" })}>
              <Printer />
              Imprimer (PDF)
            </Link>
            {isAdmin ? (
              <Button type="button" variant="ghost" onClick={remove} disabled={pending}>
                <Trash2 />
                Supprimer
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-lg border bg-muted p-3">
        <div className="origin-top-left scale-75 sm:scale-90 xl:scale-75 2xl:scale-90">
          <DpSheet
            data={{
              ref: request.ref,
              date: values.date || null,
              beneficiaire: values.beneficiaire.toUpperCase(),
              adresse: values.adresse,
              montant: Number.isFinite(amount) ? amount : 0,
              nature: values.nature,
              mode: values.mode,
              produit: values.produit,
              pieces: values.pieces.split("\n").map((line) => line.trim()).filter(Boolean),
            }}
          />
        </div>
      </div>
      <InvoicePickerDialog
        open={picker}
        onOpenChange={setPicker}
        title={`Relier la demande ${request.ref}`}
        description="Choisissez les factures fournisseurs payées par cette demande."
        confirmLabel="Relier"
        onConfirm={async (invoiceIds) => {
          const result = await linkRequestAction({ id: request.id, invoiceIds });
          if (!result.success) return result.error;
          setPicker(false);
          setMessage({ tone: "success", text: `${invoiceIds.length} facture(s) reliée(s).` });
          return null;
        }}
      />
    </div>
  );
}
