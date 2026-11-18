import { parseLooseAmount } from "@/utils/amounts";

/** Champs d'une facture utiles à la recherche d'une facture d'origine. */
export interface AvoirSearchable {
  num: string;
  num2: string;
  client: string;
  clientLabel: string;
  succ: string;
  perTxt: string;
  objet: string;
  ttc: number;
  reste: number;
}

/**
 * Filtre les factures proposées comme facture d'origine : par compagnie (code, vide = toutes) puis par texte libre
 * (n° de facture, client, succursale, période, objet) ou par montant TTC (« 1 190 », « 1190,00 »). Seules les factures
 * qui ont encore un reste avoirable sont gardées.
 */
export function filterAvoirable<T extends AvoirSearchable>(invoices: readonly T[], client: string, query: string): T[] {
  const text = query.trim().toLowerCase();
  const amount = text ? parseLooseAmount(text) : Number.NaN;
  return invoices.filter((invoice) => {
    if (invoice.reste <= 0.005) return false;
    if (client && invoice.client !== client) return false;
    if (!text) return true;
    const haystack = [invoice.num, invoice.num2, invoice.clientLabel, invoice.client, invoice.succ, invoice.perTxt, invoice.objet].join(" ").toLowerCase();
    if (haystack.includes(text)) return true;
    if (Number.isFinite(amount) && amount > 0) {
      const cents = Math.round(amount * 100);
      return Math.round(invoice.ttc * 100) === cents || Math.round(invoice.reste * 100) === cents || invoice.ttc.toFixed(2).replace(".", ",").startsWith(text.replace(/\s/g, ""));
    }
    return false;
  });
}
