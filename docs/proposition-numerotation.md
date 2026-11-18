# Proposition : une gestion claire de la numérotation des factures

Document de travail, rédigé à la demande de la chargée de facturation, à valider par le propriétaire avant toute modification. Il décrit ce qui existe, ce qui pose problème, ce que je propose, et ce qui est déjà livré sans toucher aux règles.

Les règles de numérotation font partie des règles de facturation protégées (`CLAUDE.md`). Rien dans les générateurs actuels n'a été modifié. La seule chose ajoutée est une page de consultation, le « Registre de numérotation » (voir la section 7).

---

## 1. Ce qui existe aujourd'hui

### 1.1 Comment un numéro est fabriqué

Il n'y a pas de compteur en base. Chaque générateur relit les numéros déjà enregistrés, repère le plus grand et ajoute 1.

| Série | Exemple | Fonction | Particularité |
| --- | --- | --- | --- |
| Factures partenaires | `GAM 26-000057` | `nextClientNumber` (`billing-calc.ts`) | Une seule suite par année pour tous les partenaires (GAM, TRUST, CAAT, CAAR, MLA, TDA, autres). Le préfixe ne sert qu'à l'affichage : il n'entre pas dans le calcul du maximum. |
| BDG GAM, facture globale | `000019-2026 AB` | `nextGamAbNumber` | Une suite par année. |
| BDG TRUST (débours puis frais) | `TRUST 000012-2026 BDG` | `nextTrustBdgNumbers` | Deux numéros consécutifs par paire. |
| BDG CAAT (débours puis frais) | `CAAT 26-000041BDG` ; au suivi : `CAAT26-155&156BDG` | `nextCaatBdgNumbers` | Deux numéros consécutifs par paire. |
| Avoirs | `AV/2026/0001` | `nextAvoirNumber` (`avoir-calc.ts`) | Une suite par année, tous partenaires confondus ; un avoir annulé garde son numéro. |

Les factures CAAR (production, régul 10 %), CAAT régul, MLA et les imports BDG GAM n'ont pas de générateur à eux : ils passent par `proposeNumbers` (`billing-service.ts`), donc par les fonctions ci-dessus.

Hors factures, les demandes de paiement (`0815/2026AS`) ont leur propre mécanisme : maximum + 1, avec nouvel essai si le numéro est déjà pris.

### 1.2 Où les numéros sont stockés

- `Invoice.numero` : texte libre, sans contrainte d'unicité. Pour une paire BDG, les deux numéros sont aussi dans `extra.factureDebours` et `extra.factureFrais`.
- `IssuedInvoice.num` et `payload.num2` : la facture établie (même document que la ligne du suivi, liée par `invoiceLegacyId`).
- Avoirs : des `IssuedInvoice` avec `payload.kind = "avoir"`.
- Rectification : l'ancien numéro reste seulement dans `payload.versions` (les 10 dernières versions).

Il n'existe aucune table de séries, aucun registre, aucune contrainte d'unicité sur un numéro.

### 1.3 Ce qui se passe quand on supprime une facture

- Le numéro n'est ni « libéré » ni « réservé » : il disparaît simplement des données, puis le générateur recalcule le maximum.
- Si la facture supprimée portait le **dernier** numéro de la série, la facture suivante **reçoit exactement le même numéro**, sans aucun signal. Si le numéro avait déjà été envoyé au partenaire, deux documents différents circulent sous le même numéro.
- Si la facture supprimée était **au milieu**, le numéro devient un trou définitif. Personne n'en est averti, et rien n'est prévu pour le remplir. Le seul moyen de « remplacer son numéro », comme le demande la chargée de facturation, est de retaper le numéro à la main dans le formulaire : cela fonctionne, mais sans contrôle ni trace.
- La trace de la suppression est un texte libre du journal (« Suppression facture », « Suppression facture établie »). Lorsque c'est l'administrateur qui supprime directement, rien n'est inscrit dans l'historique des suppressions (`Setting` « suppressions »), seulement au journal. Cet historique est de plus limité aux 300 dernières demandes.
- Pour une paire BDG supprimée depuis la facturation, le journal ne garde que le premier numéro (`doc.num`), pas le numéro des frais.

### 1.4 Risques réels relevés

1. **Réattribution silencieuse du dernier numéro** (voir 1.3). C'est le risque le plus sérieux : il touche à l'unicité d'un numéro déjà émis.
2. **Course entre deux utilisateurs.** Le numéro est proposé à l'ouverture du formulaire, sans réservation. Deux personnes qui ouvrent une nouvelle facture en même temps reçoivent le même numéro ; la seconde à enregistrer est refusée (« Le n° … existe déjà »), ce qui est correct mais inconfortable. Le contrôle à l'enregistrement n'est pas transactionnel et la base n'a pas de contrainte d'unicité : deux enregistrements simultanés à quelques millisecondes peuvent passer tous les deux.
3. **Avoirs : pas de doublon, mais un échec possible en cas de simultanéité.** `createAvoir` calcule `nextAvoirNumber` dans une transaction de niveau Serializable : deux avoirs créés au même instant ne peuvent donc pas obtenir le même `AV/AAAA/NNNN`. Si deux transactions se heurtent, la base refuse l'une d'elles (erreur P2034). Le code refait alors un seul essai ; si le conflit persiste, l'utilisateur reçoit le message « Un autre avoir a été enregistré au même moment… » et doit recommencer, sans qu'aucun avoir n'ait été créé. Le risque est donc un échec ponctuel, pas un numéro en double. Suggestion : si ces échecs se révèlent fréquents, prévoir plusieurs essais avec une courte attente ; la base n'a pas non plus de contrainte d'unicité sur le numéro, qui serait un filet de sécurité supplémentaire.
4. **Le contrôle de doublon est sensible au préfixe, la suite ne l'est pas.** Le contrôle compare les numéros en ignorant la ponctuation, donc `GAM 26-000057` et `CAAT 26-000057` ne se détectent pas comme doublons, alors qu'ils appartiennent à la même suite.
5. **Un numéro tapé à la main peut dérégler la suite.** Un numéro trop grand fait « sauter » la série pour de bon (le maximum est relu à chaque fois). Plus grave : les générateurs ignorent les numéros de la suite commune à partir de 5000. Si le maximum atteint 4999, la facture suivante reçoit `005000`, qui est ignoré, et la suivante reçoit à nouveau `005000`.
6. **Année du numéro.** L'année est celle du jour où le formulaire est ouvert. Une facture ouverte le 2 janvier mais datée du 31 décembre porte un numéro de la nouvelle année.
7. **Rectification.** Le numéro peut être modifié à la rectification ; l'ancien n'est conservé que dans les 10 dernières versions, sans motif de libération.
8. **Aucune visibilité.** Aucun écran ne montre la suite, les trous ou les doublons. C'est le constat de la chargée de facturation.

Ce que je n'ai pas trouvé : un doublon créé par le code lui-même dans un usage normal à un seul utilisateur. Les risques viennent de la suppression, de la simultanéité et de la saisie manuelle.

---

## 2. Principes proposés

1. **Une série = partenaire (ou famille) + type + année.** On distingue ce qui est réellement une suite commune (factures partenaires, une par année) des suites séparées (BDG GAM, BDG TRUST, BDG CAAT, avoirs). Le choix de garder la suite commune ou de passer à une suite par partenaire est une décision de gestion, pas une décision technique : voir la question ouverte en 8.
2. **Jamais de réutilisation silencieuse.** Un numéro qui a existé n'est redonné que par une décision enregistrée.
3. **Tout trou est tracé avec un motif.** Un trou est soit « libéré, à réutiliser », soit « annulé, définitivement » (le numéro est conservé avec le motif, comme un avoir le ferait).
4. **Un numéro libéré est proposé en priorité à la prochaine facture de la même série**, sous contrôle de l'administrateur, et seulement si c'est cohérent :
   - la facture supprimée n'a jamais été envoyée au partenaire (le suivi garde la date d'envoi quand elle existe) ;
   - la date de la nouvelle facture reste dans l'ordre chronologique entre ses voisines. Sinon, le numéro est « annulé » et non réutilisé.
5. **Verrou transactionnel** à l'attribution et à l'enregistrement, avec une contrainte d'unicité en base : même si l'écran se trompe, la base refuse le doublon.
6. **Aucun numéro déjà émis n'est jamais modifié** par la mise en place.

Point à confirmer avec le comptable : l'exigence de continuité et d'ordre chronologique des factures. Je ne l'ai pas vérifiée dans les textes ; j'ai donc retenu la règle prudente (pas de réutilisation si l'ordre des dates serait rompu, ou si la facture est partie chez le partenaire).

---

## 3. Modèle de données proposé

Proposition, **non appliquée** : aucune migration n'a été ajoutée au dossier `prisma/migrations/`.

```prisma
/// Une suite de numéros : famille + année (ex. FACT / 2026, BDG_GAM_AB / 2026, AVOIR / 2026).
model NumberSeries {
  id       String         @id @default(cuid())
  code     String         /// FACT, BDG_GAM_AB, BDG_TRUST, BDG_CAAT, AVOIR
  year     Int
  label    String
  lastSeq  Int            @default(0)   /// dernier numéro attribué (variante complète)
  entries  NumberLedger[]
  @@unique([code, year])
}

enum NumberStatus {
  RESERVE     /// proposé à un formulaire ouvert, expire seul
  UTILISE     /// porté par une facture
  LIBERE      /// facture supprimée, numéro disponible pour réutilisation validée
  ANNULE      /// numéro conservé comme trou justifié, jamais réutilisé
  REUTILISE   /// numéro libéré redonné (trace conservée de l'ancien usage)
}

/// Une ligne par numéro attribué ou libéré. Jamais supprimée.
model NumberLedger {
  id              String       @id @default(cuid())
  seriesId        String
  series          NumberSeries @relation(fields: [seriesId], references: [id])
  seq             Int
  display         String       /// ex. « GAM 26-000057 »
  status          NumberStatus
  invoiceLegacyId String?      /// facture du suivi qui le porte
  issuedId        String?
  reservedUntil   DateTime?
  releasedAt      DateTime?
  releasedById    String?
  releaseReason   String       @default("")
  history         Json         @default("[]")   /// anciens usages en cas de réutilisation
  createdAt       DateTime     @default(now())
  @@unique([seriesId, seq])
  @@index([invoiceLegacyId])
}
```

Attribution (variante complète) : dans une transaction, verrou de la ligne `NumberSeries` (`SELECT … FOR UPDATE` ou `pg_advisory_xact_lock`), recherche d'un numéro `LIBERE` éligible, sinon `lastSeq + 1`, insertion dans `NumberLedger` (la contrainte `(seriesId, seq)` fait office de garde-fou).

---

## 4. Plan de migration sans changer un seul numéro émis

1. **Observer** : le Registre de numérotation livré (section 7) donne l'état réel : trous, doublons, numéros libres. On le relit avec la chargée de facturation et on tranche les cas douteux avant d'automatiser quoi que ce soit.
2. **Créer les tables** (migration additive, aucune colonne existante touchée).
3. **Reprise de l'existant** par un script rejouable : lecture des factures, des factures établies et des avoirs avec le même analyseur que le registre, une ligne `UTILISE` par numéro existant. Les trous antérieurs à la mise en service sont inscrits `ANNULE` avec le motif « antérieur à la mise en place du registre », sans rien inventer. Le script commence par un essai à blanc qui affiche les compteurs, à comparer avec le registre.
4. **Mode ombre pendant un mois** : les générateurs actuels continuent de décider ; le registre enregistre en parallèle et signale tout écart. Aucun numéro ne change.
5. **Bascule** générateur par générateur, en commençant par les avoirs (la série la plus simple), puis BDG, puis la suite commune. Retour en arrière possible à chaque étape.

---

## 5. Impacts

Fichiers protégés qui devraient être modifiés (donc à autoriser expressément) : `billing-service.ts` (`proposeNumbers`, `saveDraft`, `deleteIssued`), `invoice-service.ts` (`deleteInvoice`), `gam-import.ts`, `mla-actions.ts`. Côté avoirs, ce ne sont pas les fichiers `avoir-service.ts` et `avoir-calc.ts` qui sont protégés en tant que tels : ce sont les règles de calcul et de numérotation qu'ils portent (`nextAvoirNumber`), qui ne se changent que sur demande expresse. Les fonctions `next…Number` de `billing-calc.ts` resteraient intactes et testées : elles serviraient de référence pendant le mode ombre.

Écrans : le formulaire de facturation (afficher « numéro libre disponible : … »), la demande de suppression (choix du sort du numéro par l'administrateur : libérer, annuler, avec motif), le registre.

Les tests existants (`tests/billing.test.ts`, `tests/avoir.test.ts`) ne bougent pas.

## 6. Risques de la mise en place

- Réutiliser un numéro libéré à tort (facture déjà envoyée) : couvert par les conditions de la section 2.
- Verrou trop long : l'attribution ne doit pas englober la génération du document, seulement l'insertion.
- Réservation à l'ouverture du formulaire (variante complète) : numéros « perdus » si l'on ferme l'onglet. D'où l'expiration automatique, et le trou expliqué « réservation expirée ».
- Reprise mal faite : d'où l'essai à blanc et le mode ombre.

### Tests à écrire

- Numéro libéré en queue, au milieu, déjà réutilisé ; refus si facture envoyée ; refus si l'ordre des dates serait rompu.
- Deux attributions simultanées (deux transactions) : un seul gagnant, aucun doublon ; idem pour les avoirs.
- Contrainte d'unicité : un second enregistrement du même numéro est refusé par la base.
- Rectification qui change de numéro : l'ancien est inscrit au registre.
- Suppression d'une paire BDG : les deux numéros sont tracés.
- Reprise de l'existant rejouable (deux passages = même résultat) et aucun numéro modifié.
- Numéro saisi à la main au-delà de 4999 : refusé ou signalé.

---

## 7. Ce qui est déjà livré : le Registre de numérotation

Page `/numerotation` (consultation, accès « Établir une facture »). Elle ne fait aucune écriture et ne modifie aucun générateur. Pour chaque série (famille + année) :

- le dernier numéro, le nombre de numéros et de documents, le prochain numéro que proposerait la règle actuelle ;
- les **trous**, regroupés en plages, avec ceux que l'on peut expliquer par une suppression connue ;
- les **doublons** (un même numéro sur deux documents différents ; une facture du suivi et sa facture établie comptent pour un seul document) ;
- les **numéros de factures supprimées ou remplacées par une rectification**, lus dans le journal, l'historique des suppressions et les versions de rectification, avec l'indicateur :
  - « Libre : sera redonné automatiquement » (le numéro dépasse le dernier : le générateur actuel le reprendra seul) ;
  - « Libre : trou définitif » ;
  - « Déjà réutilisé » ;
- pour la suite commune, le détail par partenaire (préfixe).

Limites connues du registre : il ne voit pas les suppressions que le journal n'a pas gardées (par exemple le numéro des frais d'une paire BDG supprimée, ou une suppression ancienne hors des 5 000 dernières lignes de journal) ; il ne connaît pas les dates des numéros manquants ; les formats libres de l'historique sont listés à part comme « hors séries ».

Code : `src/features/numbering/` (analyse pure dans `lib/`, lecture dans `services/`), page dans `src/app/(app)/numerotation/`, tests dans `tests/numbering.test.ts`.

---

## 8. Deux variantes et ma recommandation

### Variante simple

- Une petite table d'historique `NumberRelease` (numéro, série, sort : libéré ou annulé, motif, qui, quand), alimentée à la suppression et à la rectification.
- Le numéro continue d'être calculé comme aujourd'hui (maximum + 1), sauf que l'on propose d'abord le plus petit numéro libéré éligible.
- Verrou `pg_advisory_xact_lock` par série à l'enregistrement et au calcul de l'avoir, et contrôle de doublon sur la suite entière (pas seulement le préfixe).
- Garde-fou sur les numéros saisis à la main (au-delà du dernier + un seuil, ou ≥ 5000).
- Pas de réservation à l'ouverture du formulaire.

Avantages : peu de code, pas de reprise de données, retour arrière facile. Limite : deux personnes peuvent encore recevoir le même numéro proposé ; la seconde est refusée proprement, comme aujourd'hui.

### Variante complète

Séries et registre en base (section 3), réservation à l'ouverture du formulaire, contrainte d'unicité, un seul point d'attribution pour tous les générateurs, reprise de l'existant et mode ombre (section 4).

Avantages : visibilité et garanties maximales, une seule logique. Limites : chantier plus long, touche tous les fichiers de la section 5, gestion de l'expiration des réservations.

### Recommandation

Commencer par la **variante simple**, après relecture du registre avec la chargée de facturation. Elle supprime les risques réels (réattribution silencieuse, absence de trace, course à l'enregistrement, doublon entre préfixes) pour un coût faible. La variante complète se justifiera si, après un trimestre, la réservation à l'ouverture du formulaire manque vraiment ou si le nombre d'utilisateurs simultanés augmente.

Questions ouvertes pour le propriétaire :
1. Garder une suite commune à tous les partenaires, ou une suite par partenaire dès l'an prochain ? (Aujourd'hui la suite est commune : un trou n'est donc jamais « propre » à un partenaire.)
2. Qui décide du sort d'un numéro supprimé : l'administrateur seul (proposé) ou aussi la chargée de facturation ?
3. Règle de réutilisation : acceptée telle que décrite en section 2, après avis du comptable ?
