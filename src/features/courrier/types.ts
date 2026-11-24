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
  /** Destination affichée sur le bordereau d'envoi (ville, ou ville + précision) ; vide : la ville est déduite de l'adresse. */
  destination: string;
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

/** Observation proposée par défaut pour chaque ligne du bordereau. */
export const DEFAULT_OBSERVATION = "COURRIER : DOCUMENT FACTURATION";

/** Ligne d'un bordereau d'envoi. */
export interface BordereauLine {
  designation: string;
  qnt: number;
  destination: string;
  observation: string;
}

/** Statuts d'un bordereau enregistré. */
export const ENVOI_STATUTS = ["ETABLI", "RAMASSE", "ANNULE"] as const;
/** Statut d'un bordereau enregistré. */
export type EnvoiStatut = (typeof ENVOI_STATUTS)[number];

/** Libellés français des statuts. */
export const ENVOI_STATUT_LABELS: Readonly<Record<EnvoiStatut, string>> = { ETABLI: "Établi", RAMASSE: "Ramassé", ANNULE: "Annulé" };

/** Ligne d'un bordereau enregistré : ce qui a été envoyé, et où. */
export interface EnvoiLine {
  /** Identifiant de la fiche du carnet (vide pour une ligne libre). */
  brancheId: string;
  /** Compagnie de la fiche (vide pour une ligne libre). */
  compagnie: CourrierCompany | "";
  designation: string;
  qnt: number;
  destination: string;
  observation: string;
}

/** Bordereau d'envoi enregistré (jamais supprimé : on l'annule avec un motif). */
export interface Envoi {
  /** Numéro d'ordre « BE-AAAA-NNN », séquence propre aux bordereaux. */
  numero: string;
  annee: number;
  /** Instant de création (ISO UTC), affiché à l'heure d'Alger ; non modifiable. */
  creeLe: string;
  creePar: string;
  creeParId: string;
  /** Date imprimée « ALGER LE » (`AAAA-MM-JJ`). */
  date: string;
  ramasseur: string;
  /** Date à laquelle EMS a réellement ramassé (`AAAA-MM-JJ`), vide tant qu'elle n'est pas connue. */
  ramasseLe: string;
  lignes: EnvoiLine[];
  /** Total de plis (somme des quantités). */
  total: number;
  remarque: string;
  statut: EnvoiStatut;
  motifAnnulation: string;
  annuleLe: string;
  annulePar: string;
}

/** Contenu d'une clé `courrier:envois:AAAA`. */
export interface EnvoiYear {
  /** Dernier numéro attribué dans l'année. */
  seq: number;
  items: Envoi[];
}

/** Préfixe des clés Setting des bordereaux (une clé par année). */
export const ENVOI_KEY_PREFIX = "courrier:envois:";

/** Nombre maximal de bordereaux enregistrés par année. */
export const MAX_ENVOIS_PAR_AN = 500;

/** Filtres de l'historique des bordereaux. */
export interface EnvoiFilters {
  q: string;
  /** Création à partir de (`AAAA-MM-JJ`, vide = sans borne). */
  du: string;
  /** Création jusqu'à (`AAAA-MM-JJ`, vide = sans borne). */
  au: string;
  ramasse: "" | "oui" | "non";
  statut: "" | EnvoiStatut;
  compagnie: "" | CourrierCompany;
}
