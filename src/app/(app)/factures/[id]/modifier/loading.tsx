import { Skeleton } from "@/components/ui/skeleton";

/** Chargement du formulaire de modification. */
export default function EditInvoiceLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-96" />
    </div>
  );
}
