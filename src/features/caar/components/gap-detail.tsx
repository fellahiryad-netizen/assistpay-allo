import { Card } from "@/components/ui/card";
import type { CaarGapDetail } from "@/features/caar/services/caar-gap";
import { formatDA } from "@/utils/format";

/** Détail d'un écart entre le total déclaré dans le fichier de production et le total recalculé. */
export function GapDetail({
  gap,
}: Readonly<{ gap: CaarGapDetail }>): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-3 border-destructive/40 p-4 text-sm">
      <div>
        <h3 className="font-semibold">Écart détecté : {formatDA(gap.gap)}</h3>
        <p className="text-muted-foreground">
          Total déclaré (ligne {gap.declaredLine}) {formatDA(gap.declared)} ·
          total recalculé {formatDA(gap.ours)} · somme de toutes les lignes du
          fichier {formatDA(gap.allLinesTotal)}
        </p>
      </div>
      <p className="font-medium">{gap.conclusion}</p>
      {gap.causes.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Pistes relevées dans le fichier
          </p>
          {gap.causes.map((cause) => (
            <details key={cause.key} className="rounded-md border p-2">
              <summary className="cursor-pointer">
                {cause.label} : {cause.count} ligne{cause.count > 1 ? "s" : ""}
                {cause.key === "PRIME_MISSING"
                  ? ""
                  : ` · ${formatDA(cause.total)}`}
              </summary>
              <ul className="mt-2 max-h-48 overflow-auto text-xs">
                {cause.lines.map((line) => (
                  <li
                    key={line.line}
                    className="flex justify-between gap-2 border-b py-0.5 last:border-0"
                  >
                    <span>
                      Ligne {line.line} · {line.agence || "—"} ·{" "}
                      {line.police || "—"} · {line.nom || "—"}
                    </span>
                    <span className="tabular-nums">
                      {line.prime === null ? "—" : formatDA(line.prime)}
                    </span>
                  </li>
                ))}
                {cause.count > cause.lines.length ? (
                  <li className="pt-1 text-muted-foreground">
                    … et {cause.count - cause.lines.length} autres (voir
                    l'Excel).
                  </li>
                ) : null}
              </ul>
            </details>
          ))}
        </div>
      ) : null}
      {gap.singleLines.length ? (
        <p className="text-xs">
          Lignes dont la prime est égale à l'écart :{" "}
          {gap.singleLines
            .map(
              (row) =>
                `ligne ${row.line} (${row.police || row.nom || row.agence || "—"}, ${formatDA(row.prime ?? 0)})`,
            )
            .join(" ; ")}
          .
        </p>
      ) : null}
    </Card>
  );
}
