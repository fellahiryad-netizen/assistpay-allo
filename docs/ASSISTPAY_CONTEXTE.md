# AssistPay : contexte métier et feuille de route

Ce document sert de référence pour toute personne (ou toute IA) qui travaille sur AssistPay. Il explique à quoi sert l'outil, comment les données sont organisées et où se trouve chaque règle métier.

## 1. L'entreprise et l'usage

EURL ALLO ASSISTANCE (Chéraga, Alger) gère un réseau de prestataires d'assistance routière (véhicules légers et lourds) et de bris de glace pour le compte de compagnies d'assurance partenaires : CAAT, CAAR, GAM, TRUST, MLA, TPA… L'activité BDG (bris de glace) est suivie à part de l'assistance routière.

AssistPay remplace le classeur Excel « SUIVI_BANCAIRE_ALLO_ASSISTANCE » (un onglet par année, de 2023 à 2026). Il sert à :

- suivre les **factures partenaires** (crédit : honoraires facturés aux compagnies) et les **factures fournisseurs** (débit : prestataires, charges) ;
- savoir ce qui reste à encaisser, ce qui reste à payer, et depuis combien de temps ;
- établir les factures émises (GAM, TRUST BDG avec 800 DA HT de frais de gestion par dossier, CAAR à partir des fichiers de production des succursales…) ;
- produire les demandes de paiement et les fichiers de virements envoyés à la banque ;
- rapprocher le relevé bancaire avec les factures et les fichiers de virements.

Monnaie : dinar algérien (DA), deux décimales. Fuseau horaire : Africa/Algiers. Langue de l'interface : français.

## 2. Vocabulaire

| Terme | Sens |
| --- | --- |
| Sens **Crédit** | Facture partenaire : de l'argent qui rentre. Onglet « Factures partenaires ». |
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

Onglets du tableau des accès : DASH (tableau de bord), PILOT (pilotage et clôture), QC (contrôle qualité), FCLI (factures partenaires), FFOUR (factures fournisseurs), PART (partenaires), FACT (établir une facture), CAAR, BDG, DP (demandes de paiement), VIR (virements et RIB), RELEVE (relevé bancaire), RH.

Règle absolue : **le contrôle se fait dans les services**, à chaque appel. Masquer un bouton ne suffit jamais.

## 4. Modèle de données (PostgreSQL)

Le schéma complet est dans `prisma/schema.prisma`. Chaque table reprise de l'ancienne version garde l'identifiant d'origine dans `legacyId`, ce qui rend l'import rejouable.

| Table | Contenu | Ancienne collection |
| --- | --- | --- |
| User, UserModuleAccess | Comptes, profils, exceptions d'accès | utilisateurs (+ config/comptes.json pour les mots de passe) |
| Invoice | Factures partenaires et fournisseurs | factures + archives (lot1 à lot3) |
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
| CAAT Régul 10 % | `features/regul/services/regul-engine.ts`, `regul-store.ts`, `regul-export.ts` | Avance 90 % HT ; régule = 10 % HT + TVA 19 % sur 100 % de la régule ; facture préremplie via le modèle `c_regul` |
| CAAR Régul 10 % | `features/caar-regul/services/caar-regul-engine.ts`, `caar-regul-store.ts`, `caar-regul-export.ts`, `features/caar-regul/lib/caar-conso-reader.ts` | Avance 90 % réglée **TTC** ; travail en HT ; TVA 19 % sur l'écart seulement ; formule Tunisie à 0 ; facture préremplie via le modèle `r_regul` (voir § 6 bis) |
| BDG | `features/bdg/services/bdg-service.ts` | Facture soldée quand débours et frais sont réglés |
| Partenaires | `features/partners/services/partner-service.ts` | Regroupement des catégories par partenaire, délai médian, relances |
| Pilotage | `features/pilot/services/pilot-service.ts`, `backup-service.ts` | Délai réel pondéré sur 13 mois, balance âgée, trésorerie 90 jours, marges par activité |
| Contrôle qualité | `features/quality/services/quality-service.ts` | Neuf règles reprises de l'ancienne version |
| RH | `features/hr/services/hr-service.ts` | Mois de rattachement, groupes (salaires, CNAS, G50, autres), report mensuel dans le suivi |
| Paramètres | `features/settings/services/settings-service.ts` | Réglage `controle` |

## 6 bis. Régularisation 10 % : CAAT et CAAR ne se calculent pas de la même façon

Les deux compagnies versent une avance de 90 % sur la production du mois, puis la succursale renvoie son fichier de production « définitif » et ALLO facture le solde. La différence tient à la TVA de l'avance.

| | CAAT (`/regul`) | CAAR (`/caar-regul`) |
| --- | --- | --- |
| Avance 90 % | Réglée HT | Réglée **TTC** : avance HT = montant TTC de la facture d'avance ÷ 1,19 |
| Montant régule | Part assisteur du fichier de la succursale | Allo 47 % de la prime HT du fichier de la succursale (non arrondi ligne par ligne) |
| Écart / complément | Régule − avance HT | Régule − avance HT (peut être négatif : rien à facturer) |
| TVA 19 % | Sur **100 %** de la régule | Sur **l'écart seulement** (la TVA de l'avance a déjà été payée) |
| À facturer TTC | Complément + TVA sur la régule | Écart + TVA sur l'écart |
| Présentation | HT | HT : la CAAR n'accepte pas une régule présentée en TTC |
| Période | Mois, trimestre ou semestre | 2026 : de mai (début du partenariat) à décembre, mois par mois ; à partir de 2027 : trimestre par trimestre |

Règles propres à la CAAR :

- **Source de l'avance** (dans cet ordre) : saisie manuelle ; sinon la **facture d'avance du suivi des factures partenaires** (catégorie CAAR, succursale lue dans le tiers, mois lu dans la période ou dans « MOIS DE … » du libellé, hors Direction, régularisations et refacturations), avec son état de règlement (paiement vérifié) ; sinon RECAP FACTURES du consolidé ; sinon la Part Assisteur 90 % des lignes du consolidé (`avanceSuivi`, `avanceOf`). Un écart entre le suivi et RECAP FACTURES est signalé ; c'est le suivi qui est retenu.
- **Sans consolidé**, le calcul reste juste : Montant Total = avance HT ÷ 0,90, et la comparaison police par police est désactivée (sinon toutes les polices paraîtraient « nouvelles »).
- **Cinq succursales** : Alger Chéraga, Alger Bouzaréah, Constantine, Annaba, Oran (`CAAR_SUCCURSALES`).
- **Formule « Assistance TUNISIE »** : toujours à 0 DA. Si une ligne porte un montant (dans le fichier de la succursale ou dans l'avance), elle est ramenée à 0 et signalée (alerte à l'écran et onglet « ALERTE Tunisie » de l'export).
- **Polices dont la date d'effet précède le mois** : elles restent comptées (la prime est encaissée).
- **Quittances non encaissées** (colonne ÉTAT différente de « ENCAISSÉ ») : non comptées, listées.
- **Liste « polices exclues » placée sous le total** du fichier (cas d'Oran) : reprise, dédoublonnée et classée « Police réintégrée ».
- **Mois d'un onglet** : lu dans le nom de l'onglet, sinon dans le nom du fichier, sinon dans la majorité des dates d'effet ; un onglet sans mois est ignoré si un autre onglet du fichier en a un.
- **Comparaison police par police** (agrégée par mois et numéro de police de base) : nouvelle police, police réintégrée, montant modifié (dont « double 47 % »), police retirée, n° de police corrigé (même assuré, même montant).
- **Comparaison par agence** : les codes du consolidé sont alignés sur ceux de la succursale par suffixe unique (ex. 702 → 74702).
- **Annulations** : primes négatives ; un changement de formule sur la même immatriculation n'est pas une annulation ; croisement avec la base activité sur la clé « police | immatriculation » pour repérer les annulées ayant eu un sinistre.

Données (table `Setting`) : `caarregul:index` (mois, factures d'avance de RECAP FACTURES, formules), `caarregul:base:SUCC:AAAA-MM` (lignes du consolidé), `caarregul:sinistres` (clés de la base activité), `caarregul:saisie:SUCC-AAAA-MM` (avance corrigée à la main), `caarregul:res:SUCC-AAAA-MM` (résultat enregistré pour le suivi).

L'export Excel (sans onglet Méthodologie) contient : Feuil1 (Montant Total, Somme Avance, Montant Régule, ECARTS HT, TVA, Part Assisteur TTC, avec formules), Écart, Détail par agence, Polices Annulées, Changement Garantie, ALERTE Annulée+Sinistre, ALERTE Tunisie, Polices réintégrées, Polices non comptées et le détail du fichier. L'écran génère aussi le mail d'accompagnement. Le bouton « Créer la facture » ouvre la Facturation sur le modèle `r_regul` (une ligne par mois) ; à l'enregistrement, la facture rejoint les **factures partenaires en attente**.

## 7. Feuille de route de la reconstruction

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Fondations, base complète, import des données, connexion, rôles et tableau des accès, journal, tableau de bord, factures partenaires et fournisseurs | **Livrée** |
| 2 | Relevé bancaire : import Excel, rapprochement automatique avec les factures et les fichiers de virements, doubles emplois à valider | **Livrée** |
| 3 | Demandes de paiement : import du fichier DP, numérotation, lien avec les factures, fiche imprimable | **Livrée** |
| 4 | Virements et RIB : état des virements par produit (AR / BDG), découpage au-delà de 1 000 000 DA, RIB manquants ou modifiés, contrôle de fichier, export au format banque | **Livrée** |
| 5 | Ventes : partenaires et relances, facturation (GAM, TRUST BDG 800 DA HT par dossier, CAAR 47 % / 90 %), contrôle des productions CAAR, suivi BDG, impression PDF | **Livrée** |
| 6 | Pilotage, clôture, paramètres, sauvegarde et contrôle qualité | **Livrée** |
| 7 | RH (salaires, remboursements), accès RH, report mensuel dans le suivi | **Livrée** |
| 8 | Régularisations 10 % : CAAT Régul 10 % et CAAR Régul 10 % (consolidé ALLO & CAAR, base activité, suivi 2026 par mois puis par trimestre, export, mail, facture préremplie) | **Livrée** |

Pistes pour la suite : passer SheetJS à la version 0.20.3 (voir LISEZMOI, § 7) ; écran d'édition du barème CAAR (aujourd'hui lu dans le réglage `caar`, repris de l'ancienne version) ; harmonisation automatique des catégories (outil « Qualité des données » de l'ancienne version, non repris).

La version en un seul fichier (`AssistPay.html`) reste la référence fonctionnelle en cas de doute sur une règle de calcul, un libellé ou un format de fichier.
