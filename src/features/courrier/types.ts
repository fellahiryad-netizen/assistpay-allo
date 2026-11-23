/** Compagnies dont les succursales reçoivent les originaux des factures par courrier. */
export const COURRIER_COMPANIES = ["CAAR", "CAAT"] as const;
/** Compagnie d'une succursale. */
export type CourrierCompany = (typeof COURRIER_COMPANIES)[number];

/** Fiche d'une succursale destinataire du courrier. */
export interface BranchAddress {
  /** Identifiant stable (jamais réutilisé après une suppression). */
  id: string;
  compagnie: CourrierCompany;
  /** Nom tel qu'il doit apparaître sur l'enveloppe (ex. « SUCCURSALE CAAR ORAN 400 »). */
  nom: string;
  /** Personne à l'attention de qui adresser le courrier (facultatif). */
  contact: string;
  /** Un ou plusieurs numéros, en texte libre. */
  telephones: string;
  adresse: string;
  remarque: string;
}

/** Rôles des personnes du prestataire de courrier. */
export const EMS_ROLES = ["RAMASSEUR", "RECLAMATION"] as const;
/** Rôle d'une personne du prestataire de courrier. */
export type EmsRole = (typeof EMS_ROLES)[number];

/** Libellés français des rôles. */
export const EMS_ROLE_LABELS: Readonly<Record<EmsRole, string>> = {
  RAMASSEUR: "Ramasseur",
  RECLAMATION: "Réclamations ou remplaçant",
};

/** Personne à joindre chez le prestataire de courrier. */
export interface EmsContact {
  id: string;
  nom: string;
  role: EmsRole;
  telephone: string;
  email: string;
  remarque: string;
}

/** Carnet d'adresses complet, tel qu'il est enregistré dans la clé `courrier:adresses`. */
export interface AddressBook {
  branches: BranchAddress[];
  /** Nom de la société de courrier. */
  emsSociete: string;
  emsContacts: EmsContact[];
}

/** Carnet envoyé à l'écran : `persisted` vaut false tant que la liste de départ du code n'a pas été enregistrée. */
export interface AddressBookView extends AddressBook {
  persisted: boolean;
  canEdit: boolean;
}

/** Clé du réglage qui garde le carnet. */
export const COURRIER_KEY = "courrier:adresses";

/** Nombre maximal de fiches (succursales et contacts EMS confondus). */
export const MAX_FICHES = 200;
