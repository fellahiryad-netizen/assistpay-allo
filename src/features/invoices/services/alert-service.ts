import { db } from "@/lib/db";
import { can, requireAccess } from "@/features/access/services/access-rules";
import type { AuthUser } from "@/features/access/types";
import { remaining, toPayable } from "@/features/invoices/services/invoice-balance";
import { visibleSens } from "@/features/invoices/services/invoice-rules";
import type { SensKey } from "@/features/invoices/types";
import { fail, ok, type ActionResult } from "@/types";
import { round2 } from "@/utils/amounts";
import { daysBetween, todayIso } from "@/utils/dates";

/** Seuils d'alerte en jours depuis la date de dépôt de la facture. */
export const ALERT_LEVELS = [
  { key: "critique", label: "Critique", min: 90 },
  { key: "retard", label: "En retard", min: 60 },
  { key: "relance", label: "À relancer", min: 30 },
] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number]["key"];

/** Facture impayée en alerte. */
export interface AlertItem {
  id: string;
  sens: SensKey;
  tiers: string;
  categorie: string;
  numero: string;
  libelle: string;
  reste: number;
  dateFacture: string;
  jours: number;
  level: AlertLevel;
}

/** Alertes d'impayés regroupées par tiers. */
export interface AlertGroup {
  tiers: string;
  categorie: string;
  total: number;
  count: number;
  oldest: number;
  level: AlertLevel;
  items: AlertItem[];
}

/** Alertes automatiques : factures partenaires et fournisseurs en attente depuis plus de 30 jours. */
export interface AlertData {
  asOf: string;
  clients: AlertGroup[];
  fournisseurs: AlertGroup[];
  counts: { clients: number; fournisseurs: number; critique: number };
}

function levelOf(days: number): AlertLevel | null {
  return ALERT_LEVELS.find((level) => days >= level.min)?.key ?? null;
}

/** Calcule les alertes d'impayés visibles par l'utilisateur (aucune écriture). */
export async function getAlerts(actor: AuthUser): Promise<ActionResult<AlertData>> {
  const guard = requireAccess(actor, "ALERT");
  if (!guard.success) return guard;
  const sens = visibleSens(actor);
  if (sens.length === 0) return fail("Vous n'avez accès à aucune facture.", "FORBIDDEN");
  const today = todayIso();
  const rows = await db.invoice.findMany({
    where: { sens: { in: sens }, status: "EN_ATTENTE", dateFacture: { not: null }, ...(can(actor, "RH") ? {} : { payroll: false }) },
    orderBy: { dateFacture: "asc" },
  });
  const grouped = { CREDIT: new Map<string, AlertGroup>(), DEBIT: new Map<string, AlertGroup>() };
  for (const row of rows) {
    const invoice = toPayable(row);
    if (!invoice.dateFacture || row.payroll) continue;
    const jours = daysBetween(invoice.dateFacture, today);
    const level = levelOf(jours);
    const reste = remaining(invoice);
    if (!level || reste <= 0) continue;
    const key = (invoice.sens === "CREDIT" ? invoice.categorie || invoice.tiers : invoice.tiers) || "Sans nom";
    const map = grouped[invoice.sens];
    const group = map.get(key) ?? { tiers: key, categorie: invoice.categorie, total: 0, count: 0, oldest: 0, level, items: [] };
    group.items.push({ id: invoice.id, sens: invoice.sens, tiers: invoice.tiers, categorie: invoice.categorie, numero: invoice.numero, libelle: invoice.libelle, reste, dateFacture: invoice.dateFacture, jours, level });
    group.total = round2(group.total + reste);
    group.count += 1;
    if (jours > group.oldest) {
      group.oldest = jours;
      group.level = level;
    }
    map.set(key, group);
  }
  const list = (sensKey: SensKey): AlertGroup[] => [...grouped[sensKey].values()].sort((a, b) => b.total - a.total);
  const clients = list("CREDIT");
  const fournisseurs = list("DEBIT");
  const all = [...clients, ...fournisseurs].flatMap((group) => group.items);
  return ok({
    asOf: today,
    clients,
    fournisseurs,
    counts: { clients: clients.reduce((s, g) => s + g.count, 0), fournisseurs: fournisseurs.reduce((s, g) => s + g.count, 0), critique: all.filter((item) => item.level === "critique").length },
  });
}

/** Nombre d'alertes (pastille du menu) ; 0 en cas d'erreur. */
export async function countAlerts(actor: AuthUser): Promise<number> {
  try {
    const result = await getAlerts(actor);
    return result.success ? result.data.counts.clients + result.data.counts.fournisseurs : 0;
  } catch {
    return 0;
  }
}
