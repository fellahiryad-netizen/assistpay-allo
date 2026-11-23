import { cleanPersonName, cleanPhones, cleanText } from "@/features/courrier/lib/clean";
import type { AddressBook, BranchAddress, CourrierCompany, EmsContact, EmsRole } from "@/features/courrier/types";

/** Espace insécable, tel que l'Excel d'origine en contient (« TEL : 0542… »). */
const NBSP = String.fromCharCode(160);

/** Ligne brute du fichier Excel d'origine, avant nettoyage. */
export interface RawBranch {
  id: string;
  compagnie: CourrierCompany;
  nom: string;
  contact?: string;
  telephones?: string;
  adresse: string;
}

/** Les 13 succursales du fichier Excel (9 CAAT, 4 CAAR), telles que saisies, espaces insécables et fautes comprises. */
export const RAW_BRANCHES: readonly RawBranch[] = [
  { id: "caat-alger-1", compagnie: "CAAT", nom: "SUCCURSALE CAAT ALGER 1", telephones: `TEL${NBSP}: 0542 97 54 80`, adresse: "6, BOULEVARD AMIROUCHE ALGER" },
  {
    id: "caat-alger-2",
    compagnie: "CAAT",
    nom: "SUCCURSALE CAAT ALGER 2 ",
    contact: "Mr. AMEZIANE MAKHLOUF",
    telephones: `TEL${NBSP}: 0661 49 00 38 - 021 83 33 64`,
    adresse: "22, Rue TATA (ADJACENTE A LA RUE BOUAMAMA) El Harrach Belfort - Alger",
  },
  { id: "caat-alger-3", compagnie: "CAAT", nom: "SUCCURSALE CAAT ALGER 3", adresse: "RESIDENCE CHAABANI VAL-D 'HYDRA ALGER" },
  { id: "caat-annaba", compagnie: "CAAT", nom: "SUCCURSALE CAAT ANNABA", contact: "M.LAYADA ADIL", telephones: "TEL :0661 51 00 69", adresse: "CITE 05 JUILLET, ROUTE DU PARC D'ATTRACTION.ANNABA" },
  { id: "caat-constantine", compagnie: "CAAT", nom: "SUCCURSALE CAAT CONSTANTINE", contact: "Mr. LAZZOUNI MONCEF", telephones: `TEL${NBSP}: 0661 25 05 67`, adresse: "CITE LES MIMOSAS, ROUTE DE SETIF CONSTANTINE" },
  { id: "caat-ghardaia", compagnie: "CAAT", nom: "SUCCURSALE CAAT GHERDAIA", telephones: `TEL${NBSP}: 0661 47 61 67`, adresse: "RUE LARBI BEN-M'HIDI, ROUTE DE BEN-ISGUEN GHARDAÏA" },
  { id: "caat-oran", compagnie: "CAAT", nom: "SUCCURSALE CAAT ORAN", telephones: `TEL${NBSP}: 0660 31 00 90`, adresse: "HAI EL-HOUMRIA AVENUE WELD KABLIA SALIHA TOURS EDEN-ORAN" },
  { id: "caat-setif", compagnie: "CAAT", nom: "SUCCURSALE CAAT SETIF", telephones: `TEL${NBSP}: 0661 34 87 64`, adresse: "CITE ADMINISTRATIVE AIN-TBINET SETIF" },
  { id: "caat-tlemcen", compagnie: "CAAT", nom: "SUCCURSALE CAAT TLEMCEN", contact: "Mr. BEMOKHTAR ALI", telephones: `TEL${NBSP}: 0661 57 07 70`, adresse: "SECTION 111, CITE LES DHALIAS EL-KIFFAN TLEMCEN" },
  { id: "caar-annaba-300", compagnie: "CAAR", nom: "SUCCURSALE CAAR ANNABA 300", telephones: "038 84 50 31 / 038 84 49 11  ", adresse: "BOULEVARD MOHAMED SEDDIK BENYAHIA BP 67, PLAINE OUEST – ANNABA" },
  { id: "caar-bouzareah-600", compagnie: "CAAR", nom: "SUCCURSALE CAAR BOUZEREAH 600", telephones: "023 18 48 31/33/36", adresse: "PUITS DES ZOUAVES BOUZAREAH ALGER" },
  { id: "caar-constantine-500", compagnie: "CAAR", nom: "SUCCURSALE CAAR CONSTANTINE 500", telephones: "031 60 65 00/ 02    031 60 64 97", adresse: "Zone Industrielle le Rhumel bp 399 - Constantine 25000 Algerie" },
  { id: "caar-oran-400", compagnie: "CAAR", nom: "SUCCURSALE CAAR ORAN 400", telephones: "041 70 68 01 /04 /05 à 07", adresse: "CITE ADMINISTRATIVE ILOT 26 ZHUN-USTO ORAN" },
];

/** Ligne brute d'un contact du prestataire de courrier. */
export interface RawEmsContact {
  id: string;
  nom: string;
  /** Civilité connue par ailleurs (« Mme Illoul ») mais absente du fichier. */
  civilite?: string;
  role: EmsRole;
  telephone: string;
  email?: string;
  remarque: string;
}

/** Les deux contacts EMS du fichier Excel. */
export const RAW_EMS_CONTACTS: readonly RawEmsContact[] = [
  { id: "ems-hichem", nom: "HICHEM EMS", role: "RAMASSEUR", telephone: "0697 38 88 81", remarque: "Passe ramasser le courrier." },
  {
    id: "ems-illoul",
    nom: "ILLOUL EMS",
    civilite: "Mme",
    role: "RECLAMATION",
    telephone: "0697 67 21 88",
    email: "illoul.m@ems.dz",
    remarque: "Pour toute réclamation, et quand Hichem n'est pas disponible.",
  },
];

/** Corrections de saisie évidentes, appliquées au nom d'une succursale (la ville est écrite autrement dans l'adresse ou ailleurs dans l'application). */
const TYPO_FIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bGHERDAIA\b/gi, "GHARDAÏA"],
  [/\bGHARDAIA\b/gi, "GHARDAÏA"],
  [/\bBOUZEREAH\b/gi, "BOUZAREAH"],
];

/** Nom de succursale nettoyé : espaces, puis fautes de saisie évidentes. */
export function cleanBranchName(value: string): string {
  return TYPO_FIXES.reduce((text, [pattern, fixed]) => text.replace(pattern, fixed), cleanText(value));
}

/** Nettoie une ligne brute de succursale (aucune donnée n'est inventée : un champ absent reste vide). */
export function cleanRawBranch(raw: RawBranch): BranchAddress {
  return {
    id: raw.id,
    compagnie: raw.compagnie,
    nom: cleanBranchName(raw.nom),
    contact: cleanPersonName(raw.contact ?? ""),
    telephones: cleanPhones(raw.telephones ?? ""),
    adresse: cleanText(raw.adresse),
    remarque: "",
  };
}

/** Première lettre de chaque mot en majuscule, le reste en minuscules (« HICHEM » devient « Hichem »). */
function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());
}

/** Nettoie un contact EMS brut : « HICHEM EMS » devient « Hichem », « ILLOUL EMS » devient « Mme Illoul ». */
export function cleanRawEms(raw: RawEmsContact): EmsContact {
  const person = titleCase(cleanPersonName(raw.nom).replace(/\s+EMS$/i, ""));
  return {
    id: raw.id,
    nom: raw.civilite ? `${raw.civilite} ${person}` : person,
    role: raw.role,
    telephone: cleanPhones(raw.telephone),
    email: cleanText(raw.email ?? "").toLowerCase(),
    remarque: cleanText(raw.remarque),
  };
}

/** Carnet de départ : valeurs par défaut du code tant que la clé `courrier:adresses` n'existe pas (la première modification les enregistre). */
export function buildDefaultBook(): AddressBook {
  return {
    branches: RAW_BRANCHES.map(cleanRawBranch),
    emsSociete: "EMS",
    emsContacts: RAW_EMS_CONTACTS.map(cleanRawEms),
  };
}
