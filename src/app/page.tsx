/**
 * Sole UI route for SheetsCRM.
 *
 * There is no multi-page App Router tree: views (tickets, dashboards, setup)
 * are client-side state inside CrmShell. All server work lives under /api/*.
 * Broader architecture: docs/ENGINEERING_AND_SECURITY.md
 */
import { CrmShell } from "@/components/CrmShell";

export default function HomePage() {
  return <CrmShell />;
}
