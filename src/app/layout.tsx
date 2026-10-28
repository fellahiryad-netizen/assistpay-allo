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

/** Mise en page racine. */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
