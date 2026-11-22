import { formatDA } from "@/utils/format";

/**
 * Montant lisible dans une phrase : en millions de DA à partir de 1 M DA (« 41,4 M DA »), en DA exacts en dessous (« 850 000,00 DA »),
 * pour ne jamais écrire « 0,0 M DA » devant un petit montant.
 */
export function millions(value: number): string {
  if (Math.abs(value) < 1_000_000) return value < 0 ? `−${formatDA(-value)}` : formatDA(value);
  const rounded = Math.round((Math.abs(value) / 1_000_000) * 10) / 10;
  return `${value < 0 ? "−" : ""}${rounded.toFixed(1).replace(".", ",")} M DA`;
}

/** Nombre de jours arrondi, au singulier ou au pluriel : « 14 jours ». */
export function daysLabel(value: number): string {
  const rounded = Math.round(value);
  return `${rounded} jour${Math.abs(rounded) > 1 ? "s" : ""}`;
}

/** Montant en millions et exact : « 41,4 M DA (41 378 405,18 DA) » ; sous 1 M DA le montant exact seul. */
export function withExact(value: number): string {
  const short = millions(value);
  return short.endsWith("M DA") ? `${short} (${formatDA(value)})` : short;
}
