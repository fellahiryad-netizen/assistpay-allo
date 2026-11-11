/** Ligne du journal des actions. */
export interface JournalItem {
  id: string;
  at: string;
  userName: string;
  action: string;
  objet: string;
  admin: boolean;
  /** État avant / après la modification (vide pour les anciennes entrées). */
  avant: Record<string, string | number | boolean | null> | null;
  apres: Record<string, string | number | boolean | null> | null;
}

/** Filtres de consultation du journal. */
export interface JournalQuery {
  page: number;
  q: string;
  scope: "general" | "admin";
}
