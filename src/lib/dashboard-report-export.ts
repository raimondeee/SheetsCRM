import {
  formatHostsByMarketManagerReport,
  formatHostsByMarketManagerReportHtml,
  type CountItem,
  type DashboardStats,
  type WeekSeriesPoint,
} from "./dashboard-stats";
import type {
  QualityAppealMetricsSnapshot,
  ReviewEscalationMetricsSnapshot,
} from "./dispute-appeal-stats";
import { escapeHtml } from "./html-utils";
import { formatBusinessMinutes } from "./business-hours";
import type { ServiceMetricsSnapshot } from "./service-metrics";
import type { TeamMetricsSnapshot } from "./team-metrics";

export interface MainDashboardReportFilters {
  periodLabel: string;
  marketManager: string | "all";
}

export interface TeamDashboardReportFilters {
  periodLabel: string;
  region: string | "all";
  owner: string | "all";
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

function filterLine(label: string, value: string | "all"): string {
  return value === "all" ? `${label}: all` : `${label}: ${value}`;
}

function formatBreakdownPlain(title: string, items: CountItem[], total: number): string[] {
  if (items.length === 0) return [`${title}`, "  (none)", ""];
  const lines = [`${title}`];
  for (const item of items) {
    const pct = total > 0 ? ` (${Math.round((item.value / total) * 100)}%)` : "";
    lines.push(`  ${item.name}: ${item.value.toLocaleString()}${pct}`);
  }
  lines.push("");
  return lines;
}

function formatBreakdownHtml(title: string, items: CountItem[], total: number): string {
  if (items.length === 0) {
    return `<p style="margin: 12px 0 4px; font-weight: bold;">${escapeHtml(title)}</p><p style="color: #68737d;">(none)</p>`;
  }
  const cellStyle = "border: 1px solid #d8dcde; padding: 6px 8px;";
  const rows = items
    .map((item) => {
      const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
      return `<tr><td style="${cellStyle}">${escapeHtml(item.name)}</td><td style="${cellStyle} text-align: right;">${item.value.toLocaleString()}</td><td style="${cellStyle} text-align: right; color: #68737d;">${pct}%</td></tr>`;
    })
    .join("");
  return [
    `<p style="margin: 16px 0 8px; font-weight: bold;">${escapeHtml(title)}</p>`,
    `<table style="border-collapse: collapse; width: 100%; max-width: 480px; font-size: 13px;"><thead><tr style="background: #f4f6f8;"><th style="${cellStyle} text-align: left;">Name</th><th style="${cellStyle} text-align: right; width: 72px;">Count</th><th style="${cellStyle} text-align: right; width: 56px;">%</th></tr></thead><tbody>${rows}</tbody></table>`,
  ].join("");
}

function appendWeekSeriesCsv(
  lines: string[],
  title: string,
  series: WeekSeriesPoint[],
  extraKeys: string[]
): void {
  lines.push("");
  lines.push(title);
  const headers = ["Week", "Total", ...extraKeys];
  lines.push(csvRow(headers));
  for (const point of series) {
    lines.push(
      csvRow([
        point.weekLabel,
        point.total,
        ...extraKeys.map((key) => {
          const value = point[key];
          return typeof value === "number" ? value : 0;
        }),
      ])
    );
  }
}

function appendBreakdownCsv(
  lines: string[],
  section: string,
  items: CountItem[]
): void {
  lines.push("");
  lines.push(`${section}`);
  lines.push(csvRow(["Name", "Count"]));
  for (const item of items) {
    lines.push(csvRow([item.name, item.value]));
  }
}

export function formatMainDashboardReportPlain(
  stats: DashboardStats,
  filters: MainDashboardReportFilters
): string {
  const lines: string[] = [
    `SheetsCRM Dashboard — ${filters.periodLabel}`,
    filterLine("Market manager", filters.marketManager),
    "",
    `Tickets in period: ${stats.periodTicketCount.toLocaleString()}`,
    `All time (filtered): ${stats.totalTickets.toLocaleString()}`,
    "",
    ...formatBreakdownPlain("Contact reason", stats.contactReasonBreakdown, stats.periodTicketCount),
    ...formatBreakdownPlain("Market manager", stats.marketManagerBreakdown, stats.periodTicketCount),
    ...formatBreakdownPlain("Top regional hosts", stats.topRegionalHosts, stats.periodTicketCount),
    formatHostsByMarketManagerReport({
      periodLabel: filters.periodLabel,
      marketManagerFilter: filters.marketManager,
      groups: stats.topHostsByMarketManager,
    }),
  ];
  return lines.join("\n").trimEnd();
}

export function formatMainDashboardReportHtml(
  stats: DashboardStats,
  filters: MainDashboardReportFilters
): string {
  const filterHtml =
    filters.marketManager === "all"
      ? "Market manager: all in period"
      : `Market manager: ${escapeHtml(filters.marketManager)}`;

  const parts: string[] = [
    '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #17494d;">',
    `<p style="margin: 0 0 4px;"><strong>SheetsCRM Dashboard — ${escapeHtml(filters.periodLabel)}</strong></p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">${filterHtml}</p>`,
    `<p style="margin: 0 0 4px;"><strong>${stats.periodTicketCount.toLocaleString()}</strong> tickets in period · <strong>${stats.totalTickets.toLocaleString()}</strong> all time (filtered)</p>`,
    formatBreakdownHtml("Contact reason", stats.contactReasonBreakdown, stats.periodTicketCount),
    formatBreakdownHtml("Market manager", stats.marketManagerBreakdown, stats.periodTicketCount),
    formatBreakdownHtml("Top regional hosts", stats.topRegionalHosts, stats.periodTicketCount),
    formatHostsByMarketManagerReportHtml({
      periodLabel: filters.periodLabel,
      marketManagerFilter: filters.marketManager,
      groups: stats.topHostsByMarketManager,
    }),
    '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
    "</div>",
  ];
  return parts.join("");
}

export function formatMainDashboardCsv(
  stats: DashboardStats,
  filters: MainDashboardReportFilters
): string {
  const lines: string[] = [
    csvRow(["Report", "SheetsCRM Dashboard"]),
    csvRow(["Period", filters.periodLabel]),
    csvRow(["Market manager", filters.marketManager === "all" ? "All" : filters.marketManager]),
    csvRow(["Tickets in period", stats.periodTicketCount]),
    csvRow(["All time filtered", stats.totalTickets]),
  ];

  appendBreakdownCsv(lines, "Contact reason", stats.contactReasonBreakdown);
  appendBreakdownCsv(lines, "Market manager", stats.marketManagerBreakdown);
  appendBreakdownCsv(lines, "Top regional hosts", stats.topRegionalHosts);
  appendWeekSeriesCsv(lines, "Cases by week", stats.casesByWeek, []);
  appendWeekSeriesCsv(
    lines,
    "Contact reason by week",
    stats.contactReasonByWeek,
    stats.contactReasonWeekKeys
  );
  appendWeekSeriesCsv(lines, "Status by week", stats.statusByWeek, ["Resolved", "Pending"]);

  lines.push("");
  lines.push("Top hosts by market manager");
  lines.push(csvRow(["Market manager", "Rank", "Host", "Contacts", "Contact reasons"]));
  for (const group of stats.topHostsByMarketManager) {
    group.hosts.forEach((host, index) => {
      const reasons = host.contactReasons.map((r) => `${r.name} (${r.value})`).join("; ");
      lines.push(
        csvRow([group.marketManager, index + 1, host.name, host.value, reasons])
      );
    });
  }

  return lines.join("\n");
}

export function formatTeamDashboardReportPlain(
  stats: TeamMetricsSnapshot,
  filters: TeamDashboardReportFilters
): string {
  const lines: string[] = [
    `SheetsCRM Team Dashboard — ${filters.periodLabel}`,
    filterLine("Region", filters.region),
    filterLine("Owner / MM", filters.owner),
    "",
    `Records in period: ${stats.periodRecordCount.toLocaleString()}`,
    `All time (filtered): ${stats.totalRecords.toLocaleString()}`,
    "",
    "Regional overview",
  ];

  for (const summary of stats.regionSummaries) {
    lines.push(
      `  ${summary.region}: ${summary.periodCount.toLocaleString()} in period · ${summary.allTimeCount.toLocaleString()} all time`
    );
  }
  lines.push("");
  lines.push("Case status (period)");
  for (const summary of stats.statusSummaries) {
    if (summary.periodCount === 0 && summary.status !== "Blank") continue;
    lines.push(`  ${summary.status}: ${summary.periodCount.toLocaleString()}`);
  }
  lines.push("");

  lines.push(
    ...formatBreakdownPlain("Volume by region", stats.regionBreakdown, stats.periodRecordCount)
  );
  lines.push(
    ...formatBreakdownPlain("Category", stats.categoryBreakdown, stats.periodRecordCount)
  );
  lines.push(...formatBreakdownPlain("Owner / MM", stats.ownerBreakdown, stats.periodRecordCount));
  lines.push(
    ...formatBreakdownPlain(
      "Volume by day of week",
      stats.casesByDayOfWeek,
      stats.periodRecordCount
    )
  );
  lines.push("Generated from SheetsCRM");
  return lines.join("\n").trimEnd();
}

export function formatTeamDashboardReportHtml(
  stats: TeamMetricsSnapshot,
  filters: TeamDashboardReportFilters
): string {
  const regionLine =
    filters.region === "all" ? "Region: all" : `Region: ${escapeHtml(filters.region)}`;
  const ownerLine =
    filters.owner === "all" ? "Owner / MM: all" : `Owner / MM: ${escapeHtml(filters.owner)}`;

  const regionOverviewRows = stats.regionSummaries
    .map(
      (summary) =>
        `<tr><td style="border: 1px solid #d8dcde; padding: 6px 8px;">${escapeHtml(summary.region)}</td><td style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">${summary.periodCount.toLocaleString()}</td><td style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">${summary.allTimeCount.toLocaleString()}</td></tr>`
    )
    .join("");

  const statusOverviewRows = stats.statusSummaries
    .filter((summary) => summary.periodCount > 0 || summary.status === "Blank")
    .map(
      (summary) =>
        `<tr><td style="border: 1px solid #d8dcde; padding: 6px 8px;">${escapeHtml(summary.status)}</td><td style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">${summary.periodCount.toLocaleString()}</td></tr>`
    )
    .join("");

  const parts: string[] = [
    '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #17494d;">',
    `<p style="margin: 0 0 4px;"><strong>SheetsCRM Team Dashboard — ${escapeHtml(filters.periodLabel)}</strong></p>`,
    `<p style="margin: 0 0 4px; color: #68737d;">${regionLine} · ${ownerLine}</p>`,
    `<p style="margin: 0 0 16px;"><strong>${stats.periodRecordCount.toLocaleString()}</strong> in period · <strong>${stats.totalRecords.toLocaleString()}</strong> all time (filtered)</p>`,
    '<p style="margin: 0 0 8px; font-weight: bold;">Regional overview</p>',
    '<table style="border-collapse: collapse; width: 100%; max-width: 520px; font-size: 13px; margin-bottom: 16px;"><thead><tr style="background: #f4f6f8;"><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: left;">Region</th><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">In period</th><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">All time</th></tr></thead><tbody>',
    regionOverviewRows,
    "</tbody></table>",
    '<p style="margin: 0 0 8px; font-weight: bold;">Case status (period)</p>',
    '<table style="border-collapse: collapse; width: 100%; max-width: 360px; font-size: 13px; margin-bottom: 16px;"><thead><tr style="background: #f4f6f8;"><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: left;">Status</th><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">In period</th></tr></thead><tbody>',
    statusOverviewRows,
    "</tbody></table>",
    formatBreakdownHtml("Volume by region", stats.regionBreakdown, stats.periodRecordCount),
    formatBreakdownHtml("Category", stats.categoryBreakdown, stats.periodRecordCount),
    formatBreakdownHtml("Owner / MM", stats.ownerBreakdown, stats.periodRecordCount),
    formatBreakdownHtml(
      "Volume by day of week",
      stats.casesByDayOfWeek,
      stats.periodRecordCount
    ),
    '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
    "</div>",
  ];
  return parts.join("");
}

export function formatTeamDashboardCsv(
  stats: TeamMetricsSnapshot,
  filters: TeamDashboardReportFilters
): string {
  const lines: string[] = [
    csvRow(["Report", "SheetsCRM Team Dashboard"]),
    csvRow(["Period", filters.periodLabel]),
    csvRow(["Region", filters.region === "all" ? "All" : filters.region]),
    csvRow(["Owner / MM", filters.owner === "all" ? "All" : filters.owner]),
    csvRow(["Records in period", stats.periodRecordCount]),
    csvRow(["All time filtered", stats.totalRecords]),
  ];

  lines.push("");
  lines.push("Regional overview");
  lines.push(csvRow(["Region", "In period", "All time"]));
  for (const summary of stats.regionSummaries) {
    lines.push(csvRow([summary.region, summary.periodCount, summary.allTimeCount]));
  }

  lines.push("");
  lines.push("Case status (period)");
  lines.push(csvRow(["Status", "In period"]));
  for (const summary of stats.statusSummaries) {
    lines.push(csvRow([summary.status, summary.periodCount]));
  }

  appendBreakdownCsv(lines, "Volume by region", stats.regionBreakdown);
  appendBreakdownCsv(lines, "Category", stats.categoryBreakdown);
  appendBreakdownCsv(lines, "Owner / MM", stats.ownerBreakdown);
  appendBreakdownCsv(lines, "Volume by day of week", stats.casesByDayOfWeek);
  appendWeekSeriesCsv(lines, "Cases by week", stats.casesByWeek, []);
  appendWeekSeriesCsv(
    lines,
    "Category by week",
    stats.categoryByWeek,
    stats.categoryWeekKeys
  );
  appendWeekSeriesCsv(lines, "Status by week", stats.statusByWeek, ["Resolved", "Pending"]);

  return lines.join("\n");
}

function appendCountItemsCsv(lines: string[], section: string, items: CountItem[]): void {
  appendBreakdownCsv(lines, section, items);
}

function appendMonthTrendCsv(
  lines: string[],
  title: string,
  trend: { monthLabel: string; count: number }[]
): void {
  lines.push("");
  lines.push(title);
  lines.push(csvRow(["Month", "Count"]));
  for (const point of trend) {
    lines.push(csvRow([point.monthLabel, point.count]));
  }
}

export function formatReviewEscalationReportPlain(
  metrics: ReviewEscalationMetricsSnapshot
): string {
  const lines: string[] = [
    `Review escalations — ${metrics.periodLabel}`,
    filterLine("Coordinator", metrics.marketManager),
    filterLine("Team", metrics.teamFilter),
    "",
    `Opened in period: ${metrics.openedInPeriod.toLocaleString()}`,
    `With action in period: ${metrics.withActionInPeriod.toLocaleString()}`,
    `QA escalation rate: ${metrics.qaEscalationPct != null ? `${metrics.qaEscalationPct}%` : "—"}`,
    `QA overrides: ${metrics.qaOverrideCount.toLocaleString()}`,
    "",
    `Outcomes — removed: ${metrics.outcomeMix.removed}, upheld: ${metrics.outcomeMix.upheld}, other: ${metrics.outcomeMix.other}`,
    "",
    ...formatBreakdownPlain("By team", metrics.byTeam, metrics.openedInPeriod),
    ...formatBreakdownPlain("By coordinator", metrics.byCoordinator, metrics.openedInPeriod),
    ...formatBreakdownPlain("Top reasons", metrics.topReasons, metrics.openedInPeriod),
  ];
  if (metrics.monthlyTrend.length > 0) {
    lines.push("Volume trend (opened by month)");
    for (const point of metrics.monthlyTrend) {
      lines.push(`  ${point.monthLabel}: ${point.count}`);
    }
    lines.push("");
  }
  lines.push("Generated from SheetsCRM");
  return lines.join("\n").trimEnd();
}

export function formatReviewEscalationReportHtml(
  metrics: ReviewEscalationMetricsSnapshot
): string {
  const coordinatorLine =
    metrics.marketManager === "all"
      ? "Coordinator: all"
      : `Coordinator: ${escapeHtml(metrics.marketManager)}`;
  const teamLine =
    metrics.teamFilter === "all" ? "Team: all" : `Team: ${escapeHtml(metrics.teamFilter)}`;

  const parts: string[] = [
    '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #17494d;">',
    `<p style="margin: 0 0 4px;"><strong>Review escalations — ${escapeHtml(metrics.periodLabel)}</strong></p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">${coordinatorLine} · ${teamLine}</p>`,
    `<p style="margin: 0 0 8px;"><strong>${metrics.openedInPeriod.toLocaleString()}</strong> opened · <strong>${metrics.withActionInPeriod.toLocaleString()}</strong> with action</p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">QA escalation rate: ${metrics.qaEscalationPct != null ? `${metrics.qaEscalationPct}%` : "—"} · QA overrides: ${metrics.qaOverrideCount.toLocaleString()}</p>`,
    formatBreakdownHtml("By team", metrics.byTeam, metrics.openedInPeriod),
    formatBreakdownHtml("By coordinator", metrics.byCoordinator, metrics.openedInPeriod),
    formatBreakdownHtml("Top reasons", metrics.topReasons, metrics.openedInPeriod),
    '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
    "</div>",
  ];
  return parts.join("");
}

export function formatReviewEscalationCsv(metrics: ReviewEscalationMetricsSnapshot): string {
  const lines: string[] = [
    csvRow(["Report", "Review escalations"]),
    csvRow(["Period", metrics.periodLabel]),
    csvRow(["Coordinator", metrics.marketManager === "all" ? "All" : metrics.marketManager]),
    csvRow(["Team", metrics.teamFilter === "all" ? "All" : metrics.teamFilter]),
    csvRow(["Opened in period", metrics.openedInPeriod]),
    csvRow(["With action in period", metrics.withActionInPeriod]),
    csvRow([
      "QA escalation rate",
      metrics.qaEscalationPct != null ? `${metrics.qaEscalationPct}%` : "",
    ]),
    csvRow(["QA overrides", metrics.qaOverrideCount]),
    csvRow(["Outcomes removed", metrics.outcomeMix.removed]),
    csvRow(["Outcomes upheld", metrics.outcomeMix.upheld]),
    csvRow(["Outcomes other", metrics.outcomeMix.other]),
  ];

  appendCountItemsCsv(lines, "By team", metrics.byTeam);
  appendCountItemsCsv(lines, "By coordinator", metrics.byCoordinator);
  appendCountItemsCsv(lines, "Top reasons", metrics.topReasons);
  appendMonthTrendCsv(lines, "Volume trend", metrics.monthlyTrend);

  return lines.join("\n");
}

export function formatQualityAppealReportPlain(metrics: QualityAppealMetricsSnapshot): string {
  const lines: string[] = [
    `Quality appeals — ${metrics.periodLabel}`,
    filterLine("Agent", metrics.agentFilter),
    "",
    `Closed in period: ${metrics.closedInPeriod.toLocaleString()}`,
    `Opened in period: ${metrics.openedInPeriod.toLocaleString()}`,
    `Approval rate: ${metrics.approvalRatePct != null ? `${metrics.approvalRatePct}%` : "—"}`,
    `Median days to close: ${metrics.medianDaysToClose ?? "—"}`,
    "",
    ...formatBreakdownPlain("By status", metrics.byStatus, metrics.closedInPeriod),
  ];

  if (metrics.bySa.length > 0) {
    lines.push("By SA");
    for (const row of metrics.bySa) {
      lines.push(`  ${row.name}: ${row.approved} approved, ${row.denied} denied`);
    }
    lines.push("");
  }

  if (metrics.monthlyTrend.length > 0) {
    lines.push("Volume trend (opened by month)");
    for (const point of metrics.monthlyTrend) {
      lines.push(`  ${point.monthLabel}: ${point.count}`);
    }
    lines.push("");
  }

  lines.push("Generated from SheetsCRM");
  return lines.join("\n").trimEnd();
}

export function formatQualityAppealReportHtml(metrics: QualityAppealMetricsSnapshot): string {
  const agentLine =
    metrics.agentFilter === "all" ? "Agent: all" : `Agent: ${escapeHtml(metrics.agentFilter)}`;

  const saRows =
    metrics.bySa.length === 0
      ? '<p style="color: #68737d;">(none)</p>'
      : `<table style="border-collapse: collapse; width: 100%; max-width: 480px; font-size: 13px;"><thead><tr style="background: #f4f6f8;"><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: left;">SA</th><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">Approved</th><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">Denied</th></tr></thead><tbody>${metrics.bySa
          .map(
            (row) =>
              `<tr><td style="border: 1px solid #d8dcde; padding: 6px 8px;">${escapeHtml(row.name)}</td><td style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">${row.approved}</td><td style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">${row.denied}</td></tr>`
          )
          .join("")}</tbody></table>`;

  const parts: string[] = [
    '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #17494d;">',
    `<p style="margin: 0 0 4px;"><strong>Quality appeals — ${escapeHtml(metrics.periodLabel)}</strong></p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">${agentLine}</p>`,
    `<p style="margin: 0 0 8px;"><strong>${metrics.closedInPeriod.toLocaleString()}</strong> closed · <strong>${metrics.openedInPeriod.toLocaleString()}</strong> opened</p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">Approval rate: ${metrics.approvalRatePct != null ? `${metrics.approvalRatePct}%` : "—"} · Median days to close: ${metrics.medianDaysToClose ?? "—"}</p>`,
    formatBreakdownHtml("By status", metrics.byStatus, metrics.closedInPeriod),
    '<p style="margin: 16px 0 8px; font-weight: bold;">By SA</p>',
    saRows,
    '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
    "</div>",
  ];
  return parts.join("");
}

export function formatQualityAppealCsv(metrics: QualityAppealMetricsSnapshot): string {
  const lines: string[] = [
    csvRow(["Report", "Quality appeals"]),
    csvRow(["Period", metrics.periodLabel]),
    csvRow(["Agent", metrics.agentFilter === "all" ? "All" : metrics.agentFilter]),
    csvRow(["Closed in period", metrics.closedInPeriod]),
    csvRow(["Opened in period", metrics.openedInPeriod]),
    csvRow([
      "Approval rate",
      metrics.approvalRatePct != null ? `${metrics.approvalRatePct}%` : "",
    ]),
    csvRow(["Median days to close", metrics.medianDaysToClose ?? ""]),
  ];

  appendCountItemsCsv(lines, "By status", metrics.byStatus);
  lines.push("");
  lines.push("By SA");
  lines.push(csvRow(["SA", "Approved", "Denied", "Total"]));
  for (const row of metrics.bySa) {
    lines.push(csvRow([row.name, row.approved, row.denied, row.total]));
  }
  appendMonthTrendCsv(lines, "Volume trend", metrics.monthlyTrend);

  return lines.join("\n");
}

function stripGeneratedFooter(text: string): string {
  return text.replace(/\nGenerated from SheetsCRM\s*$/, "").trimEnd();
}

function metricSummaryLine(
  label: string,
  summary: ServiceMetricsSnapshot["initialResponse"]
): string {
  const median = formatBusinessMinutes(summary.medianMinutes);
  const p90 = formatBusinessMinutes(summary.p90Minutes);
  const target =
    summary.withinTargetPct != null ? `${summary.withinTargetPct}% within target` : "no target";
  return `  ${label}: n=${summary.count.toLocaleString()}, median ${median}, p90 ${p90}, ${target}`;
}

export function formatServiceMetricsReportPlain(metrics: ServiceMetricsSnapshot): string {
  const lines: string[] = [
    `Service performance — ${metrics.periodLabel}`,
    filterLine("Market manager", metrics.marketManager),
    "",
    `Throughput — created: ${metrics.throughput.createdInPeriod}, resolved: ${metrics.throughput.resolvedInPeriod}, backlog change: ${metrics.throughput.backlogDelta}`,
    metricSummaryLine("Initial response", metrics.initialResponse),
    metricSummaryLine("Handle time", metrics.handleTime),
    `  Touches — avg ${metrics.touches.average ?? "—"}, median ${metrics.touches.median ?? "—"}, n=${metrics.touches.count}`,
    `  Touch distribution — 1 reply: ${metrics.touches.distribution.one}, 2–3: ${metrics.touches.distribution.twoToThree}, 4+: ${metrics.touches.distribution.fourPlus}`,
    `  First contact resolution: ${metrics.firstContactResolutionPct != null ? `${metrics.firstContactResolutionPct}%` : "—"}`,
  ];
  if (metrics.initialResponseTrend.length > 0) {
    lines.push("", "Initial response trend (median by week)");
    for (const point of metrics.initialResponseTrend) {
      lines.push(
        `  ${point.weekLabel}: ${formatBusinessMinutes(point.medianMinutes)} (${point.count} tickets)`
      );
    }
  }
  return lines.join("\n").trimEnd();
}

export function formatServiceMetricsReportHtml(metrics: ServiceMetricsSnapshot): string {
  const mmLine =
    metrics.marketManager === "all"
      ? "Market manager: all"
      : `Market manager: ${escapeHtml(metrics.marketManager)}`;

  const trendRows = metrics.initialResponseTrend
    .map(
      (point) =>
        `<tr><td style="border: 1px solid #d8dcde; padding: 6px 8px;">${escapeHtml(point.weekLabel)}</td><td style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">${escapeHtml(formatBusinessMinutes(point.medianMinutes))}</td><td style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">${point.count}</td></tr>`
    )
    .join("");

  return [
    '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #17494d;">',
    `<p style="margin: 0 0 4px;"><strong>Service performance — ${escapeHtml(metrics.periodLabel)}</strong></p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">${mmLine}</p>`,
    `<p style="margin: 0 0 8px;">Created <strong>${metrics.throughput.createdInPeriod}</strong> · Resolved <strong>${metrics.throughput.resolvedInPeriod}</strong> · Backlog change <strong>${metrics.throughput.backlogDelta}</strong></p>`,
    `<p style="margin: 0 0 4px;">Initial response median: <strong>${escapeHtml(formatBusinessMinutes(metrics.initialResponse.medianMinutes))}</strong> (${metrics.initialResponse.count} tickets)</p>`,
    `<p style="margin: 0 0 4px;">Handle time median: <strong>${escapeHtml(formatBusinessMinutes(metrics.handleTime.medianMinutes))}</strong> (${metrics.handleTime.count} tickets)</p>`,
    `<p style="margin: 0 0 16px; color: #68737d;">FCR: ${metrics.firstContactResolutionPct != null ? `${metrics.firstContactResolutionPct}%` : "—"} · Avg touches: ${metrics.touches.average ?? "—"}</p>`,
    trendRows
      ? `<p style="margin: 0 0 8px; font-weight: bold;">Initial response trend</p><table style="border-collapse: collapse; width: 100%; max-width: 420px; font-size: 13px;"><thead><tr style="background: #f4f6f8;"><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: left;">Week</th><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">Median</th><th style="border: 1px solid #d8dcde; padding: 6px 8px; text-align: right;">Count</th></tr></thead><tbody>${trendRows}</tbody></table>`
      : "",
    "</div>",
  ].join("");
}

export function formatServiceMetricsCsv(metrics: ServiceMetricsSnapshot): string {
  const lines: string[] = [
    csvRow(["Report", "Service performance"]),
    csvRow(["Period", metrics.periodLabel]),
    csvRow(["Market manager", metrics.marketManager === "all" ? "All" : metrics.marketManager]),
    csvRow(["Created in period", metrics.throughput.createdInPeriod]),
    csvRow(["Resolved in period", metrics.throughput.resolvedInPeriod]),
    csvRow(["Backlog change", metrics.throughput.backlogDelta]),
    csvRow(["Initial response count", metrics.initialResponse.count]),
    csvRow(["Initial response median minutes", metrics.initialResponse.medianMinutes ?? ""]),
    csvRow(["Initial response p90 minutes", metrics.initialResponse.p90Minutes ?? ""]),
    csvRow(["Handle time count", metrics.handleTime.count]),
    csvRow(["Handle time median minutes", metrics.handleTime.medianMinutes ?? ""]),
    csvRow(["Average touches", metrics.touches.average ?? ""]),
    csvRow(["Touch 1 reply", metrics.touches.distribution.one]),
    csvRow(["Touch 2-3 replies", metrics.touches.distribution.twoToThree]),
    csvRow(["Touch 4+ replies", metrics.touches.distribution.fourPlus]),
    csvRow([
      "First contact resolution pct",
      metrics.firstContactResolutionPct != null ? metrics.firstContactResolutionPct : "",
    ]),
  ];

  if (metrics.initialResponseTrend.length > 0) {
    lines.push("");
    lines.push("Initial response trend");
    lines.push(csvRow(["Week", "Median minutes", "Count"]));
    for (const point of metrics.initialResponseTrend) {
      lines.push(csvRow([point.weekLabel, point.medianMinutes ?? "", point.count]));
    }
  }

  return lines.join("\n");
}

export interface AgentDashboardExportSections {
  service: ServiceMetricsSnapshot | null;
  review: ReviewEscalationMetricsSnapshot | null;
  quality: QualityAppealMetricsSnapshot | null;
}

export function formatAgentDashboardReportPlain(
  stats: DashboardStats,
  filters: MainDashboardReportFilters,
  sections: AgentDashboardExportSections
): string {
  const parts: string[] = [formatMainDashboardReportPlain(stats, filters)];

  if (sections.service) {
    parts.push("", "--- Service performance ---", "", formatServiceMetricsReportPlain(sections.service));
  }
  if (sections.review) {
    parts.push(
      "",
      "--- Review escalations ---",
      "",
      stripGeneratedFooter(formatReviewEscalationReportPlain(sections.review))
    );
  }
  if (sections.quality) {
    parts.push(
      "",
      "--- Quality appeals ---",
      "",
      stripGeneratedFooter(formatQualityAppealReportPlain(sections.quality))
    );
  }

  parts.push("", "Generated from SheetsCRM");
  return parts.join("\n").trimEnd();
}

export function formatAgentDashboardReportHtml(
  stats: DashboardStats,
  filters: MainDashboardReportFilters,
  sections: AgentDashboardExportSections
): string {
  const parts: string[] = [
    formatMainDashboardReportHtml(stats, filters).replace(
      '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
      ""
    ),
  ];

  if (sections.service) {
    parts.push(formatServiceMetricsReportHtml(sections.service));
  }
  if (sections.review) {
    parts.push(
      formatReviewEscalationReportHtml(sections.review).replace(
        '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
        ""
      )
    );
  }
  if (sections.quality) {
    parts.push(
      formatQualityAppealReportHtml(sections.quality).replace(
        '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>',
        ""
      )
    );
  }

  parts.push(
    '<p style="margin-top: 16px; font-size: 11px; color: #87929d;">Generated from SheetsCRM</p>'
  );
  return parts.join("");
}

export function formatAgentDashboardCsv(
  stats: DashboardStats,
  filters: MainDashboardReportFilters,
  sections: AgentDashboardExportSections
): string {
  const parts = [formatMainDashboardCsv(stats, filters)];

  if (sections.service) {
    parts.push("", formatServiceMetricsCsv(sections.service));
  }
  if (sections.review) {
    parts.push("", formatReviewEscalationCsv(sections.review));
  }
  if (sections.quality) {
    parts.push("", formatQualityAppealCsv(sections.quality));
  }

  return parts.join("\n");
}

export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
