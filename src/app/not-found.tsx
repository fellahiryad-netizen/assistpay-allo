import Link from "next/link";
import { StateMessage } from "@/components/common/state-message";
import { buttonVariants } from "@/components/ui/button";

/** Page introuvable. */
export default function NotFound(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <StateMessage
        kind="empty"
        title="Page introuvable"
        message="Le lien est peut-être incomplet."
        action={
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Retour à l&apos;accueil
          </Link>
        }
      />
    </main>
  );
}
