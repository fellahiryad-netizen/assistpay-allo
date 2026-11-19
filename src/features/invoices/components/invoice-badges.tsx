import { Badge } from "@/components/ui/badge";
import { ACTIVITY_LABELS, type Activity } from "@/features/invoices/lib/activity";
import { SENS_LABELS, STATUS_LABELS, type InvoiceStatusKey, type SensKey } from "@/features/invoices/types";

/** Pastille d'état d'une facture. */
export function StatusBadge({ status }: Readonly<{ status: InvoiceStatusKey }>): React.JSX.Element {
  const variant = status === "REGLE" ? "success" : status === "ANNULE" ? "muted" : "warning";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

/** Pastille de sens (Crédit / Débit). */
export function SensBadge({ sens }: Readonly<{ sens: SensKey }>): React.JSX.Element {
  return <Badge variant={sens === "CREDIT" ? "default" : "accent"}>{SENS_LABELS[sens]}</Badge>;
}

/** Pastille d'activité d'une facture fournisseur (Assistance / BDG / Autre). */
export function ActivityBadge({ activity }: Readonly<{ activity: Activity }>): React.JSX.Element {
  const variant = activity === "assistance" ? "default" : activity === "bdg" ? "accent" : "muted";
  return <Badge variant={variant}>{ACTIVITY_LABELS[activity]}</Badge>;
}
