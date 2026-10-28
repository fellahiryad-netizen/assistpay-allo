# AssistPay 2 : revue critique avant mise en production

État au 26/10/2026. Ce document liste ce qui n'est pas encore au niveau d'une application de production, pour que le développeur qui installe AssistPay sur le serveur de l'entreprise sache où regarder. Classement : 🔴 à traiter avant la mise en service, 🟠 à traiter dans le premier mois, ⚪ à savoir.

## Corrigé le 26/10/2026

- Connexion : après 5 mots de passe faux en 15 minutes, l'adresse est bloquée 15 minutes (`features/auth/services/auth-service.ts`). Le compteur est en mémoire : valable pour un seul processus Node.
- En-têtes de sécurité ajoutés dans `next.config.ts` : `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.
- Taille des fichiers déposés alignée sur la limite des server actions (4 Mo).
- Création d'un compte : choix de l'accès à chaque onglet dès la création.

## 🔴 Avant la mise en service

1. **Migration écrite à la main.** `prisma/migrations/0001_init/migration.sql` n'a pas été générée par Prisma (binaires inaccessibles pendant le développement). Elle a été appliquée et testée sur PostgreSQL, mais il faut lancer après `npm run db:migrate` : `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, qui doit répondre « empty migration ».
2. **Bibliothèque Excel vulnérable.** `xlsx` 0.18.5 (dernière version sur npm) a deux failles connues (CVE-2023-30533, CVE-2024-22363) à l'ouverture d'un fichier piégé. Passer à la version de l'éditeur : `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
3. **HTTPS obligatoire.** Servir l'application derrière nginx ou IIS en HTTPS et mettre `COOKIE_SECURE="true"`. Sans HTTPS, le cookie de session circule en clair.
4. **Sauvegarde de la base.** `pg_dump` quotidien, copié hors du serveur, avec un essai de restauration. C'est la seule copie des données une fois l'ancienne version arrêtée.
5. **Aucun test automatisé dans le dépôt.** Tout a été vérifié par des parcours dans le navigateur (connexion, factures, relevé, demandes de paiement, virements, CAAR, BDG, pilotage, RH, comptes), mais ces scripts ne sont pas livrés. Le développeur doit au minimum refaire ces parcours sur une copie des données avant la bascule.

## 🟠 Dans le premier mois

6. **Sessions non révocables.** La session est un jeton signé valable 12 h. Désactiver un compte coupe bien l'accès immédiatement (le compte est relu à chaque requête), mais changer son mot de passe ne déconnecte pas les autres appareils. À ajouter : un compteur de version de session sur `User`, vérifié à chaque requête.
7. **Pas d'en-tête Content-Security-Policy.** Next.js injecte des scripts en ligne ; une CSP demande des « nonces ». À mettre en place avec le middleware.
8. **Modifications simultanées.** Si deux personnes modifient la même facture en même temps, la dernière enregistrée gagne, sans avertissement. À ajouter : comparaison de `updatedAt` à l'enregistrement.
9. **Numéros de facture.** L'unicité du n° de facture émise est contrôlée par l'application, pas par la base. Deux enregistrements à la même seconde pourraient prendre le même numéro. Ajouter une contrainte unique sur `IssuedInvoice.num` (+ client) après nettoyage des doublons existants.
10. **Volume.** Plusieurs écrans (pilotage, contrôle qualité, partenaires, RH) chargent toutes les factures en mémoire pour calculer. Très bien pour quelques milliers de lignes (2 200 aujourd'hui) ; à revoir en SQL agrégé au-delà de 50 000.
11. **Blocage des connexions en mémoire.** Si l'application tourne un jour sur plusieurs processus (pm2 cluster, plusieurs serveurs), déplacer le compteur d'échecs en base.
12. **Journal.** Les actions métier sont journalisées, mais pas les consultations (qui a ouvert les salaires). À ajouter si la direction le demande.

## Écarts fonctionnels avec la version actuelle (fichier unique)

Ces fonctions existent dans l'AssistPay actuel et ne sont pas encore reprises :

- **CAAR** : correction ligne par ligne dans l'écran de contrôle (codes agence proposés, lignes de total à retirer), export du fichier corrigé, écran de modification du barème. Le contrôle, le TCD et la facture sont repris.
- **CAAR** : la détection intelligente et l'affiliation d'une facture à une case vide (ajoutées le 26/10 dans la version actuelle).
- **Partenaires** : panneau des avances CAAT, rapport mensuel PDF, encadré des écarts de règlement.
- **Import en masse** des factures fournisseurs (canevas Excel).
- **Portail partenaires** (un partenaire qui consulte ses propres factures) : le profil existe mais n'ouvre rien.
- **Harmonisation automatique** des catégories, tiers et natures.
- **Notifications** de l'administrateur.

## À savoir

- Les montants sont stockés en `Decimal(14,2)` mais les calculs se font en nombres JavaScript arrondis au centime (`round2`) : pas d'écart constaté sur l'import (totaux identiques au centime), à garder en tête pour de nouveaux calculs.
- Les champs de l'ancienne version non exploités sont conservés en JSON (`extra`, `payload`) : ne jamais les supprimer lors d'une migration.
- L'import (`npm run db:import`) est rejouable mais ne supprime pas : une facture effacée dans l'ancienne version après un premier import reste dans la nouvelle. Pour la bascule définitive : base vide, puis un seul import du dernier export.
