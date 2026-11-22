/** Montant en millions de DA : « 41,4 M DA ». */
export function millions(value: number): string {
  const rounded = Math.round((Math.abs(value) / 1_000_000) * 10) / 10;
  return `${value < 0 ? "−" : ""}${rounded.toFixed(1).replace(".", ",")} M DA`;
}

/** Nombre de jours arrondi, au singulier ou au pluriel : « 14 jours ». */
export function daysLabel(value: number): string {
  const rounded = Math.round(value);
  return `${rounded} jour${Math.abs(rounded) > 1 ? "s" : ""}`;
}
