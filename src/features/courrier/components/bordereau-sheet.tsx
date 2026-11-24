import { ISSUER } from "@/features/billing/config";
import { bordereauDateLabel, totalPlis } from "@/features/courrier/lib/bordereau";
import type { BordereauLine } from "@/features/courrier/types";

/** Propriétés du bordereau d'envoi imprimé. */
export interface BordereauSheetProps {
  /** Date `AAAA-MM-JJ`. */
  date: string;
  lines: readonly BordereauLine[];
  /** Affiche la zone « Cachet et signature » d'Allo Assistance. */
  cachet: boolean;
  /** Nom du ramasseur EMS (vide : à écrire à la main). */
  ramasseur: string;
}

/**
 * Bordereau d'envoi remis au prestataire de courrier. Pensé pour le papier à en-tête d'Allo Assistance : ni logo ni pied de page dessinés,
 * la place du logo (haut) et des coordonnées (bas) est réservée par les mêmes marges que les factures (`fx-wrap`, 52 mm et 34 mm).
 * Tout en noir et en gras, simples cadres noirs, aucun fond.
 */
export function BordereauSheet({ date, lines, cachet, ramasseur }: Readonly<BordereauSheetProps>): React.JSX.Element {
  const total = totalPlis(lines);
  return (
    <table className="fx-wrap">
      <thead>
        <tr>
          <td>
            <div className="fx-sp-top" />
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div className="bd-sheet">
              <p className="bd-date">{bordereauDateLabel(date)}</p>
              <div className="bd-sender">
                <p>{ISSUER.nom}</p>
                <p>Adresse : {ISSUER.adresse}</p>
                <p>Téléphone : {ISSUER.tel}</p>
                <p>RC : {ISSUER.rc}</p>
                <p>NIF : {ISSUER.nif}</p>
                <p>NIS : {ISSUER.nis}</p>
              </div>
              <h1 className="bd-title">BORDEREAU D&apos;ENVOI</h1>
              <table className="bd-table">
                <thead>
                  <tr>
                    <th className="bd-des">DESIGNATION</th>
                    <th className="bd-qnt">QNT</th>
                    <th className="bd-dst">ENVOIE / DESTINATION</th>
                    <th>OBSERVATION</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${index}-${line.designation}`}>
                      <td>{line.designation}</td>
                      <td className="bd-qnt">{line.qnt}</td>
                      <td>{line.destination}</td>
                      <td>{line.observation}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>TOTAL DES PLIS</td>
                    <td className="bd-qnt">{total}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
              <div className="bd-sign">
                {cachet ? (
                  <div className="bd-box">
                    <p>Cachet et signature</p>
                    <p>{ISSUER.nom}</p>
                  </div>
                ) : null}
                <div className="bd-box">
                  <p>Reçu par EMS le : ____ / ____ / ________</p>
                  <p>Ramasseur : {ramasseur || "______________________"}</p>
                  <p>Signature :</p>
                </div>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td>
            <div className="fx-sp-bot" />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
