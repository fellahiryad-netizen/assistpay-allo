/** Phrase du bandeau « doublon possible » : lignes simulées signalées et encore comptées (écran, impression et export). */
export function duplicatesSentence(count: number): string {
  return `${count} ligne${count > 1 ? "s" : ""} simulée${count > 1 ? "s" : ""} signalée${count > 1 ? "s" : ""} comme doublon possible, comptée${count > 1 ? "s" : ""} tant qu'elle${count > 1 ? "s ne sont" : " n'est"} pas écartée${count > 1 ? "s" : ""}.`;
}
