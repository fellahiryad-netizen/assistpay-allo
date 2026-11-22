import { BalanceChart } from "@/features/treasury/components/balance-chart";
import { buildHypotheses, DECISION_AID_MENTION, FOOTER_MENTION } from "@/features/treasury/lib/hypotheses";
import { NATURE_LABELS } from "@/features/treasury/lib/payables";
import { millions } from "@/features/treasury/lib/format";
import type { TreasuryView } from "@/features/treasury/types/view";
import { formatDA, formatDate } from "@/utils/format";

const SOURCES = { facture: "Facture", simulation: "Simulation", demande: "Demande (à confirmer)" } as const;
const WORDS = { vert: "VERT", orange: "ORANGE", rouge: "ROUGE" } as const;

/**
 * Version imprimable de la trésorerie : noir et blanc, tout en gras, aucun fond coloré (le niveau de risque est écrit en toutes lettres).
 * Les styles se trouvent dans `globals.css` (classe `tr-sheet`).
 */
export function TreasuryPrint({ view }: Readonly<{ view: TreasuryView }>): React.JSX.Element {
  const { balance, computation } = view;
  if (!balance || !computation) return <p className="tr-sheet">Aucun solde disponible.</p>;
  const hypotheses = buildHypotheses({ balance, computation, scenarioName: view.active?.nom ?? null, scenarioLines: view.active?.lignes.length ?? 0, expectedEnabled: view.settings.encaissementsAttendus, includeRequests: view.includeRequests });
  return (
    <article className="tr-sheet">
      <h1>Trésorerie du compte AGB — {formatDate(view.today)}</h1>
      {view.active ? <p className="tr-box">MODE SIMULATION — scénario « {view.active.nom} » : ces chiffres ne sont pas la situation réelle.</p> : null}
      <p>
        Solde arrêté au {formatDate(balance.date)}
        {balance.lastOperationDate ? `, dernière opération du ${formatDate(balance.lastOperationDate)}` : ""}. Source : {balance.sourceLabel}.{balance.source === "manuel" ? " SOLDE SAISI À LA MAIN." : ""}
      </p>
      <table>
        <tbody>
          <tr>
            <td>Solde du compte AGB</td>
            <td className="num">{formatDA(computation.bank)}</td>
          </tr>
          {view.cheques.map((cheque) => (
            <tr key={`${cheque.source}-${cheque.id}`}>
              <td>moins le chèque {cheque.numero} non encore encaissé par la banque</td>
              <td className="num">{formatDA(-cheque.montant)}</td>
            </tr>
          ))}
          {computation.adjustment !== 0 ? (
            <tr>
              <td>mouvements du CRM postérieurs au relevé (non confirmés)</td>
              <td className="num">{formatDA(computation.adjustment)}</td>
            </tr>
          ) : null}
          <tr>
            <td>Solde disponible estimé</td>
            <td className="num">{formatDA(computation.available)}</td>
          </tr>
          <tr>
            <td>Reste à payer</td>
            <td className="num">{formatDA(computation.totalToPay)}</td>
          </tr>
          <tr>
            <td>Solde après paiements</td>
            <td className="num">{formatDA(computation.balanceAfter)}</td>
          </tr>
          <tr>
            <td>Couverture</td>
            <td className="num">{computation.coverageRatio === null ? "sans objet" : computation.coverageRatio.toFixed(2).replace(".", ",")}</td>
          </tr>
          <tr>
            <td>Réserve conseillée ({computation.cushionDays} jours)</td>
            <td className="num">{formatDA(computation.cushion)}</td>
          </tr>
        </tbody>
      </table>
      <p className="tr-box">
        NIVEAU {WORDS[computation.verdict.level]} — {computation.verdict.title}. {computation.verdict.sentence}
      </p>
      <h2>Évolution prévue du solde</h2>
      <BalanceChart history={view.history} projection={computation.timeline.points} cushion={computation.cushion} lowest={computation.timeline.lowest} overdraftDate={computation.timeline.overdraftDate} mono />
      <h2>Paiements à venir ({computation.schedule.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Bénéficiaire</th>
            <th>Nature</th>
            <th className="num">Montant</th>
            <th>Source</th>
            <th className="num">Solde après</th>
          </tr>
        </thead>
        <tbody>
          {computation.schedule.map((row) => (
            <tr key={row.id}>
              <td>{formatDate(row.date)}</td>
              <td>{row.beneficiaire}</td>
              <td>{NATURE_LABELS[row.nature]}</td>
              <td className="num">{formatDA(row.montant)}</td>
              <td>{SOURCES[row.source]}</td>
              <td className="num">{formatDA(row.balanceAfter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Totaux par nature</h2>
      <table>
        <tbody>
          {computation.byNature.map((row) => (
            <tr key={row.nature}>
              <td>
                {row.label} ({row.count})
              </td>
              <td className="num">{formatDA(row.total)}</td>
            </tr>
          ))}
          {computation.preparedCount > 0 ? (
            <tr>
              <td>Dont déjà dans des virements préparés (non additionné)</td>
              <td className="num">{formatDA(computation.preparedTotal)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <h2>Ordre de paiement conseillé</h2>
      <ol>
        {computation.priority.map((group) => (
          <li key={group.rank}>
            {group.label} — {group.count} paiement{group.count > 1 ? "s" : ""}, {millions(group.total)}
          </li>
        ))}
      </ol>
      <p>{DECISION_AID_MENTION}</p>
      <h2>Hypothèses</h2>
      <ul>
        {hypotheses.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>{FOOTER_MENTION}</p>
    </article>
  );
}
