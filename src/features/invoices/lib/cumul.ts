/** Facture candidate à un virement cumulé (montant en centimes). */
export interface CumulPart {
  id: string;
  numero: string;
  cents: number;
}

/**
 * Groupes de 2 ou 3 factures (de la liste donnée, supposée d'un même tiers) dont la somme tombe dans [lo, hi] centimes.
 * Au plus `limit` groupes ; les groupes de 3 ne sont cherchés que dans les listes de 250 factures ou moins.
 */
export function findCombinations(list: readonly CumulPart[], range: { lo: number; hi: number }, limit = 20): CumulPart[][] {
  const sorted = [...list].sort((a, b) => a.cents - b.cents);
  const out: CumulPart[][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    if (!a) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (!b) continue;
      const two = a.cents + b.cents;
      if (two > range.hi) break;
      if (two >= range.lo) {
        out.push([a, b]);
      } else if (sorted.length <= 250) {
        for (let k = j + 1; k < sorted.length; k += 1) {
          const c = sorted[k];
          if (!c) continue;
          const three = two + c.cents;
          if (three > range.hi) break;
          if (three >= range.lo) out.push([a, b, c]);
          if (out.length >= limit) return out;
        }
      }
      if (out.length >= limit) return out;
    }
  }
  return out;
}
