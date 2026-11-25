import type { CSSProperties } from "react";
import { ISSUER } from "@/features/billing/config";
import { layoutEnvelope, shrinkLayoutToHeight, type FitResult } from "@/features/courrier/lib/envelope-fit";
import { COMPANY_LOGOS, COMPANY_NAMES, markedCompany, sigleParts, type MarkedCompany } from "@/features/courrier/lib/company";
import type { BranchAddress } from "@/features/courrier/types";

/** Règle de page propre à l'étiquette : A4 paysage, marge de 6 mm (la feuille utile fait donc 285 x 198 mm). */
export const ENVELOPE_PAGE_CSS = "@page { size: A4 landscape; margin: 6mm; }";

/** Mention fixe imprimée en haut de l'étiquette. */
export const ENVELOPE_MENTION = "COURRIER — ORIGINAUX DE FACTURES";

/** Texte du bloc expéditeur, tiré des coordonnées de l'émetteur des factures. */
export const ENVELOPE_SENDER = `EXPÉDITEUR : ${ISSUER.nom}, ${ISSUER.adresse} — Tél. ${ISSUER.tel}`;

/** Hauteur disponible (mm) pour le texte du destinataire quand le repère de compagnie occupe le haut de l'étiquette (mesurée sur le rendu A4 paysage). */
const TEXT_HEIGHT_MARKED_MM = 78;

/** Classes du cadre selon la compagnie (écrites en toutes lettres pour que Tailwind les garde). */
const FRAME_CLASS: Readonly<Record<MarkedCompany, string>> = { CAAT: "env-frame env-frame-caat", CAAR: "env-frame env-frame-caar" };

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

/**
 * Sigle de la compagnie écrit « CAAT » / « CAAR » : « CAA » en majuscules normales, dernière lettre en très grande capitale grasse et soulignée,
 * puisque c'est la seule différence entre les deux sigles. Le texte lu par un lecteur d'écran reste le sigle normal.
 */
export function CompanySigle({ company }: Readonly<{ company: MarkedCompany }>): React.JSX.Element {
  const parts = sigleParts(company);
  return (
    <span className="env-sigle" role="img" aria-label={company}>
      <span className="env-sigle-first" aria-hidden>{parts.first}</span>
      <span className="env-sigle-last" aria-hidden>{parts.last}</span>
    </span>
  );
}

/** Propriétés d'une étiquette. */
export interface EnvelopeLabelProps {
  branch: Pick<BranchAddress, "nom" | "contact" | "telephones" | "adresse"> & { compagnie?: string };
}

/**
 * Étiquette d'enveloppe A4 paysage, à coller sur l'enveloppe : repère de compagnie (logo, sigle, cadre propre à la CAAR ou à la CAAT) en haut, logo et filet de la charte, destinataire en très gros caractères gras noirs
 * (taille réduite automatiquement si l'adresse est longue), expéditeur discret en bas. Tout en noir et en gras, sans fond, pour l'impression noir et blanc.
 */
export function EnvelopeLabel({ branch }: Readonly<EnvelopeLabelProps>): React.JSX.Element {
  const company = markedCompany(branch.compagnie);
  const base = layoutEnvelope(branch);
  const layout = company ? shrinkLayoutToHeight(base, TEXT_HEIGHT_MARKED_MM) : base;
  return (
    <section className="env-sheet" aria-label={`Étiquette pour ${branch.nom}`}>
      <div className={company ? FRAME_CLASS[company] : "env-frame"}>
        {company ? (
          <div className="env-mark" data-company={company}>
            <img src={COMPANY_LOGOS[company]} alt={`Logo ${company}`} className="env-mark-logo" />
            <div className="env-mark-id">
              <CompanySigle company={company} />
              <p className="env-mark-name">{COMPANY_NAMES[company]}</p>
            </div>
            <svg width="0" height="0" aria-hidden focusable="false" className="env-svg-defs">
              <filter id="env-bw" colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values="0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0" />
                <feComponentTransfer>
                  <feFuncR type="gamma" amplitude="1" exponent="5" offset="0" />
                  <feFuncG type="gamma" amplitude="1" exponent="5" offset="0" />
                  <feFuncB type="gamma" amplitude="1" exponent="5" offset="0" />
                </feComponentTransfer>
              </filter>
            </svg>
          </div>
        ) : null}
        <header className={company ? "env-head env-head-compact" : "env-head"}>
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
