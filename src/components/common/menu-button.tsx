"use client";

import { Menu } from "lucide-react";
import { useSidebarStore } from "@/components/common/sidebar-store";
import { Button } from "@/components/ui/button";

/** Bouton d'ouverture du menu latéral (mobile uniquement). */
export function MenuButton(): React.JSX.Element {
  const toggle = useSidebarStore((state) => state.toggle);
  return (
    <Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={toggle} aria-label="Ouvrir le menu">
      <Menu />
    </Button>
  );
}
