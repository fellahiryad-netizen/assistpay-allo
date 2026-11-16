import { ISSUER } from "@/features/billing/config";
import type { AvoirPrintData } from "@/features/avoirs/types";
import { formatDate } from "@/utils/format";

const money = (value: number): string => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const SUITE: Readonly<Record<string, string>> = {
  aucune: "",
  remboursement: "Le montant de l'avoir fera l'objet d'un remboursement par virement.",
  imputation: "Le montant de l'avoir sera imputé sur la prochaine facture.",
};

/** Facture d'avoir imprimable : noir et blanc, tout en gras, sans fond ni gris, sur papier à en-tête (marges réservées). */
export function AvoirDocument({ data }: Readonly<{ data: AvoirPrintData }>): React.JSX.Element {
  const party = (title: string, lines: Array<[string, string]>, name: string): React.JSX.Element => (
    <div className="flex-1 border-2 border-black p-3">
      <h4 className="mb-1 text-sm font-extrabold uppercase">{title}</h4>
      <p className="text-base font-extrabold">{name}</p>
      {lines.filter(([, value]) => value).map(([label, value]) => (
        <p key={label} className="text-xs font-bold">
          {label} {value}
        </p>
      ))}
    </div>
  );
  return (
    <section className="mx-auto w-[210mm] max-w-full bg-white px-[14mm] pb-[18mm] pt-[45mm] font-bold text-black print:w-auto print:px-[14mm] print:pt-[45mm]" style={{ color: "#000" }}>
      {data.annule ? <p className="mb-3 border-2 border-black p-2 text-center text-lg font-extrabold uppercase">Avoir annulé : ne pas utiliser</p> : null}
      <header className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-extrabold uppercase">Facture d&apos;avoir</h1>
          <p className="text-lg font-extrabold">N° {data.num}</p>
        </div>
        <p className="text-right text-sm font-extrabold">
          {ISSUER.ville}, le {formatDate(data.date)}
        </p>
      </header>
      <div className="mb-5 flex gap-4">
        {party(
          "Émetteur",
          [
            ["Adresse :", ISSUER.adresse],
            ["Téléphone :", ISSUER.tel],
            ["RC :", ISSUER.rc],
            ["NIF :", ISSUER.nif],
            ["NIS :", ISSUER.nis],
          ],
          ISSUER.nom,
        )}
        {party(
          "Client",
          [
            ["Adresse :", data.cli.adresse],
            ["Téléphone :", data.cli.tel],
            ["RC :", data.cli.rc],
            ["NIF :", data.cli.nif],
            ["NIS :", data.cli.nis],
            ["Art. d'imposition :", data.cli.ai],
          ],
          data.cli.nom,
        )}
      </div>
      <div className="mb-5 border-2 border-black p-3 text-sm font-bold">
        <p className="font-extrabold">
          Avoir sur la facture n° {data.origine.num} du {formatDate(data.origine.date)}
        </p>
        {data.origine.succ ? <p>Succursale : {data.origine.succ}</p> : null}
        {data.origine.perTxt ? <p>Période : {data.origine.perTxt}</p> : null}
        <p>Motif : {data.motif}</p>
      </div>
      <table className="mb-4 w-full border-collapse border-2 border-black text-sm font-bold">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="border-r-2 border-black p-2 text-left font-extrabold">Désignation</th>
            <th className="border-r-2 border-black p-2 text-right font-extrabold">Montant HT</th>
            <th className="border-r-2 border-black p-2 text-right font-extrabold">TVA</th>
            <th className="p-2 text-right font-extrabold">Montant TTC</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-black">
            <td className="border-r-2 border-black p-2">Facture d&apos;origine n° {data.origine.num}</td>
            <td className="border-r-2 border-black p-2 text-right tabular-nums">{money(data.origine.ht)}</td>
            <td className="border-r-2 border-black p-2 text-right tabular-nums">{money(data.origine.tva)}</td>
            <td className="p-2 text-right tabular-nums">{money(data.origine.ttc)}</td>
          </tr>
          <tr className="border-b-2 border-black text-base font-extrabold">
            <td className="border-r-2 border-black p-2">Avoir {data.num}</td>
            <td className="border-r-2 border-black p-2 text-right tabular-nums">{money(data.ht)}</td>
            <td className="border-r-2 border-black p-2 text-right tabular-nums">{money(data.tva)}</td>
            <td className="p-2 text-right tabular-nums">{money(data.ttc)}</td>
          </tr>
        </tbody>
      </table>
      <div className="mb-4 ml-auto w-72 border-2 border-black p-3 text-sm font-bold">
        {data.avoirsPrecedents > 0 ? (
          <p className="flex justify-between">
            <span>Avoirs précédents</span>
            <span className="tabular-nums">−{money(data.avoirsPrecedents)}</span>
          </p>
        ) : null}
        <p className="flex justify-between text-base font-extrabold">
          <span>Total de l&apos;avoir TTC</span>
          <span className="tabular-nums">{money(data.ttc)} DA</span>
        </p>
        <p className="flex justify-between">
          <span>Reste dû sur la facture</span>
          <span className="tabular-nums">{money(data.netRestant)} DA</span>
        </p>
      </div>
      <p className="mb-2 text-sm font-extrabold">Arrêté le présent avoir à la somme de : {data.lettres}.</p>
      {SUITE[data.suite] ? <p className="mb-2 text-sm font-bold">{SUITE[data.suite]}</p> : null}
      {data.emAi ? <p className="mb-2 text-xs font-bold">Article d&apos;imposition : {data.emAi}</p> : null}
      <div className="mt-10 flex justify-between text-sm font-extrabold">
        <div className="h-28 w-56 border-2 border-black p-2">Cachet et signature de l&apos;émetteur</div>
        <div className="h-28 w-56 border-2 border-black p-2">Visa du client</div>
      </div>
    </section>
  );
}
