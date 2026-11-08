import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MlaFileInfo, MlaPrimeRow } from "@/features/mla/services/mla-store";
import { formatDA } from "@/utils/format";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function monthName(key: string): string {
  const [year, month] = key.split("-");
  const name = MOIS[Number(month) - 1];
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}` : key;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "short", timeStyle: "short" });
}

function size(bytes: number): string {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(bytes / 1000))} Ko`;
}

/** Tableau des primes : une ligne par année, avec les versions précédentes. */
export function MlaPrimes({ rows }: Readonly<{ rows: MlaPrimeRow[] }>): React.JSX.Element {
  return (
    <Card className="p-0">
      <div className="border-b p-3">
        <p className="text-sm font-medium">Primes par année</p>
        <p className="text-xs text-muted-foreground">Une ligne par année. Une année déjà facturée garde ses primes : une nouvelle année se crée par une nouvelle ligne.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Année</TableHead>
            <TableHead className="text-right">Prime annuelle / véhicule</TableHead>
            <TableHead className="text-right">Retrait sinistré / mois</TableHead>
            <TableHead>Fixée par</TableHead>
            <TableHead>Modifications</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.year}>
              <TableCell className="font-medium">{row.year}</TableCell>
              <TableCell className="text-right tabular-nums">{formatDA(row.primeAnnuelle)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatDA(row.primeRetraitMois)}</TableCell>
              <TableCell className="text-xs">{row.parDefaut ? "Valeurs initiales" : `${row.par || "—"} · ${when(row.le)}`}</TableCell>
              <TableCell className="text-xs">
                {row.historique.length ? (
                  <details>
                    <summary className="cursor-pointer">{row.historique.length} ancienne(s) version(s)</summary>
                    <ul className="mt-1 space-y-0.5">
                      {row.historique.map((version, index) => (
                        <li key={`${version.le}-${index}`}>
                          {formatDA(version.primeAnnuelle)} / {formatDA(version.primeRetraitMois)} · {version.par}
                          {version.le ? ` · ${when(version.le)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  "Aucune"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Fichiers de production conservés dans la fiche MLA, par mois traité. */
export function MlaFiles({ files }: Readonly<{ files: MlaFileInfo[] }>): React.JSX.Element {
  return (
    <Card className="p-0">
      <div className="border-b p-3">
        <p className="text-sm font-medium">Fichiers de production conservés ({files.length})</p>
        <p className="text-xs text-muted-foreground">La flotte et les activités déposées sont gardées pour chaque mois traité, au cas où il faudrait revenir dessus.</p>
      </div>
      {files.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mois traité</TableHead>
              <TableHead>Fichier</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead className="text-right">Taille</TableHead>
              <TableHead>Déposé par</TableHead>
              <TableHead>Le</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell className="whitespace-nowrap">{monthName(file.month)}</TableCell>
                <TableCell>{file.kind === "flotte" ? "Flotte" : "Activités"}</TableCell>
                <TableCell>
                  <a href={`/api/mla/fichiers/${file.id}`} className="underline underline-offset-2" download>
                    {file.name}
                  </a>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">{size(file.size)}</TableCell>
                <TableCell className="text-xs">{file.uploadedBy}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{when(file.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="p-3 text-sm text-muted-foreground">Aucun fichier conservé pour l'instant.</p>
      )}
    </Card>
  );
}
