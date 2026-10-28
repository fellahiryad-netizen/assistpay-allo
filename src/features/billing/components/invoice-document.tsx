import { ISSUER, num, presetById, r2, type BillingColumn, type ComputedRow } from "@/features/billing/config";
import { columnLabel, computeBilling, modelOf } from "@/features/billing/services/billing-calc";
import type { BillingDraft } from "@/features/billing/types";
import { amountInWords } from "@/utils/amounts";
import { formatDate } from "@/utils/format";

const money = (value: number): string => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const integer = (value: number): string => new Intl.NumberFormat("fr-FR").format(value);

function cell(col: BillingColumn, row: ComputedRow): string {
  const value = row[col.k];
  if (value === undefined || value === "") return "";
  if (col.t === "money") return value === "-" ? "-" : money(num(value));
  if (col.t === "num") return value === "-" || Number.isNaN(num(value)) ? String(value) : integer(num(value));
  return String(value);
}

interface PageProps {
  draft: BillingDraft;
  presetId: string;
  number: string;
  rows: ComputedRow[];
  totals: Array<[string, number, boolean?]>;
  ttc: number;
}

function Page({ draft, presetId, number, rows, totals, ttc }: Readonly<PageProps>): React.JSX.Element {
  const preset = presetById(presetId);
  const model = modelOf(preset);
  const columns = model.cols;
  const meta: Array<[string, string]> = [
    ["Facture N°", number],
    [`${ISSUER.ville} le`, formatDate(draft.date)],
    [preset.objLbl ?? "Honoraire", draft.objet],
  ];
  if (preset.succ && draft.succ) meta.push(["Succursale", draft.succ]);
  if (preset.bc && draft.bc) meta.push(["Bon de commande N°", draft.bc]);
  const perTitle = preset.perTitle ?? (preset.m === "caar" ? "Mois de" : "Période");
  const party = (title: string, data: { nom: string; adresse: string; tel: string; rc: string; nif: string; nis: string; ai?: string }): React.JSX.Element => (
    <div className="fx-box">
      <h4>{title}</h4>
      <div className="nm">{data.nom}</div>
      {(
        [
          ["adresse", "Adresse :"],
          ["tel", "Téléphone :"],
          ["rc", "RC :"],
          ["nif", "NIF :"],
          ["nis", "NIS :"],
          ["ai", "Art. d'imposition :"],
        ] as const
      )
        .filter(([key]) => data[key])
        .map(([key, label]) => (
          <div key={key}>
            <b>{label}</b> {data[key]}
          </div>
        ))}
    </div>
  );
  const details = Object.entries(draft.details).filter(([, value]) => value.trim());
  return (
    <div className="fx-page">
      <div className="fx-top">
        <img className="fx-logo" src="/logo-allo.png" alt="Allo Assistance" />
        <div>
          <h1>FACTURE</h1>
          <table className="fx-meta">
            <tbody>
              {meta.map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    <b>{value}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="fx-parties">
        {party("Émetteur", { ...ISSUER, ai: draft.emAi ?? "" })}
        {party("Client", draft.cli)}
      </div>
      {draft.perTxt ? (
        <div className="fx-per">
          {perTitle ? <b>{perTitle} </b> : null}
          {draft.perTxt}
          {preset.m === "caar" && draft.succ ? ` — Succursale ${draft.succ}` : ""}
        </div>
      ) : null}
      {/^bdg/.test(preset.m) && draft.succ ? (
        <div className="fx-per">
          <b>SUCCURSALE {draft.succ.toUpperCase()}</b>
        </div>
      ) : null}
      {preset.route && (draft.origine || draft.destination) ? (
        <div className="fx-per">
          <b>Origine :</b> {draft.origine} &nbsp; <b>Destination :</b> {draft.destination}
        </div>
      ) : null}
      {preset.details && details.length ? (
        <table className="fx-kv">
          <tbody>
            <tr>
              <th colSpan={2}>Détails de la prestation</th>
            </tr>
            {details.map(([key, value]) => (
              <tr key={key}>
                <td>{DETAIL_LABELS[key] ?? key}</td>
                <td>
                  <b>{value}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <table className={`fx-t${columns.length + (model.numbered ? 1 : 0) >= 6 ? " wide" : ""}`}>
        <thead>
          <tr>
            {model.numbered ? <th>N°</th> : null}
            {columns.map((col) => (
              <th key={col.k} className={col.t ? "n" : undefined} style={col.w ? { width: col.w } : undefined}>
                {columnLabel(preset, col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={row.info ? "info" : undefined}>
              {model.numbered ? <td>{index + 1}</td> : null}
              {columns.map((col) => (
                <td key={col.k} className={col.t ? "n" : undefined}>
                  {cell(col, row)}
                </td>
              ))}
            </tr>
          ))}
          {model.sumRow ? (
            <tr className="sum">
              {columns.map((col, index) => (
                <td key={col.k} className={col.t ? "n" : undefined}>
                  {index === 0
                    ? "Total général"
                    : col.t === "money" && !col.nosum
                      ? money(r2(rows.reduce((sum, row) => sum + num(row[col.k]), 0)))
                      : col.sum
                        ? integer(rows.reduce((sum, row) => sum + num(row[col.k]), 0))
                        : ""}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
      {draft.notes ? <div className="fx-notes">{draft.notes}</div> : null}
      <table className="fx-tot">
        <tbody>
          {totals.map(([label, value, strong]) => (
            <tr key={label} className={strong ? "ttc" : undefined}>
              <td>{label}</td>
              <td className="n">{money(value)} DA</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fx-words">
        La présente facture est arrêtée à la somme de : <b>{amountInWords(ttc)}</b>
      </div>
      <div className="fx-foot">
        <div>
          <b>Règlement par chèque ou virement sur le compte bancaire suivant :</b>
          <br />
          {ISSUER.banque}
          <br />
          RIB : <b>{ISSUER.rib}</b>
          <br />
          <br />
          <b>Conditions de règlement :</b> {ISSUER.conditions}
        </div>
        <div className="fx-sign">Cachet et signature</div>
      </div>
      <div className="fx-legal">
        {ISSUER.nom} — {ISSUER.adresse} — RC {ISSUER.rc} — NIF {ISSUER.nif} — NIS {ISSUER.nis}
      </div>
    </div>
  );
}

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  date: "Date et heure d'intervention",
  type: "Type de prestation",
  immat: "Immatriculation du véhicule",
  modele: "Modèle du véhicule",
  lieu: "Lieu de prise en charge",
  dest: "Destination",
};

/**
 * Facture imprimable. Facture BDG « débours + frais » : deux pages (une facture chacune, n° consécutifs).
 * BDG GAM : page de synthèse + annexe détaillée des dossiers.
 */
export function InvoiceDocument({ draft }: Readonly<{ draft: BillingDraft }>): React.JSX.Element {
  const preset = presetById(draft.preset);
  const { rows, totals } = computeBilling(draft);
  if (preset.m === "bdgpair") {
    const debRows = rows.map((row) => ({ ag: row.ag ?? "", nb: row.nb ?? "", mt: row.mt ?? "" }));
    const fraRows = rows.map((row) => ({ ag: row.ag ?? "", nb: row.nb ?? "", pu: row.pu ?? "", ft: row.ft ?? 0 }));
    const deb = totals.deb ?? { ht: 0, tva: 0, ttc: 0 };
    const fra = totals.fra ?? { ht: 0, tva: 0, ttc: 0 };
    const invoiceTotals = (part: { ht: number; tva: number; ttc: number }): Array<[string, number, boolean?]> => [
      ["TOTAL HT", part.ht],
      ["TVA 19 %", part.tva],
      ["TOTAL TTC", part.ttc, true],
    ];
    return (
      <>
        {draft.bdgType !== "fra" ? <BdgPage draft={draft} presetId="_bdgdeb" number={draft.num} rows={debRows} totals={invoiceTotals(deb)} ttc={deb.ttc} /> : null}
        {draft.bdgType !== "deb" ? <BdgPage draft={draft} presetId="_bdgfra" number={draft.num2} rows={fraRows} totals={invoiceTotals(fra)} ttc={fra.ttc} /> : null}
      </>
    );
  }
  if (preset.m === "bdggam") {
    const lines = rows.filter((row) => String(row.dos ?? "").trim() || num(row.prix));
    const ht = r2(lines.reduce((sum, row) => sum + num(row.prix), 0));
    const tva = r2(ht * 0.19);
    const summary: BillingDraft = { ...draft, preset: "_bdggamsum", notes: [draft.notes, lines.length ? `Détail des ${lines.length} dossiers en annexe.` : ""].filter(Boolean).join("\n") };
    return (
      <>
        <BdgPage
          draft={summary}
          presetId="_bdggamsum"
          number={draft.num}
          rows={[{ nb: String(lines.length), des: "FOURNITURE ET POSE", qte: String(lines.length), ht: String(ht) }]}
          totals={[["TOTAL HT", ht], ["TVA 19 %", tva], ["TOTAL TTC", r2(ht + tva), true]]}
          ttc={r2(ht + tva)}
        />
        <div className="fx-page">
          <div className="fx-top">
            <div>
              <b style={{ fontSize: 16, color: "#6b1f86" }}>ANNEXE — DÉTAIL DES DOSSIERS</b>
              <br />
              {preset.typ} · Facture N° <b>{draft.num}</b> du {formatDate(draft.date)}
              {draft.perTxt ? ` · ${draft.perTxt}` : ""}
            </div>
          </div>
          <table className="fx-t wide">
            <thead>
              <tr>
                {["N", "N° dossier", "Matricule", "Nom client", "Agence", "Prestation", "Date", "N° sinistre", "Prix HT", "TVA", "TTC"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((row, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>{row.dos}</td>
                  <td>{row.mat}</td>
                  <td>{row.nom}</td>
                  <td>{row.ag}</td>
                  <td>{row.pres}</td>
                  <td>{row.dt}</td>
                  <td>{row.sin}</td>
                  <td className="n">{money(num(row.prix))}</td>
                  <td className="n">{money(r2(num(row.prix) * 0.19))}</td>
                  <td className="n">{money(r2(num(row.prix) * 1.19))}</td>
                </tr>
              ))}
              <tr className="sum">
                <td colSpan={8}>Total : {lines.length} dossiers</td>
                <td className="n">{money(ht)}</td>
                <td className="n">{money(tva)}</td>
                <td className="n">{money(r2(ht + tva))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return <Page draft={draft} presetId={draft.preset} number={draft.num} rows={rows} totals={totals.lines} ttc={totals.ttc} />;
}

/** Page d'une facture BDG (modèles internes « _bdgdeb », « _bdgfra », « _bdggamsum »). */
function BdgPage(props: Readonly<PageProps>): React.JSX.Element {
  return <Page {...props} />;
}
