import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Default 10MB. Outbound mail JSON includes base64 attachments (up to 24MB
    // raw ≈ 32MB encoded). Truncating that body makes send look successful.
    middlewareClientMaxBodySize: "50mb",
  },
  async rewrites() {
    return [
      // App Router 404s /gso-triage without a page; public file lives at …/index.html
      { source: "/gso-triage", destination: "/gso-triage/index.html" },
      { source: "/gso-triage/", destination: "/gso-triage/index.html" },
    ];
  },
};

export default nextConfig;
