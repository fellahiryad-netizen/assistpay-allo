import { companyColor, monogramOf } from "@/features/receivables/lib/colors";
import { companySlug } from "@/features/receivables/lib/company";
import { logoPathOf } from "@/features/receivables/config/logos";
import { cn } from "@/utils/cn";

/** Propriétés du logo de compagnie. */
export interface CompanyLogoProps {
  company: string;
  className?: string;
}

/**
 * Logo d'une compagnie : l'image déposée dans `public/partenaires/` si elle figure dans `config/logos.ts`,
 * sinon un monogramme (initiales sur pastille, couleur stable par compagnie). Aucune requête réseau au rendu.
 */
export function CompanyLogo({ company, className }: Readonly<CompanyLogoProps>): React.JSX.Element {
  const path = logoPathOf(companySlug(company));
  if (path) {
    return (
      <img src={path} alt={`Logo ${company}`} className={cn("size-9 shrink-0 rounded-md bg-white object-contain p-0.5", className)} />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-tight text-white", className)}
      style={{ backgroundColor: companyColor(company) }}
    >
      {monogramOf(company)}
    </span>
  );
}
