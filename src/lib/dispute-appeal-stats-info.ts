import {
  QUALITY_APPEALS_SOURCE_LABEL,
  QUALITY_APPEALS_SHEET_URL,
  REVIEW_ESCALATIONS_SOURCE_LABEL,
  REVIEW_ESCALATIONS_SHEET_URL,
} from "./quality-report-sources";

export function qualityReportSourceLinks(): {
  reviewEscalations: { label: string; url: string };
  qualityAppeals: { label: string; url: string };
} {
  return {
    reviewEscalations: {
      label: REVIEW_ESCALATIONS_SOURCE_LABEL,
      url: REVIEW_ESCALATIONS_SHEET_URL,
    },
    qualityAppeals: {
      label: QUALITY_APPEALS_SOURCE_LABEL,
      url: QUALITY_APPEALS_SHEET_URL,
    },
  };
}

export function reviewEscalationInfoText(): {
  throughput: string;
  qaEscalation: string;
  outcomes: string;
  byTeam: string;
  byCoordinator: string;
  topReasons: string;
  trend: string;
} {
  return {
    throughput:
      "Review escalations with a parsed timestamp in column A that falls in the selected period. Team filter uses column B. Market Manager filter uses the Market Coordinator column when present.",
    qaEscalation:
      "Share of opened escalations flagged for QA review, plus QA override count when rationale text reverses the ambassador decision.",
    outcomes:
      "Outcome mix for escalations with an action date in the period (removed vs upheld).",
    byTeam: "Escalation volume by regional team for cases opened in the period.",
    byCoordinator: "Escalation volume by Market Coordinator for cases opened in the period.",
    topReasons:
      "Grouped escalation reasons (retaliatory, extortion, off-platform, guest did not stay, etc.).",
    trend: "Monthly count of review escalations opened, based on column A timestamps.",
  };
}

export function qualityAppealInfoText(): {
  throughput: string;
  approvalRate: string;
  bySa: string;
  byStatus: string;
  trend: string;
} {
  return {
    throughput:
      "Quality appeals opened (column A timestamp) vs closed (closing date) in the selected period. Agent filter uses column B.",
    approvalRate:
      "Approval and denial rates for appeals with a closing date in the period, based on the status column.",
    bySa: "Approved vs denied quality appeals grouped by SA name for cases closed in the period.",
    byStatus: "Breakdown of closed appeals by status (Approved, Denied, Other).",
    trend: "Monthly count of quality appeals opened, based on column A timestamps.",
  };
}

/** @deprecated Use reviewEscalationInfoText / qualityAppealInfoText */
export function disputeAppealInfoText() {
  const review = reviewEscalationInfoText();
  const appeal = qualityAppealInfoText();
  return {
    disputesThroughput: review.throughput,
    disputeOutcomes: review.outcomes,
    qaOverride: review.qaEscalation,
    disputesByTeam: review.byTeam,
    disputesByCoordinator: review.byCoordinator,
    disputeReasons: review.topReasons,
    disputeTrend: review.trend,
    appealsThroughput: appeal.throughput,
    appealApproval: appeal.approvalRate,
    appealBySa: appeal.bySa,
    appealTrend: appeal.trend,
  };
}
