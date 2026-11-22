/** Résultat de la lecture d'un montant saisi : valeur, ou motif de refus affichable. */
export type TypedAmount = { ok: true; value: number } | { ok: false; error: string };

/**
 * Lit un montant tapé à la main sans jamais deviner en silence : « 22 752 053,50 », « 22.752.053 », « 22,752,053 », « 1.234,56 » et « 1,234.56 » sont acceptés
 * (séparateurs de milliers en groupes de 3 chiffres, un seul séparateur décimal, 2 décimales au plus). Une saisie ambiguë comme « 22.752 » ou « 22,752 »
 * (un séparateur suivi de 3 chiffres) est refusée : on demande de préciser. Le signe moins n'est accepté qu'avec `allowNegative`.
 */
export function parseTypedAmount(input: string, allowNegative = false): TypedAmount {
  let text = input.replace(/[\s   ]/g, "").replace(/(DA|DZD)$/i, "");
  if (text === "") return { ok: false, error: "Indiquez un montant." };
  let sign = 1;
  if (text.startsWith("-")) {
    if (!allowNegative) return { ok: false, error: "Le montant ne peut pas être négatif." };
    sign = -1;
    text = text.slice(1);
  }
  if (!/^[\d.,]+$/.test(text) || !/^\d/.test(text)) return { ok: false, error: `Montant illisible : « ${input.trim()} ».` };
  const grouped = (value: string, sep: string): boolean => new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})+$`).test(value);
  let integer = text;
  let decimals = "";
  const hasDot = text.includes(".");
  const hasComma = text.includes(",");
  if (hasDot && hasComma) {
    const decimalSep = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    const parts = text.split(decimalSep);
    if (parts.length !== 2) return { ok: false, error: `Montant ambigu : « ${input.trim()} ».` };
    const [left = "", right = ""] = parts;
    if (!grouped(left, thousandSep)) return { ok: false, error: `Séparateurs de milliers incorrects : « ${input.trim()} ».` };
    integer = left.split(thousandSep).join("");
    decimals = right;
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const count = text.split(sep).length - 1;
    if (count >= 2) {
      if (!grouped(text, sep)) return { ok: false, error: `Séparateurs de milliers incorrects : « ${input.trim()} ».` };
      integer = text.split(sep).join("");
    } else {
      const [left = "", right = ""] = text.split(sep);
      if (right.length === 3) return { ok: false, error: `Saisie ambiguë : « ${input.trim()} » peut valoir ${left}${right} ou ${left},${right}. Écrivez ${left}${right} (sans séparateur) ou ${left},000 avec la virgule décimale complète.` };
      integer = left;
      decimals = right;
    }
  }
  if (decimals.length > 2) return { ok: false, error: "Deux décimales au plus." };
  if (!/^\d+$/.test(integer) || (decimals !== "" && !/^\d+$/.test(decimals))) return { ok: false, error: `Montant illisible : « ${input.trim()} ».` };
  const value = sign * Number(`${integer}.${decimals || "0"}`);
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) return { ok: false, error: "Montant trop grand." };
  if (!allowNegative && value <= 0) return { ok: false, error: "Le montant doit être supérieur à zéro." };
  return { ok: true, value: Math.round(value * 100) / 100 };
}
