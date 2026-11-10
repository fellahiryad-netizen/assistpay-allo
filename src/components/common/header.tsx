import { LogOut } from "lucide-react";
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
