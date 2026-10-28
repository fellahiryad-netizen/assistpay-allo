import { Skeleton } from "@/components/ui/skeleton";

/** Chargement du journal. */
export default function JournalLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-56" />
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} className="h-10" />
      ))}
    </div>
  );
}
