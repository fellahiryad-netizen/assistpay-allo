import type { ModuleKey } from "@/features/access/types";

/** Entrée du menu latéral. */
export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Onglet du tableau des accès requis ; `admin` = réservé aux administrateurs. */
  module: ModuleKey | "admin" | "all";
}

/** Icônes disponibles pour le menu. */
export type NavIcon =
  | "dashboard"
  | "pilot"
  | "quality"
  | "credit"
  | "debit"
  | "partners"
  | "invoice"
  | "caar"
  | "bdg"
  | "request"
  | "transfer"
  | "bank"
  | "double"
  | "hr"
  | "users"
  | "journal"
  | "account";

/** Groupe du menu. */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Arborescence du menu, identique à celle de la version actuelle d'AssistPay. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Pilotage",
    items: [
      { href: "/", label: "Tableau de bord", icon: "dashboard", module: "DASH" },
      { href: "/pilotage", label: "Pilotage et clôture", icon: "pilot", module: "PILOT" },
      { href: "/controle", label: "Contrôle qualité", icon: "quality", module: "QC" },
    ],
  },
  {
    label: "Factures",
    items: [
      { href: "/factures?sens=CREDIT", label: "Factures clients", icon: "credit", module: "FCLI" },
      { href: "/factures?sens=DEBIT", label: "Factures fournisseurs", icon: "debit", module: "FFOUR" },
    ],
  },
  {
    label: "Ventes",
    items: [
      { href: "/partenaires", label: "Partenaires", icon: "partners", module: "PART" },
      { href: "/facturation", label: "Établir une facture", icon: "invoice", module: "FACT" },
      { href: "/caar", label: "CAAR production", icon: "caar", module: "CAAR" },
      { href: "/bdg", label: "BDG débours et frais", icon: "bdg", module: "BDG" },
    ],
  },
  {
    label: "Achats et banque",
    items: [
      { href: "/demandes", label: "Demandes de paiement", icon: "request", module: "DP" },
      { href: "/virements", label: "Virements et RIB", icon: "transfer", module: "VIR" },
      { href: "/releve", label: "Relevé bancaire", icon: "bank", module: "RELEVE" },
      { href: "/releve/rapprochement", label: "Double emploi", icon: "double", module: "FFOUR" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/rh", label: "RH (salaires)", icon: "hr", module: "RH" },
      { href: "/acces", label: "Utilisateurs et accès", icon: "users", module: "admin" },
      { href: "/journal", label: "Journal des actions", icon: "journal", module: "all" },
      { href: "/compte", label: "Mon compte", icon: "account", module: "all" },
    ],
  },
];

/** Garde seulement les entrées que l'utilisateur peut ouvrir . */
export function filterNav(groups: readonly NavGroup[], allows: (module: NavItem["module"]) => boolean): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => allows(item.module)) }))
    .filter((group) => group.items.length > 0);
}
