/** Arrondi au centime. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lit un montant saisi ou exporté par une banque : « 1 234,56 », « 1.234,56 », « 1,234.56 », « (200) », « 15000 DA ».
 * Renvoie NaN si la valeur n'est pas un montant.
 */
export function parseLooseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  const raw = String(value ?? "")
    .replace(/[\s  ]/g, "")
    .replace(/(DA|DZD)$/i, "");
  if (!raw) return Number.NaN;
  let text = raw;
  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else {
    text = text.replace(",", ".");
  }
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

const UNITS = ["", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const TENS = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];

function belowHundred(n: number): string {
  if (n < 20) return UNITS[n] ?? "";
  const ten = Math.floor(n / 10);
  let unit = n % 10;
  if (ten === 7 || ten === 9) unit += 10;
  const base = TENS[ten] ?? "";
  if (unit === 0) return ten === 8 ? "quatre-vingts" : base;
  if (unit === 1 && ten !== 8 && ten !== 9) return `${base} et ${UNITS[unit] ?? ""}`;
  if (unit === 11 && ten === 7) return `${base} et onze`;
  return `${base}-${UNITS[unit] ?? ""}`;
}

function belowThousand(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  let out = "";
  if (hundred === 1) out = "cent";
  else if (hundred > 1) out = `${UNITS[hundred] ?? ""} cent${rest === 0 ? "s" : ""}`;
  if (rest) out = out ? `${out} ${belowHundred(rest)}` : belowHundred(rest);
  return out;
}

function integerInWords(n: number): string {
  if (n === 0) return "zéro";
  const parts: string[] = [];
  const scales: Array<[number, string, string]> = [
    [1_000_000_000, "milliard", "milliards"],
    [1_000_000, "million", "millions"],
  ];
  let rest = n;
  for (const [size, one, many] of scales) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${count === 1 ? "un" : belowThousand(count)} ${count === 1 ? one : many}`);
    rest %= size;
  }
  const thousands = Math.floor(rest / 1000);
  if (thousands) parts.push(thousands === 1 ? "mille" : `${belowThousand(thousands).replace(/cents$/, "cent")} mille`);
  rest %= 1000;
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** Montant en toutes lettres : « Huit millions … dinars et soixante-quinze centimes ». */
export function amountInWords(value: number): string {
  const cents = Math.round(Math.abs(value) * 100);
  const dinars = Math.floor(cents / 100);
  const centimes = cents % 100;
  let text = `${integerInWords(dinars)}${dinars >= 1_000_000 && dinars % 1_000_000 === 0 ? " de" : ""} dinar${dinars > 1 ? "s" : ""}`;
  if (centimes) text += ` et ${integerInWords(centimes)} centime${centimes > 1 ? "s" : ""}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
