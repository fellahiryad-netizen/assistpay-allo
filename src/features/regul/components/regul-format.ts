/** Montant sans unité, deux décimales (format du classeur de régularisation). */
export const fm = (n: number): string => (Math.round((Number.isFinite(n) ? n : 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Entier avec séparateur de milliers. */
export const f0 = (n: number): string => Math.round(n).toLocaleString("fr-FR");

/** Date ISO (AAAA-MM-JJ) au format JJ/MM/AAAA. */
export const dateFr = (iso: string | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
};

/** Nombre lu dans une saisie (« 1 234,50 »). */
export const parseAmount = (value: string): number => {
  const v = parseFloat(value.replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isNaN(v) ? 0 : v;
};

/** Télécharge un contenu binaire sous le nom donné. */
export function downloadBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
