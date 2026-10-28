# Mettre AssistPay 2 en ligne : Supabase + Vercel

Supabase héberge la base PostgreSQL ; Vercel fait tourner l'application (Next.js). Les comptes AssistPay restent gérés par AssistPay lui-même (« Utilisateurs et accès ») : on n'utilise pas les comptes Supabase.

Compter environ deux heures la première fois. Il faut un PC Windows (ou Mac) avec Internet, et le fichier d'export des données fourni par Claude (`assistpay-export-AAAA-MM-JJ.json`).

---

## Partie A. Créer la base sur Supabase

1. Aller sur https://supabase.com, cliquer **Start your project** et créer un compte (avec l'adresse de l'entreprise). Activer tout de suite la double authentification : avatar en haut à droite › **Account preferences** › **Security**.
2. **New project** :
   - Organization : celle proposée (ou « Allo Assistance ») ;
   - Project name : `assistpay` ;
   - Database password : cliquer **Generate a password**, puis le **copier dans un endroit sûr**. Conseil : garder uniquement des lettres et des chiffres (un mot de passe avec `@`, `#`, `/`… doit être encodé dans l'adresse de connexion) ;
   - Region : **Central EU (Frankfurt)** (ou West EU (Paris)), la plus proche d'Alger ;
   - **Create new project**, puis attendre deux minutes.
3. Récupérer les adresses de connexion : bouton **Connect** en haut de la page du projet.
   - Copier la chaîne **Transaction pooler** (port **6543**). Elle ressemble à :
     `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
   - Copier aussi la chaîne **Session pooler** (même adresse, port **5432**).
   - Dans les deux, remplacer `[YOUR-PASSWORD]` par le mot de passe de l'étape 2 (sans les crochets).

## Partie B. Préparer sur le PC et remplir la base

4. Installer **Node.js 22 LTS** depuis https://nodejs.org (bouton LTS, installation par défaut).
5. Décompresser `assistpay-v2.zip`, par exemple dans `C:\assistpay`. Ouvrir ce dossier dans l'Explorateur, taper `powershell` dans la barre d'adresse et valider : une fenêtre de commande s'ouvre dans le bon dossier.
6. Créer le fichier de configuration : copier `.env.example` en `.env` (`copy .env.example .env`), puis l'ouvrir avec le Bloc-notes et remplir :
   ```
   DATABASE_URL="<chaîne Transaction pooler, port 6543>?sslmode=require&uselibpqcompat=true"
   DIRECT_URL="<chaîne Session pooler, port 5432>?sslmode=require"
   SESSION_SECRET="<voir ci-dessous>"
   SESSION_TTL_HOURS="12"
   COOKIE_SECURE="false"
   ```
   Pour `SESSION_SECRET`, taper dans PowerShell :
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`
   et coller le résultat. Le garder : il servira aussi sur Vercel.
7. Installer : `npm install` (quelques minutes).
8. Créer les tables : `npm run db:migrate`. Dans Supabase › **Table Editor**, les tables `Invoice`, `User`… apparaissent.
   *Si la commande échoue* : Supabase › **SQL Editor** › New query, coller tout le contenu de `prisma/migrations/0001_init/migration.sql`, **Run**, puis taper `npx prisma migrate resolve --applied 0001_init`.
9. Fermer l'API publique de Supabase (AssistPay ne l'utilise pas) : **SQL Editor** › New query, coller le contenu de `prisma/sql/supabase-securite.sql`, **Run**. Puis **Project Settings › Data API** : désactiver **Enable Data API** si l'option est proposée.
10. Importer les données : copier le fichier d'export dans le dossier, puis
    `npm run db:import -- assistpay-export-2026-10-26.json`
    Le tableau final donne le nombre de lignes reprises ; `rapport-import.json` liste ce qui a été écarté (normalement une seule ligne vide). L'import peut être relancé sans doublon : le jour de la bascule, demander un export à jour et relancer la même commande.
11. Les deux comptes administrateurs (tous les droits) :
    ```
    npm run user -- motdepasse rfellahi@alloassistance.dz "UnMotDePasseSolide"
    npm run user -- ajouter ahamadas@alloassistance.dz Prénom HAMADAS ADMINISTRATEUR "UnAutreMotDePasse"
    npm run user -- lister
    ```
    (Remplacer « Prénom » par le prénom de M./Mme Hamadas. Mot de passe : 10 caractères minimum.)
12. Essai sur le PC : `npm run build` puis `npm start`, ouvrir http://localhost:3000 et se connecter. `Ctrl+C` pour arrêter.

## Partie C. Mettre en ligne sur Vercel

13. Créer un compte sur https://github.com, puis installer **GitHub Desktop** (https://desktop.github.com) et s'y connecter. **File › Add local repository**, choisir `C:\assistpay` ; il propose de créer le dépôt : **create a repository** › **Create repository**. Puis **Publish repository** en laissant **Keep this code private** coché.
    Le fichier `.gitignore` du projet écarte déjà `node_modules`, `.next` et **`.env`** : vérifier dans la liste de gauche que `.env` n'apparaît pas (il contient les mots de passe et ne doit jamais aller sur GitHub).
14. Créer un compte sur https://vercel.com avec **Continue with GitHub**. **Add New… › Project**, choisir le dépôt `assistpay`, **Import**.
15. Avant de cliquer **Deploy**, ouvrir **Environment Variables** et ajouter :
    | Nom | Valeur |
    | --- | --- |
    | `DATABASE_URL` | la même que dans `.env` (Transaction pooler, port 6543, avec `?sslmode=require&uselibpqcompat=true`) |
    | `SESSION_SECRET` | la même que dans `.env` |
    | `SESSION_TTL_HOURS` | `12` |
    | `COOKIE_SECURE` | `true` |
    Puis **Deploy** (deux à trois minutes).
16. **Settings › Functions › Function Region** : choisir **Frankfurt (fra1)** (ou Paris si la base est à Paris), enregistrer, puis **Deployments › … › Redeploy**.
17. Ouvrir l'adresse donnée par Vercel (`https://assistpay-xxxx.vercel.app`) et se connecter avec le compte administrateur. Facultatif : **Settings › Domains** pour utiliser `assistpay.alloassistance.dz` (un enregistrement CNAME à ajouter chez l'hébergeur du nom de domaine).

## Partie D. Créer les comptes des collaborateurs

18. Connecté en administrateur : **Utilisateurs et accès › Ajouter une personne**.
19. Saisir prénom, nom, e-mail, mot de passe initial, puis choisir le **profil** : la liste des onglets se remplit avec les accès du profil. Ajuster chaque onglet : **Aucun accès**, **Consultation** ou **Modification**.

    | Groupe | Onglets |
    | --- | --- |
    | Pilotage | Tableau de bord · Pilotage et clôture (montre aussi la trésorerie et le relevé) · Contrôle qualité |
    | Factures | Factures clients (crédit) · Factures fournisseurs (débit) |
    | Ventes | Partenaires · Établir une facture · CAAR production · BDG débours et frais |
    | Achats et banque | Demandes de paiement · Virements et RIB · Relevé bancaire |
    | Administration | RH (salaires) |

    « Utilisateurs et accès » reste réservé aux administrateurs. Les profils **Administrateur** et **Direction** ont tous les droits sans exception : les réserver à rfellahi@ et ahamadas@.
20. **Créer le compte**, puis transmettre le mot de passe à la personne (de vive voix ou par SMS, pas dans le même e-mail que l'adresse du site). Elle le change dans **Mon compte**.
21. Tout reste modifiable ensuite dans le tableau des accès (une case par personne et par onglet), et un compte peut être désactivé à tout moment.

## Partie E. Exploitation

- **Sauvegardes** : l'offre gratuite de Supabase ne fait pas de sauvegarde et met le projet en pause après une semaine sans activité. Pour l'usage quotidien de l'entreprise, prendre l'offre **Pro** (sauvegardes quotidiennes). En plus, chaque fin de mois : **Pilotage › Paramètres et sauvegarde › Excel** et **JSON**.
- **Vercel** : l'offre gratuite (Hobby) est réservée à un usage non commercial ; pour l'entreprise, prendre l'offre **Pro**. Vérifier les tarifs du moment sur les deux sites.
- **Taille des fichiers déposés** : 4 Mo au maximum (limite de Vercel).
- **Sécurité** : double authentification sur Supabase, Vercel et GitHub ; ne jamais envoyer `.env` ; changer le mot de passe de la base (Supabase › Project Settings › Database) si quelqu'un quitte l'entreprise, puis mettre à jour `DATABASE_URL` sur Vercel.
- **Données** : les salaires et les RIB seront hébergés en Europe. À valider avec la direction au regard de la loi 18-07 sur la protection des données personnelles.
- **Mise à jour du code** : remplacer les fichiers dans le dépôt GitHub ; Vercel redéploie tout seul. Si une nouvelle migration est fournie : `npm run db:migrate` depuis le PC (avec `DIRECT_URL`), puis relancer `prisma/sql/supabase-securite.sql`.
