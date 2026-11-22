/**
 * Parts en pourcentage, à une décimale, dont la somme fait exactement 100,0
 * (méthode du plus fort reste). Renvoie des 0 si le total est nul ou négatif.
 */
export function sharesPercent(amounts: readonly number[]): number[] {
  const cents = amounts.map((value) => Math.max(0, Math.round(value * 100)));
  const total = cents.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return amounts.map(() => 0);
  const exact = cents.map((value) => (value * 1000) / total);
  const floors = exact.map((value) => Math.floor(value));
  let missing = 1000 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (missing <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    missing -= 1;
  }
  return floors.map((value) => value / 10);
}
