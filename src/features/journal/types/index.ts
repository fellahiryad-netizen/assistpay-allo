/** Ligne du journal des actions. */
export interface JournalItem {
  id: string;
  at: string;
  userName: string;
  action: string;
  objet: string;
  admin: boolean;
}

/** Filtres de consultation du journal. */
export interface JournalQuery {
  page: number;
  q: string;
  scope: "general" | "admin";
}
