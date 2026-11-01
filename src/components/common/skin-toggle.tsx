"use client";

import { useEffect, useState } from "react";

type Skin = "neo" | "classique";

/** Applique la charte sur la page et la mémorise dans ce navigateur (sans effet si le stockage est bloqué). */
function applySkin(skin: Skin): void {
  const root = document.documentElement;
  if (skin === "neo") root.setAttribute("data-skin", "neo");
  else root.removeAttribute("data-skin");
  try {
    localStorage.setItem("allo-skin", skin);
  } catch {
    /* stockage indisponible : la charte reste valable pour la page en cours */
  }
}

/** Bouton du menu : bascule entre la charte Néo (sombre) et la charte classique (claire). */
export function SkinToggle(): React.JSX.Element {
  const [skin, setSkin] = useState<Skin>("neo");

  useEffect(() => {
    setSkin(document.documentElement.getAttribute("data-skin") === "neo" ? "neo" : "classique");
  }, []);

  function toggle(): void {
    const next: Skin = skin === "neo" ? "classique" : "neo";
    applySkin(next);
    setSkin(next);
  }

  return (
    <button type="button" className="skin-btn" onClick={toggle} aria-pressed={skin === "neo"}>
      {skin === "neo" ? "◐ Revenir au classique" : "✦ Passer en mode Néo"}
    </button>
  );
}
