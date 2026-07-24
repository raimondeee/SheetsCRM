import { buildDefaultSheetConfig } from "@/lib/default-sheet-config";
import { loadTimerSettings } from "@/lib/crm-preferences-store";
import { normalizeDashboardPeriod } from "@/lib/dashboard-period";
import { buildDashboardStats } from "@/lib/dashboard-stats";
import {
  formatAgentDashboardCsv,
  formatAgentDashboardReportHtml,
  formatMainDashboardCsv,
  formatMainDashboardReportHtml,
  formatTeamDashboardCsv,
  formatTeamDashboardReportHtml,
} from "@/lib/dashboard-report-export";
import { refreshWorkspaceHolidayCache } from "@/lib/business-holidays";
import {
  buildQualityAppealMetrics,
  buildReviewEscalationMetrics,
} from "@/lib/dispute-appeal-stats";
import { loadSheetConfig } from "@/lib/overlay-db";
import {
  loadQualityAppealsSheetTab,
  loadReviewEscalationSheetTab,
  parseQualityAppealRecords,
  parseReviewEscalationRecords,
} from "@/lib/quality-report-loader";
import { buildServiceMetrics } from "@/lib/service-metrics";
import { loadColleagueTeamRecords as fetchColleagueTeamRecords } from "@/lib/team-tab-loader";
import {
  buildTeamMetrics,
  ticketsToTeamRecords,
  type TeamIntakeRecord,
} from "@/lib/team-metrics";
import { getMockTickets } from "@/lib/mock-data";
import { fetchTicketsFromSheet, hasGoogleCredentials } from "@/lib/sheets";

export async function loadDashboardTickets(userEmail: string | null) {
  let config = loadSheetConfig("default");
  if (!config) config = buildDefaultSheetConfig();

  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true" || !hasAuth;
  const timerSettings = loadTimerSettings(userEmail);

  await refreshWorkspaceHolidayCache();

  return useMock
    ? getMockTickets(timerSettings)
    : await fetchTicketsFromSheet(config, timerSettings);
}

export async function loadColleagueTeamRecords(): Promise<{
  records: TeamIntakeRecord[];
  sourcesLoaded: number;
}> {
  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true" || !hasAuth;
  if (useMock) return { records: [], sourcesLoaded: 0 };

  const { colleagueRecords, sourcesLoaded } = await fetchColleagueTeamRecords();
  return { records: colleagueRecords, sourcesLoaded };
}

export async function buildAgentDashboardReportBundle(params: {
  period: ReturnType<typeof normalizeDashboardPeriod>;
  marketManager: string | "all";
  tickets: Awaited<ReturnType<typeof loadDashboardTickets>>;
  userEmail: string | null;
}) {
  let config = loadSheetConfig("default");
  if (!config) config = buildDefaultSheetConfig();

  const timerSettings = loadTimerSettings(params.userEmail);
  const stats = buildDashboardStats(params.tickets, params.period, params.marketManager);
  const filters = {
    periodLabel: stats.periodLabel,
    marketManager: params.marketManager,
  };

  let service = null;
  let review = null;
  let quality = null;

  try {
    service = buildServiceMetrics({
      tickets: params.tickets,
      period: params.period,
      marketManager: params.marketManager,
      sheetConfig: config,
      initialResponseTargetHours: timerSettings.initialResponseHours,
    });
  } catch {
    service = null;
  }

  try {
    const reviewTab = await loadReviewEscalationSheetTab();
    review = buildReviewEscalationMetrics({
      disputes: parseReviewEscalationRecords(reviewTab),
      period: params.period,
      marketManager: params.marketManager,
      teamFilter: "all",
    });
  } catch {
    review = null;
  }

  try {
    const appealsTab = await loadQualityAppealsSheetTab();
    quality = buildQualityAppealMetrics({
      appeals: parseQualityAppealRecords(appealsTab),
      period: params.period,
      agentFilter: "all",
    });
  } catch {
    quality = null;
  }

  const sections = { service, review, quality };
  const csvFilename = `agent-dashboard-${params.period}.csv`.replace(/[^a-z0-9._-]+/gi, "-");

  return {
    stats,
    subject: `SheetsCRM Agent Dashboard — ${stats.periodLabel}`,
    html: formatAgentDashboardReportHtml(stats, filters, sections),
    csv: formatAgentDashboardCsv(stats, filters, sections),
    csvFilename,
  };
}

export function buildMainDashboardReportBundle(params: {
  period: ReturnType<typeof normalizeDashboardPeriod>;
  marketManager: string | "all";
  tickets: Awaited<ReturnType<typeof loadDashboardTickets>>;
}) {
  const stats = buildDashboardStats(params.tickets, params.period, params.marketManager);
  const filters = {
    periodLabel: stats.periodLabel,
    marketManager: params.marketManager,
  };
  const csvFilename = `dashboard-${params.period}.csv`.replace(/[^a-z0-9._-]+/gi, "-");

  return {
    stats,
    subject: `SheetsCRM Dashboard — ${stats.periodLabel}`,
    html: formatMainDashboardReportHtml(stats, filters),
    csv: formatMainDashboardCsv(stats, filters),
    csvFilename,
  };
}

export function buildTeamDashboardReportBundle(params: {
  period: ReturnType<typeof normalizeDashboardPeriod>;
  region: string | "all";
  owner: string | "all";
  tickets: Awaited<ReturnType<typeof loadDashboardTickets>>;
  colleagueRecords: TeamIntakeRecord[];
  sourcesLoaded: number;
}) {
  const allRecords = [...ticketsToTeamRecords(params.tickets), ...params.colleagueRecords];
  const stats = buildTeamMetrics({
    records: allRecords,
    period: params.period,
    regionFilter: params.region,
    ownerFilter: params.owner,
    sourcesLoaded: params.sourcesLoaded,
  });
  const filters = {
    periodLabel: stats.periodLabel,
    region: params.region,
    owner: params.owner,
  };
  const csvFilename = `team-dashboard-${params.period}.csv`.replace(/[^a-z0-9._-]+/gi, "-");

  return {
    stats,
    subject: `SheetsCRM Team Dashboard — ${stats.periodLabel}`,
    html: formatTeamDashboardReportHtml(stats, filters),
    csv: formatTeamDashboardCsv(stats, filters),
    csvFilename,
  };
}

export function csvAttachmentForReport(csv: string, filename: string) {
  return {
    filename,
    mimeType: "text/csv",
    data: Buffer.from(csv, "utf-8"),
  };
}

export function pdfAttachmentForReport(data: Buffer, filename: string) {
  const safeName = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  return {
    filename: safeName.replace(/[^a-z0-9._-]+/gi, "-"),
    mimeType: "application/pdf",
    data,
  };
}

export function zipAttachmentForReport(data: Buffer, filename: string) {
  const safeName = filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`;
  return {
    filename: safeName.replace(/[^a-z0-9._-]+/gi, "-"),
    mimeType: "application/zip",
    data,
  };
}
