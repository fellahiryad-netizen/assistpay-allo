# AssistPay : contexte métier et feuille de route

Ce document sert de référence pour toute personne (ou toute IA) qui travaille sur AssistPay. Il explique à quoi sert l'outil, comment les données sont organisées et où se trouve chaque règle métier.

## 1. L'entreprise et l'usage

EURL ALLO ASSISTANCE (Chéraga, Alger) gère un réseau de prestataires d'assistance routière (véhicules légers et lourds) et de bris de glace pour le compte de compagnies d'assurance partenaires : CAAT, CAAR, GAM, TRUST, MLA, TPA… L'activité BDG (bris de glace) est suivie à part de l'assistance routière.

AssistPay remplace le classeur Excel « SUIVI_BANCAIRE_ALLO_ASSISTANCE » (un onglet par année, de 2023 à 2026). Il sert à :

- suivre les **factures clients** (crédit : honoraires facturés aux compagnies) et les **factures fournisseurs** (débit : prestataires, charges) ;
- savoir ce qui reste à encaisser, ce qui reste à payer, et depuis combien de temps ;
- établir les factures émises (GAM, TRUST BDG avec 800 DA HT de frais de gestion par dossier, CAAR à partir des fichiers de production des succursales…) ;
- produire les demandes de paiement et les fichiers de virements envoyés à la banque ;
- rapprocher le relevé bancaire avec les factures et les fichiers de virements.

Monnaie : dinar algérien (DA), deux décimales. Fuseau horaire : Africa/Algiers. Langue de l'interface : français.

## 2. Vocabulaire

| Terme | Sens |
| --- | --- |
| Sens **Crédit** | Facture client : de l'argent qui rentre. Onglet « Factures clients ». |
| Sens **Débit** | Facture fournisseur ou charge : de l'argent qui sort. Onglet « Factures fournisseurs ». |
| État | En attente, Réglé, Annulé. |
| Date d'opération | Date de règlement quand la facture est réglée (dans l'ancienne version : champ `date`). |
| Catégorie | Client ou famille de dépense (CAAT, GAM BDG, Prestataire BDG, Prestataire assistance routière…). |
| Débours / frais | Pour le BDG : montant remboursé au prestataire + frais de gestion facturés. |
| DP | Demande de paiement d'un prestataire (numérotée, ex. « 1292/2026AS »). |
| Fichier de virements | Fichier Excel remis à la banque AGB : une ligne D (compte ALLO 032 00001 2737851208 90), puis une ligne C par prestataire. Pas plus de 1 000 000 DA par virement : au-delà, on découpe en parts égales. AR (assistance routière) et BDG sont toujours dans des fichiers séparés. |
| RIB | 20 chiffres : banque (3), agence (5), compte (10), clé (2). |
| Ligne de paie | Salaires, CNAS, G50, IRG : visibles seulement avec l'accès RH. |

## 3. Accès

Chaque personne a un **profil** qui fixe ses accès par défaut. L'administrateur peut ensuite choisir, onglet par onglet, « Aucun accès », « Consultation » ou « Modification ».

| Profil | Accès par défaut |
| --- | --- |
| Administrateur, Direction | Tout, sans exception possible |
| Comptable | Tout en modification |
| Équipe facturation | Tout sauf RH |
| Chargé de facturation | Tableau de bord en consultation ; ni pilotage, ni relevé bancaire, ni RH ; le reste en modification |
| RH | RH seulement |
| Partenaire | Rien |

Onglets du tableau des accès : DASH (tableau de bord), PILOT (pilotage et clôture), QC (contrôle qualité), FCLI (factures clients), FFOUR (factures fournisseurs), PART (partenaires), FACT (établir une facture), CAAR, BDG, DP (demandes de paiement), VIR (virements et RIB), RELEVE (relevé bancaire), RH.

Règle absolue : **le contrôle se fait dans les services**, à chaque appel. Masquer un bouton ne suffit jamais.

## 4. Modèle de données (PostgreSQL)

Le schéma complet est dans `prisma/schema.prisma`. Chaque table reprise de l'ancienne version garde l'identifiant d'origine dans `legacyId`, ce qui rend l'import rejouable.

| Table | Contenu | Ancienne collection |
| --- | --- | --- |
| User, UserModuleAccess | Comptes, profils, exceptions d'accès | utilisateurs (+ config/comptes.json pour les mots de passe) |
| Invoice | Factures clients et fournisseurs | factures + archives (lot1 à lot3) |
| BankStatementLine | Lignes du relevé bancaire et leur statut de rapprochement | releve |
| PaymentRequest | Demandes de paiement | dp + dparchives |
| IssuedInvoice | Factures émises (détail dans `payload`) | facturation |
| CaarProduction, CaarProductionChunk | Production CAAR par succursale et par mois | caarprod, caarprodrows |
| ProviderRib | RIB des prestataires | virribs |
| TransferBatch | Fichiers de virements envoyés à la banque | virenvois |
| HrEntry | Paie et remboursements RH | rh |
| Reminder | Relances envoyées aux partenaires | relances |
| JournalEntry | Journal des actions (`admin = true` pour le journal réservé) | journal, journaladmin |
| Setting | Réglages : `caar` (barème CAAR), `controle` (seuil de double validation, article d'imposition), `general` (créance antérieure) | reglages |

Les champs secondaires de l'ancienne version sont conservés dans les colonnes JSON `extra` ou `payload` (paiements partiels, règlement séparé des débours et des frais, groupes de règlement, écarts, détail des factures émises…). Rien n'est perdu.

Lignes particulières de `Invoice` :
- `rhagg-AAAA-MM-d|c-classe` : total mensuel des charges de personnel, recalculé par `syncHrAggregates` à chaque saisie RH (catégorie « Charges de personnel (agrégé) », `payroll = true`) ;
- les factures émises depuis « Établir une facture » créent une ligne Crédit en attente, liée par `IssuedInvoice.invoiceLegacyId`.

Chiffres de l'import de contrôle (base au 25/10/2026) :
- 2 202 factures. Les totaux par sens et par état sont identiques au centime près à ceux de l'ancienne version. Une ligne vide, sans sens, a été écartée.
- 570 lignes de relevé ;
- 561 demandes de paiement ;
- 362 RIB ;
- 63 fichiers de virements ;
- 162 écritures RH ;
- 630 lignes de journal.

## 5. Conventions de code

Les règles complètes sont dans `docs/ai_system_rules.md`. En résumé, telles qu'elles sont appliquées ici :

- **Stack** : Next.js 15 (App Router), TypeScript strict, Tailwind et primitives Radix/shadcn, Zod, Prisma 7 avec l'adaptateur `pg`, Zustand uniquement pour l'état partagé entre composants éloignés (par exemple le menu mobile).
- **Accès à la base** : uniquement dans `src/features/<module>/services/`. Les pages appellent un service, jamais Prisma.
- **Résultats** : chaque service et chaque server action renvoie un `ActionResult<T>` (`src/types/index.ts`), sans laisser échapper d'exception.
- **Server actions** : dans `src/app/actions/`, elles passent par `runAction` (session, validation Zod, try/catch), appellent le service puis `revalidatePath`.
- **Mises à jour à l'écran** : `useOptimistic` pour un retour immédiat (régler une facture, changer un accès).
- **Fichiers de route** : chaque dossier de route a son `loading.tsx` (squelettes) et son `error.tsx`.
- **Configuration** : `src/lib/env.ts` (@t3-oss/env-nextjs). Aucun `process.env` dans l'application.
- **Montants** : `Decimal(14,2)` en base, convertis en nombre au centime près dans les mappers.
- **Dates** : type `DATE` en base, `AAAA-MM-JJ` dans les objets envoyés à l'interface.
- **Journal** : toute modification métier appelle `logAction`.

## 6. Où se trouve chaque règle métier

| Module | Service principal | Points clés |
| --- | --- | --- |
| Factures | `features/invoices/services/invoice-service.ts`, `invoice-balance.ts` | `settle` : règlement total, partiel, débours / frais (BDG) ; reste à payer |
| Relevé | `features/statement/services/statement-parser.ts`, `statement-matching.ts`, `statement-service.ts`, `double-entry-service.ts` | Clé de ligne identique à l'ancienne version ; propositions par n° de facture, montant, combinaison, fichier de virements |
| Demandes de paiement | `features/payment-requests/services/` | Lecture du fichier DP par cellules (E4, D10, D13…) ; numérotation `0815/2026AS` |
| Virements et RIB | `features/transfers/services/rib.ts`, `transfer-check.ts`, `transfer-service.ts`, `rib-service.ts` | Compte donneur AGB, plafond 1 000 000 DA par virement, seuil mensuel paramétrable, clé RIB mod 97, format banque (ligne D puis lignes C) |
| Facturation | `features/billing/config.ts`, `billing-calc.ts`, `billing-service.ts` | Modèles, numérotation continue, BDG en paire débours / frais, rectification avec versions |
| CAAR | `features/caar/services/caar-engine.ts`, `caar-service.ts` | Colonnes reconnues automatiquement, barème (durées 1/3/6/12 mois, prorata, avenant 200 DA, flotte), part ALLO 47 %, avance 90 %, TVA 19 % |
| BDG | `features/bdg/services/bdg-service.ts` | Facture soldée quand débours et frais sont réglés |
| Partenaires | `features/partners/services/partner-service.ts` | Regroupement des catégories par partenaire, délai médian, relances |
| Pilotage | `features/pilot/services/pilot-service.ts`, `backup-service.ts` | Délai réel pondéré sur 13 mois, balance âgée, trésorerie 90 jours, marges par activité |
| Contrôle qualité | `features/quality/services/quality-service.ts` | Neuf règles reprises de l'ancienne version |
| RH | `features/hr/services/hr-service.ts` | Mois de rattachement, groupes (salaires, CNAS, G50, autres), report mensuel dans le suivi |
| Paramètres | `features/settings/services/settings-service.ts` | Réglage `controle` |

## 7. Feuille de route de la reconstruction

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Fondations, base complète, import des données, connexion, rôles et tableau des accès, journal, tableau de bord, factures clients et fournisseurs | **Livrée** |
| 2 | Relevé bancaire : import Excel, rapprochement automatique avec les factures et les fichiers de virements, doubles emplois à valider | **Livrée** |
| 3 | Demandes de paiement : import du fichier DP, numérotation, lien avec les factures, fiche imprimable | **Livrée** |
| 4 | Virements et RIB : état des virements par produit (AR / BDG), découpage au-delà de 1 000 000 DA, RIB manquants ou modifiés, contrôle de fichier, export au format banque | **Livrée** |
| 5 | Ventes : partenaires et relances, facturation (GAM, TRUST BDG 800 DA HT par dossier, CAAR 47 % / 90 %), contrôle des productions CAAR, suivi BDG, impression PDF | **Livrée** |
| 6 | Pilotage, clôture, paramètres, sauvegarde et contrôle qualité | **Livrée** |
| 7 | RH (salaires, remboursements), accès RH, report mensuel dans le suivi | **Livrée** |

Pistes pour la suite : passer SheetJS à la version 0.20.3 (voir LISEZMOI, § 7) ; écran d'édition du barème CAAR (aujourd'hui lu dans le réglage `caar`, repris de l'ancienne version) ; harmonisation automatique des catégories (outil « Qualité des données » de l'ancienne version, non repris).

La version en un seul fichier (`AssistPay.html`) reste la référence fonctionnelle en cas de doute sur une règle de calcul, un libellé ou un format de fichier.
