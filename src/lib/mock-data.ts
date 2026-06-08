import type { Ticket } from "./types";
import { EXAMPLE_SPREADSHEET_ID } from "./default-sheet-config";
import { mergeOverlayOntoTicket } from "./overlay-db";

/** Mock tickets mirroring example sheet column layout (K/M/R/N positions) */
export function getMockTickets(): Ticket[] {
  const base: Omit<
    Ticket,
    "status" | "slaHours" | "slaDueAt" | "slaBreached" | "lastResponseAt"
  >[] = [
    {
      rowId: `${EXAMPLE_SPREADSHEET_ID}:Form Responses:2`,
      rowNumber: 2,
      spreadsheetId: EXAMPLE_SPREADSHEET_ID,
      sheetName: "Form Responses",
      timestamp: "2026-06-07 09:14:22",
      requesterEmail: "alex.morgan@acmecorp.com",
      requesterName: "Alex Morgan",
      subject: "Billing discrepancy on invoice #8842",
      description:
        "We were charged twice for the March subscription. Please review and issue a credit.",
      contactReason: "Billing",
      marketManager: "Jordan Lee <jordan.lee@ext.airbnb.com>",
      sheetStatus: "Awaiting review",
      sheetCaseSummary: "Double charge confirmed on 3/15. Credit pending.",
      adminNotes: "",
      airbnbUserId: "USR-8842",
      internalTools: {
        k: "https://admin.internal.example/customers/CUST-8842",
        m: "https://dashboard.internal.example/accounts/ACC-12091",
        r: "REF-2026-8842-BILL",
      },
      raw: {},
    },
    {
      rowId: `${EXAMPLE_SPREADSHEET_ID}:Form Responses:3`,
      rowNumber: 3,
      spreadsheetId: EXAMPLE_SPREADSHEET_ID,
      sheetName: "Form Responses",
      timestamp: "2026-06-07 11:30:05",
      requesterEmail: "sarah.kim@northwind.io",
      requesterName: "Sarah Kim",
      subject: "API rate limit increase request",
      description: "Our production traffic spiked. Need temporary rate limit bump for 48h.",
      contactReason: "API access",
      marketManager: "sam.patel@ext.airbnb.com",
      sheetStatus: "In progress",
      sheetCaseSummary: "Temporary bump approved through Friday.",
      adminNotes: "",
      airbnbUserId: "USR-3310",
      internalTools: {
        k: "https://admin.internal.example/customers/CUST-3310",
        m: "https://metrics.internal.example/tenants/TNT-991",
        r: "REF-2026-3310-API",
      },
      raw: {},
    },
    {
      rowId: `${EXAMPLE_SPREADSHEET_ID}:Form Responses:4`,
      rowNumber: 4,
      spreadsheetId: EXAMPLE_SPREADSHEET_ID,
      sheetName: "Form Responses",
      timestamp: "2026-06-08 08:02:17",
      requesterEmail: "devops@brightline.co",
      requesterName: "Brightline DevOps",
      subject: "SSO configuration failing for Okta",
      description: "SAML assertion rejected after cert rotation yesterday.",
      contactReason: "SSO / Login",
      marketManager: "Alex Kim",
      sheetStatus: "New",
      sheetCaseSummary: "",
      adminNotes: "",
      airbnbUserId: "USR-5501",
      internalTools: {
        k: "https://admin.internal.example/customers/CUST-5501",
        m: "https://sso.internal.example/orgs/ORG-5501",
        r: "REF-2026-5501-SSO",
      },
      raw: {},
    },
  ];

  return base.map((t) =>
    mergeOverlayOntoTicket({
      ...t,
      status: "new",
      slaHours: 24,
      slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      slaBreached: false,
      lastResponseAt: null,
    })
  );
}
