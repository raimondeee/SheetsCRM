/**
 * Root HTML shell for the local-first CRM (default http://localhost:3000).
 * No app-level auth layout — Google OAuth is handled via /api/auth/* cookies.
 */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SheetsCRM",
  description: "Zendesk-style CRM overlay for Google Sheets intake forms",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
