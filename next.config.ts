import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    return [
      // App Router 404s /gso-triage without a page; public file lives at …/index.html
      { source: "/gso-triage", destination: "/gso-triage/index.html" },
      { source: "/gso-triage/", destination: "/gso-triage/index.html" },
    ];
  },
};

export default nextConfig;
