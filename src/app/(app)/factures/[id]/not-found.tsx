import Link from "next/link";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";

/** Facture introuvable. */
export default function InvoiceNotFound(): React.JSX.Element {
  return (
    <StateMessage
      kind="empty"
      title="Facture introuvable"
      message="Elle a peut-être été supprimée, ou le lien est incomplet."
      action={
        <Link href="/factures" className={buttonVariants({ variant: "outline" })}>
          Retour aux factures
        </Link>
      }
    />
  );
}
