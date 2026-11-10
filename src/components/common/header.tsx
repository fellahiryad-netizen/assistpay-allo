import { LogOut, Search } from "lucide-react";
import { logoutAction } from "@/app/actions/auth-actions";
import { MenuButton } from "@/components/common/menu-button";
import { Button } from "@/components/ui/button";

/** Propriétés de l'en-tête. */
export interface HeaderProps {
  userName: string;
  profileLabel: string;
}

/** En-tête : bouton de menu (mobile), utilisateur connecté et déconnexion. */
export function Header({ userName, profileLabel }: Readonly<HeaderProps>): React.JSX.Element {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
      <MenuButton />
      <form action="/recherche-montant" method="get" className="flex items-center gap-1" role="search">
        <label htmlFor="header-amount" className="sr-only">
          Rechercher un montant
        </label>
        <input
          id="header-amount"
          name="m"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Chercher un montant…"
          className="h-9 w-40 rounded-md border bg-background px-2 text-sm sm:w-56"
        />
        <Button type="submit" variant="outline" size="sm" aria-label="Lancer la recherche par montant">
          <Search />
        </Button>
      </form>
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right leading-tight sm:block">
          <p className="text-sm font-medium">{userName}</p>
          <p className="text-xs text-muted-foreground">{profileLabel}</p>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm" aria-label="Se déconnecter">
            <LogOut />
            <span className="hidden sm:inline">Déconnexion</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
