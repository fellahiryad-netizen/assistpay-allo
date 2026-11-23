import type { CSSProperties } from "react";
import { ISSUER } from "@/features/billing/config";
import { layoutEnvelope, type FitResult } from "@/features/courrier/lib/envelope-fit";
import type { BranchAddress } from "@/features/courrier/types";

/** Règle de page propre à l'étiquette : A4 paysage, marge de 6 mm (la feuille utile fait donc 285 x 198 mm). */
export const ENVELOPE_PAGE_CSS = "@page { size: A4 landscape; margin: 6mm; }";

/** Mention fixe imprimée en haut de l'étiquette. */
export const ENVELOPE_MENTION = "COURRIER — ORIGINAUX DE FACTURES";

/** Texte du bloc expéditeur, tiré des coordonnées de l'émetteur des factures. */
export const ENVELOPE_SENDER = `EXPÉDITEUR : ${ISSUER.nom}, ${ISSUER.adresse} — Tél. ${ISSUER.tel}`;

function Lines({ fit, className }: Readonly<{ fit: FitResult; className?: string }>): React.JSX.Element {
  const style: CSSProperties = { fontSize: `${fit.fontPt}pt` };
  return (
    <p className={className} style={style}>
      {fit.lines.map((line, index) => (
        <span key={`${index}-${line}`} className="env-line">
          {line}
        </span>
      ))}
    </p>
  );
}

/** Propriétés d'une étiquette. */
export interface EnvelopeLabelProps {
  branch: Pick<BranchAddress, "nom" | "contact" | "telephones" | "adresse">;
}

/**
 * Étiquette d'enveloppe A4 paysage, à coller sur l'enveloppe : logo et filet de la charte, destinataire en très gros caractères gras noirs
 * (taille réduite automatiquement si l'adresse est longue), expéditeur discret en bas. Tout en noir et en gras, sans fond, pour l'impression noir et blanc.
 */
export function EnvelopeLabel({ branch }: Readonly<EnvelopeLabelProps>): React.JSX.Element {
  const layout = layoutEnvelope(branch);
  return (
    <section className="env-sheet" aria-label={`Étiquette pour ${branch.nom}`}>
      <div className="env-frame">
        <header className="env-head">
          <img src="/logo-allo.png" alt="Allo Assistance" className="env-logo" />
          <p className="env-mention">{ENVELOPE_MENTION}</p>
        </header>
        <hr className="env-rule" />
        <div className="env-to">
          <p className="env-label">DESTINATAIRE</p>
          <Lines fit={layout.nom} />
          <Lines fit={layout.adresse} />
          {layout.telephones.lines.length > 0 ? <Lines fit={layout.telephones} /> : null}
          {layout.contact ? <Lines fit={layout.contact} /> : null}
        </div>
        <footer className="env-from">{ENVELOPE_SENDER}</footer>
      </div>
    </section>
  );
}

/** Une ou plusieurs étiquettes, une par page à l'impression, avec la règle de page paysage. */
export function EnvelopeSheets({ branches }: Readonly<{ branches: ReadonlyArray<EnvelopeLabelProps["branch"] & { id: string }> }>): React.JSX.Element {
  return (
    <div className="env-sheets">
      <style>{ENVELOPE_PAGE_CSS}</style>
      {branches.map((branch) => (
        <EnvelopeLabel key={branch.id} branch={branch} />
      ))}
    </div>
  );
}
