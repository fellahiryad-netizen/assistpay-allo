# AssistPay 2 : installation sur le serveur de l'entreprise

Cette nouvelle version d'AssistPay repose sur Next.js, PostgreSQL et Prisma. Elle reprend **tous les modules** de la version actuelle :

| Menu | Ce qu'on y fait |
| --- | --- |
| Tableau de bord | Créances, dettes, encaissements du mois, alertes |
| Pilotage et clôture | Liste de clôture du mois, balance âgée et délais réels de paiement, prévision de trésorerie à 90 jours, rentabilité par activité, paramètres de contrôle, sauvegarde complète (Excel ou JSON) |
| Contrôle qualité | Factures sans date ou sans n°, lignes sans catégorie, dates impossibles, BDG non répartis, paiements partiels, écarts, doublons, double emploi |
| Factures clients / fournisseurs | Liste, filtres, ajout, modification, règlement (y compris partiel et BDG débours / frais) |
| Partenaires | Solde dû, délais médians, prévision, fiche par succursale, lettre de relance (PDF), relevé de compte (Excel) |
| Établir une facture | Tous les modèles du fichier de facturation (GAM, TRUST, MLA, CAAT, CAAR 47 % / 90 %, BDG 800 DA HT par dossier…), aperçu en direct, impression PDF, rectification par un administrateur avec motif |
| CAAR production | Contrôle du fichier de chaque succursale (anomalies, barème, doublons, total déclaré), TCD par agence, message à la succursale, facture en un clic |
| BDG débours et frais | Suivi des encaissements des débours et des frais de gestion, règlement séparé |
| Demandes de paiement | Import du fichier DP, création depuis les factures, fiche A4 imprimable, lien avec les factures |
| Virements et RIB | État des virements par produit (AR / BDG), découpage au-delà de 1 000 000 DA, contrôle d'un fichier de virements, référentiel RIB avec validation des changements, export au format de la banque |
| Relevé bancaire | Import Excel, rapprochement automatique (factures, combinaisons, fichiers de virements), frais bancaires et paie reconnus, historique ; écran « Double emploi » |
| RH (salaires) | Salaires, CNAS / CASNOS, G50 / IRG, avances : saisie, synthèse mensuelle, export ; le total du mois est reporté dans le suivi |
| Utilisateurs et accès, Journal, Mon compte | Profils, accès onglet par onglet, traçabilité |

Toutes les données de la version actuelle sont importées. La version actuelle (`assistpay-serveur`) peut continuer à tourner en parallèle pendant la période de rodage.

**Hébergement Supabase + Vercel** : suivre pas à pas `docs/DEPLOIEMENT_SUPABASE.md`. Les sections ci-dessous concernent l'installation sur un serveur de l'entreprise.

**Avant l'installation** : lire `docs/REVUE_CRITIQUE.md` (points à traiter avant la mise en service).

## 1. Prérequis

- Node.js 20.19 ou plus récent (22 LTS conseillé) ;
- PostgreSQL 14 ou plus récent, avec une base et un utilisateur dédiés ;
- un accès à Internet pendant l'installation (paquets npm et binaires Prisma).

```sql
CREATE USER assistpay WITH PASSWORD 'mot-de-passe-solide';
CREATE DATABASE assistpay OWNER assistpay;
```

## 2. Installation

```bash
cd assistpay
cp .env.example .env        # puis renseigner DATABASE_URL et SESSION_SECRET
npm install                 # installe et génère le client Prisma
npm run db:migrate          # crée les tables
```

`SESSION_SECRET` : une longue chaîne aléatoire, par exemple `openssl rand -base64 48`. Ne la changez plus ensuite, sinon tout le monde est déconnecté.

**Contrôle conseillé de la migration.** Le fichier `prisma/migrations/0001_init/migration.sql` a été écrit à la main, car l'environnement de préparation n'avait pas accès aux binaires Prisma. Il a été testé sur PostgreSQL. Juste après `npm run db:migrate`, vérifiez que la base créée correspond exactement au schéma :

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

La commande ne doit afficher qu'un commentaire « This is an empty migration ». Si elle propose des instructions SQL, envoyez-les-moi : je corrige la migration avant toute reprise des données.

## 3. Reprise des données

Copiez depuis le serveur actuel `data/db.json` et `config/comptes.json`, puis lancez :

```bash
npm run db:import -- chemin/vers/db.json --comptes chemin/vers/comptes.json
```

L'import affiche le nombre de lignes reprises par table et écrit `rapport-import.json`, qui liste ce qui a été écarté et pourquoi. On peut le relancer sans créer de doublon : les lignes déjà présentes sont mises à jour.

Les mots de passe déjà définis dans `comptes.json` restent valables (même méthode de chiffrement). Si l'administrateur n'en a pas encore :

```bash
npm run user -- motdepasse rfellahi@alloassistance.dz "UnMotDePasseSolide"
npm run user -- lister
```

Les autres comptes se créent ensuite dans l'application, depuis « Utilisateurs et accès ».

## 4. Lancement

```bash
npm run build
npm start                   # écoute sur le port 3000 (PORT=xxxx pour changer)
```

Pour que l'application tourne en permanence :
- sous Linux, un service systemd (`ExecStart=/usr/bin/npm start`, `WorkingDirectory=` le dossier du projet) ;
- sous Windows, NSSM ou pm2.

Placez un nginx (ou IIS) devant, en HTTPS. Mettez alors `COOKIE_SECURE="true"` dans `.env`.

Supervision : `GET /api/health` renvoie 200 si la base répond, 503 sinon.

Sauvegarde : un `pg_dump` quotidien de la base, par exemple `pg_dump -Fc assistpay > assistpay-AAAAMMJJ.dump`. En complément, « Pilotage › Paramètres et sauvegarde » télécharge toutes les données en Excel lisible ou en JSON (à faire chaque fin de mois).

À faire une fois après l'installation, depuis « Pilotage › Paramètres et sauvegarde » (administrateur) : renseigner le n° d'article d'imposition d'Allo Assistance (il s'imprime ensuite sur les factures) et vérifier le seuil de double validation des virements (2 000 000 DA par défaut).

## 5. Organisation du code

```text
prisma/                 schéma, migrations
scripts/                import des anciennes données, gestion des comptes
src/app/(app)           pages de l'application (une route par module, avec loading.tsx et error.tsx)
src/app/(print)         pages d'impression sans menu (demandes de paiement, factures, lettres de relance)
src/app/actions         server actions (runAction / runUploadAction)
src/app/api             téléchargements (virements, relevé partenaire, RH, sauvegarde) et /api/health
src/components/ui       boutons, champs, tableaux, fenêtres (Radix / shadcn)
src/components/common   menu latéral, en-tête, messages d'état, pagination
src/features/<module>   components, services (logique et base), schemas (Zod), types, hooks
src/lib                 env typé, client Prisma, session, mots de passe, lecture/écriture Excel (SheetJS)
docs/                   règles d'architecture, contexte métier et feuille de route
```

Les règles à respecter pour toute évolution sont dans `docs/ai_system_rules.md`, et les consignes pour l'IA dans `CLAUDE.md`.

## 6. Vérifications faites avant livraison

- `tsc --noEmit` et `next build` sans erreur ; toutes les pages s'ouvrent sans erreur (29 routes testées) ; pas de défilement horizontal sur téléphone ;
- migration appliquée sur PostgreSQL ; import complet de la base actuelle, avec des totaux par sens et par état identiques au centime ; second import sans doublon ;
- tests dans le navigateur, module par module :
  - connexion, accès, journal, factures (règlement, ajout, refus d'un doublon) ;
  - relevé : import d'un relevé, proposition validée, frais bancaires écartés, paie reconnue, ajout au suivi, rapprochement d'un fichier de virements (14 lignes) ;
  - demandes de paiement : import de 3 demandes, état des virements avec découpage (1 250 000 DA en 2 × 625 000), saisie d'un RIB manquant, fichier VRMNT_ASSIS conforme au format de la banque, envoi validé ;
  - CAAR : contrôle d'un fichier (doublon, agence manquante, ligne de total, formule Tunisie, prime hors barème, écart avec le total déclaré), facture créée depuis la production et production marquée « facturée » ;
  - BDG : règlement des débours ; partenaires : fiche, lettre de relance ;
  - pilotage : les cinq onglets, enregistrement des paramètres (l'article d'imposition apparaît sur la facture), sauvegardes Excel et JSON ;
  - RH : saisie, modification, export, suppression, avec mise à jour du total mensuel reporté dans le suivi ;
  - compte « Chargé de facturation » : pilotage, RH et sauvegarde refusés.

## 7. Point à connaître : bibliothèque Excel

La lecture et l'écriture des fichiers Excel utilisent SheetJS `xlsx` 0.18.5, la dernière version publiée sur npm. Deux failles connues la concernent (CVE-2023-30533 et CVE-2024-22363) quand on ouvre un fichier piégé. Le risque est limité ici (seuls des utilisateurs connectés déposent des fichiers, 8 Mo au maximum), mais il est conseillé de passer à la version corrigée, distribuée par l'éditeur hors npm :

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm run typecheck && npm run build
```
