# Logos des compagnies partenaires

Cette page sert aux logos affichés dans « Créances par compagnie » (`/creances`).
Aucun logo de compagnie n'est fourni : tant qu'un logo n'est pas déposé, l'application affiche des initiales sur une pastille de couleur.

## Déposer un logo

1. Récupérer le logo officiel de la compagnie (fichier PNG, fond transparent ou blanc, carré ou horizontal, 200 px minimum).
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
   `src/features/receivables/config/logos.ts`, par exemple `["caar", "gam"]`.
4. Redéployer. Le logo remplace alors l'initiale partout où la compagnie apparaît.

Seules les compagnies de cette liste sont cherchées : le site ne fait aucune requête pour deviner un logo absent.
