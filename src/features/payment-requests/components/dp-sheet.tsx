import type { PaymentRequestDTO } from "@/features/payment-requests/types";
import { amountInWords } from "@/utils/amounts";
import { formatDA, formatDate } from "@/utils/format";

/** Contenu affiché sur la fiche. */
export type DpSheetData = Pick<PaymentRequestDTO, "ref" | "date" | "beneficiaire" | "adresse" | "montant" | "nature" | "mode" | "produit" | "pieces">;

function Box({ checked }: Readonly<{ checked: boolean }>): React.JSX.Element {
  return <span className="dp-box">{checked ? "X" : ""}</span>;
}

/** Fiche « Demande de paiement » (modèle EURL ALLO ASSISTANCE), prête à imprimer. */
export function DpSheet({ data }: Readonly<{ data: DpSheetData }>): React.JSX.Element {
  const pieces = [...data.pieces.slice(0, 12)];
  while (pieces.length < 12) pieces.push("");
  return (
    <div className="dp-sheet">
      <div style={{ display: "flex", alignItems: "center", gap: "6mm" }}>
        <img src="/logo-allo.png" alt="Allo Assistance" style={{ height: "16mm" }} />
        <div style={{ fontWeight: 700, fontSize: "14pt" }}>EURL ALLO ASSISTANCE</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "8mm", borderBottom: "2px solid #000", paddingBottom: "2mm" }}>
        <span style={{ fontSize: "13pt", fontWeight: 700 }}>
          Demande de paiement n° <span style={{ fontSize: "15pt" }}>{data.ref}</span>
        </span>
        <span>{data.date ? formatDate(data.date) : ""}</span>
      </div>
      <div className="dp-row">
        <span className="dp-label">ORDONNATEUR</span>
        <span>DIRECTION GENERALE</span>
      </div>
      <div className="dp-row">
        <span className="dp-label">BENEFICIAIRE</span>
        <span style={{ border: "1px solid #000", padding: "1mm 3mm", fontWeight: 700, flex: 1 }}>{data.beneficiaire}</span>
      </div>
      <div className="dp-row">
        <span className="dp-label">ADRESSE</span>
        <span className="dp-line" style={{ flex: 1 }}>
          {data.adresse}
        </span>
      </div>
      <div className="dp-row">
        <span className="dp-label" style={{ width: "auto" }}>
          MONTANT EN CHIFFRES ET EN LETTRES
        </span>
        <span style={{ marginLeft: "auto", border: "1px solid #000", padding: "1mm 3mm", fontWeight: 700 }}>{formatDA(data.montant)}</span>
      </div>
      <p style={{ marginTop: "3mm", fontWeight: 700, textTransform: "uppercase" }}>{amountInWords(data.montant)}</p>
      <div className="dp-row">
        <span className="dp-label">NATURE DE LA DEPENSE</span>
      </div>
      <p className="dp-line" style={{ fontWeight: 700 }}>
        {data.nature}
      </p>
      <p className="dp-line" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", marginTop: "5mm", fontWeight: 700 }}>
        <span>Type de règlement :</span>
        <span>Type de prestataire :</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto auto auto", gap: "2mm 4mm", alignItems: "center", marginTop: "2mm", width: "fit-content" }}>
        <span>Virement</span>
        <Box checked={data.mode === "VIRMT"} />
        <span>Assistance routière</span>
        <Box checked={data.produit === "Assistance routière"} />
        <span>Tiers payant</span>
        <Box checked={data.produit === "Tiers payant"} />
        <span>Chèque</span>
        <Box checked={data.mode === "CHEQUE"} />
        <span>BDG</span>
        <Box checked={data.produit === "BDG"} />
        <span>Autre</span>
        <Box checked={data.produit === "Autre"} />
      </div>
      <div className="dp-row">
        <span className="dp-label">PIECES JOINTES</span>
      </div>
      {pieces.map((piece, index) => (
        <p key={index} className="dp-line" style={index === 0 ? { fontWeight: 700 } : undefined}>
          {piece}
        </p>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10mm", fontWeight: 700 }}>
        <span>VISA ORDONNATEUR</span>
        <span>VISA DFC</span>
        <span>VISA DG</span>
      </div>
    </div>
  );
}
