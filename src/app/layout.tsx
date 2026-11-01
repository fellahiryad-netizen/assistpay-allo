import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AssistPay · Allo Assistance", template: "%s · AssistPay" },
  description: "Facturation, créances et règlements – Allo Assistance",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5c1e74" },
    { media: "(prefers-color-scheme: dark)", color: "#1a0b1f" },
  ],
};

/** Applique la charte choisie (Néo par défaut) avant le premier affichage, pour éviter tout clignotement. */
const SKIN_SCRIPT = `(function(){var k="neo";try{k=localStorage.getItem("allo-skin")||"neo"}catch(e){}if(k==="neo")document.documentElement.setAttribute("data-skin","neo")})();`;

/** Mise en page racine. */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SKIN_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
