# Logos des compagnies partenaires

Ce dossier contient les logos affichés dans « Créances par compagnie » (`/creances`) et dans le bloc « Créances par partenaire » du tableau de bord.
Logos présents : CAAT, CAAR, GAM, TRUST, MLA (fournis par le propriétaire, recadrés et ramenés à 256 px de large ; fond blanc d'origine, affichés dans un cadre clair).
TPA et AUTO QUAL n'ont pas de logo : l'application affiche des initiales sur une pastille de couleur.
À l'impression, les logos passent en niveaux de gris (et sont absents des pages d'impression noir et blanc).

## Déposer un logo

1. Récupérer le logo officiel de la compagnie (fichier PNG, fond transparent ou blanc, carré ou horizontal, 256 px de large environ).
2. L'enregistrer dans ce dossier sous le nom `<slug>.png`, en minuscules :

   | Compagnie | Nom du fichier |
   | --- | --- |
   | CAAR | `caar.png` |
   | CAAT | `caat.png` |
   | GAM | `gam.png` |
   | TRUST | `trust.png` |
   | MLA | `mla.png` |
   | TPA | `tpa.png` |
   | AUTO QUAL | `auto-qual.png` |

   Une autre compagnie : son nom en minuscules, sans accent, espaces remplacés par des tirets.
3. Ajouter le slug (le nom sans `.png`) dans la liste `AVAILABLE_LOGOS` du fichier
   `src/features/receivables/config/logos.ts`, par exemple `["caar", "caat", "gam", "trust", "mla", "tpa"]`.
4. Redéployer. Le logo remplace alors l'initiale partout où la compagnie apparaît.

Seules les compagnies de cette liste sont cherchées : le site ne fait aucune requête pour deviner un logo absent.
