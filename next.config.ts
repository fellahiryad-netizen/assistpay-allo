import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // En-têtes de sécurité : pas d'affichage dans un cadre d'un autre site, pas de détection de type, référent limité.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
