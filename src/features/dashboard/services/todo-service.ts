import { db } from "@/lib/db";
import { can } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { countAlerts } from "@/features/invoices/services/alert-service";
import { countPendingDeletions } from "@/features/invoices/services/deletion-service";
import { qualityReport } from "@/features/quality/services/quality-service";
import { todayIso, toIsoDate } from "@/utils/dates";

/** Une chose à faire, avec le nombre d'éléments concernés et l'écran qui la traite. */
export interface TodoItem {
  key: string;
  label: string;
  count: number;
  detail: string;
  href: string;
  /** « urgent » : à traiter vite (ancienneté ou risque d'erreur). */
  tone: "urgent" | "normal";
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000));
}

/** Compte, sans jamais échouer, ce qui attend l'utilisateur : chaque contrôle respecte ses droits d'accès. */
async function safe<T>(job: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await job();
  } catch (error) {
    console.error("[accueil] à faire :", error);
    return fallback;
  }
}

/** Liste « À faire » de l'accueil : seulement les points qui ont au moins un élément. */
export async function getTodo(actor: AuthUser): Promise<TodoItem[]> {
  const items: TodoItem[] = [];
  const [lines, advances, requests, deletions, alerts, quality, ribs] = await Promise.all([
    can(actor, "RELEVE") ? safe<Array<{ date: Date }>>(() => db.bankStatementLine.findMany({ where: { status: "A_TRAITER" }, select: { date: true } }), []) : Promise.resolve<Array<{ date: Date }>>([]),
    can(actor, "FCLI")
      ? safe(() => db.invoice.count({ where: { sens: "CREDIT", status: "EN_ATTENTE", montant: 0, extra: { path: ["avance"], equals: true } } }), 0)
      : Promise.resolve(0),
    can(actor, "DP") ? safe(() => db.paymentRequest.count({ where: { status: "a_valider" } }), 0) : Promise.resolve(0),
    actor.isAdmin ? safe(() => countPendingDeletions(actor), 0) : Promise.resolve(0),
    can(actor, "ALERT") ? safe(() => countAlerts(actor), 0) : Promise.resolve(0),
    can(actor, "QC") ? safe(async () => { const result = await qualityReport(actor); return result.success ? result.data.total : 0; }, 0) : Promise.resolve(0),
    can(actor, "VIR") ? safe(() => db.providerRib.count({ where: { status: "a_valider" } }), 0) : Promise.resolve(0),
  ]);

  if (lines.length) {
    const oldest = lines.map((line) => toIsoDate(line.date) ?? "").filter(Boolean).sort()[0] ?? null;
    const age = daysSince(oldest);
    items.push({ key: "releve", label: "Lignes du relevé bancaire à traiter", count: lines.length, detail: `La plus ancienne date de ${age} jour(s).`, href: "/releve?onglet=a-traiter", tone: age > 30 ? "urgent" : "normal" });
  }
  if (advances) items.push({ key: "avances0", label: "Avances CAAT en attente à 0 DA", count: advances, detail: "Le montant se remplit quand un virement leur est affecté.", href: "/avances", tone: "normal" });
  if (requests) items.push({ key: "dp", label: "Demandes de paiement à valider", count: requests, detail: "Elles ne partent dans un état de virements qu'une fois validées.", href: "/demandes?filtre=a_valider", tone: "normal" });
  if (ribs) items.push({ key: "rib", label: "RIB prestataires à valider", count: ribs, detail: "Un RIB non validé bloque le virement.", href: "/virements", tone: "normal" });
  if (deletions) items.push({ key: "suppr", label: "Suppressions à valider", count: deletions, detail: "Rien n'est supprimé avant votre décision.", href: "/suppressions", tone: "normal" });
  if (alerts) items.push({ key: "impayes", label: "Impayés en alerte", count: alerts, detail: "Factures dont le délai de paiement est dépassé.", href: "/alertes", tone: "urgent" });
  if (quality) items.push({ key: "qualite", label: "Points à vérifier dans les données", count: quality, detail: "Écarts de virement, doubles affectations, dates manquantes…", href: "/controle", tone: "normal" });
  return items;
}
