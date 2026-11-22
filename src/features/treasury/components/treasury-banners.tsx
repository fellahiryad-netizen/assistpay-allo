import { AlertTriangle, CheckCircle2, FlaskConical, Info, OctagonAlert } from "lucide-react";
import type { RiskLevel, Verdict } from "@/features/treasury/lib/risk";
import type { BalanceRejection } from "@/features/treasury/types";
import type { BalanceView } from "@/features/treasury/types/view";
import { cn } from "@/utils/cn";
import { formatDate, formatDateTime } from "@/utils/format";

/** Date et heure d'un horodatage ISO : « le 22/11 à 09:05 ». */
function stampLabel(iso: string): string {
  const [day = "", time = ""] = formatDateTime(iso).split(/[ ,]+/);
  return day ? `le ${day.slice(0, 5)}${time ? ` à ${time}` : ""}` : "";
}

/** Bandeau de fraîcheur du solde : date du solde, dernière opération, source ; orange si ancien (plus de 2 jours ouvrés), rouge au-delà de 5. */
export function FreshnessBanner({ balance }: Readonly<{ balance: BalanceView }>): React.JSX.Element {
  const manual = balance.source === "manuel";
  const tone = manual || balance.freshness === "orange" ? "warning" : balance.freshness === "rouge" ? "danger" : "ok";
  const Icon = tone === "ok" ? Info : tone === "warning" ? AlertTriangle : OctagonAlert;
  return (
    <div
      role={tone === "ok" ? "status" : "alert"}
      className={cn(
        "flex items-start gap-3 rounded-lg border-2 p-3 text-sm sm:text-base",
        tone === "ok" && "border-border bg-card",
        tone === "warning" && "border-warning bg-warning/10",
        tone === "danger" && "border-destructive bg-destructive/10",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>
        {manual ? <p className="font-bold">Solde saisi à la main — à remplacer par un relevé AGB importé.</p> : null}
        <p>
          <b>Solde arrêté au {formatDate(balance.date)}</b>
          {balance.lastOperationDate ? ` — dernière opération du ${formatDate(balance.lastOperationDate)}` : ""}. Source : {manual ? balance.sourceLabel : `${balance.sourceLabel} ${stampLabel(balance.savedAt)}`}
          {balance.savedBy ? `, par ${balance.savedBy}` : ""}.
        </p>
        {tone !== "ok" && !manual ? (
          <p className="font-semibold">
            {balance.freshness === "rouge" ? "Relevé très ancien" : "Relevé ancien"} : {balance.workingDays} jours ouvrés depuis la date du solde. Importez un relevé plus récent (menu « Relevé bancaire »).
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Dernier relevé refusé pour le solde (structure, compte, incohérence ou relevé plus ancien) : le solde précédent est conservé. */
export function RejectionBanner({ rejection }: Readonly<{ rejection: BalanceRejection }>): React.JSX.Element {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm">
      <OctagonAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p>
        <b>{rejection.reason === "incoherent" ? "Relevé incohérent." : rejection.reason === "ancien" ? "Relevé plus ancien." : rejection.reason === "compte" ? "Compte différent." : "Relevé non reconnu."}</b> {rejection.message}
        {rejection.at ? ` (${stampLabel(rejection.at)})` : ""}
      </p>
    </div>
  );
}

/** Bandeau très distinct « MODE SIMULATION » : affiché dès qu'un scénario est actif. */
export function SimulationBanner({ name, by, createdAt, lines }: Readonly<{ name: string; by: string; createdAt: string; lines: number }>): React.JSX.Element {
  return (
    <div
      role="status"
      className="rounded-lg border-4 border-dashed border-primary p-3 text-center sm:p-4"
      style={{ backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--primary) / 0.16) 0 14px, transparent 14px 28px)" }}
    >
      <p className="flex items-center justify-center gap-2 text-lg font-extrabold uppercase tracking-wider sm:text-2xl">
        <FlaskConical aria-hidden className="size-6" />
        Mode simulation
      </p>
      <p className="mt-1 text-sm font-semibold sm:text-base">
        Scénario « {name} » — {lines} ligne{lines > 1 ? "s" : ""} simulée{lines > 1 ? "s" : ""}, créé {stampLabel(createdAt)}{by ? ` par ${by}` : ""}. Les chiffres ci-dessous ne sont pas la situation réelle.
      </p>
    </div>
  );
}

const VERDICT_STYLES: Readonly<Record<RiskLevel, { box: string; Icon: typeof CheckCircle2; word: string }>> = {
  vert: { box: "border-success bg-success/10", Icon: CheckCircle2, word: "VERT" },
  orange: { box: "border-warning bg-warning/10", Icon: AlertTriangle, word: "ORANGE" },
  rouge: { box: "border-destructive bg-destructive/10", Icon: OctagonAlert, word: "ROUGE" },
};

/** Verdict en langage simple : pictogramme, niveau écrit en toutes lettres et phrase (jamais la couleur seule). */
export function VerdictCard({ verdict }: Readonly<{ verdict: Verdict }>): React.JSX.Element {
  const style = VERDICT_STYLES[verdict.level];
  return (
    <section aria-labelledby="tr-verdict" className={cn("rounded-lg border-2 p-4 sm:p-5", style.box)}>
      <h2 id="tr-verdict" className="flex flex-wrap items-center gap-3 text-xl font-extrabold sm:text-2xl">
        <style.Icon aria-hidden className="size-8 shrink-0" />
        <span>{verdict.title}</span>
        <span className="rounded-md border-2 border-current px-2 py-0.5 text-sm tracking-widest">{style.word}</span>
      </h2>
      <p className="mt-2 text-base sm:text-lg">{verdict.sentence}</p>
    </section>
  );
}
