import { NextResponse } from "next/server";
import { normalizeDashboardPeriod } from "@/lib/dashboard-period";
import {
  buildQualityAppealMetrics,
  buildReviewEscalationMetrics,
} from "@/lib/dispute-appeal-stats";
import {
  loadQualityAppealsSheetTab,
  loadReviewEscalationSheetTab,
  parseQualityAppealRecords,
  parseReviewEscalationRecords,
} from "@/lib/quality-report-loader";
import { requireOAuthSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Combined payload for legacy clients. Prefer separate review/appeal routes. */
export async function GET(request: Request) {
  const denied = await requireOAuthSession();
  if (denied) return denied;

  const url = new URL(request.url);
  const period = normalizeDashboardPeriod(url.searchParams.get("period"));
  const marketManager = url.searchParams.get("marketManager")?.trim() || "all";

  try {
    const [reviewTab, appealsTab] = await Promise.all([
      loadReviewEscalationSheetTab(),
      loadQualityAppealsSheetTab(),
    ]);
    const review = buildReviewEscalationMetrics({
      disputes: parseReviewEscalationRecords(reviewTab),
      period,
      marketManager: marketManager === "all" ? "all" : marketManager,
    });
    const appeals = buildQualityAppealMetrics({
      appeals: parseQualityAppealRecords(appealsTab),
      period,
    });

    return NextResponse.json(
      {
        period: review.period,
        periodLabel: review.periodLabel,
        marketManager: review.marketManager,
        disputes: {
          openedInPeriod: review.openedInPeriod,
          withActionInPeriod: review.withActionInPeriod,
          outcomeMix: review.outcomeMix,
          qaEscalationPct: review.qaEscalationPct,
          qaOverrideCount: review.qaOverrideCount,
          qaOverridePct: review.qaOverridePct,
          medianDaysToAction: review.medianDaysToAction,
          byTeam: review.byTeam,
          byCoordinator: review.byCoordinator,
          topReasons: review.topReasons,
          monthlyTrend: review.monthlyTrend,
        },
        appeals: {
          openedInPeriod: appeals.openedInPeriod,
          closedInPeriod: appeals.closedInPeriod,
          approvalRatePct: appeals.approvalRatePct,
          denialRatePct: appeals.denialRatePct,
          medianDaysToClose: appeals.medianDaysToClose,
          bySa: appeals.bySa,
          byStatus: appeals.byStatus,
          monthlyTrend: appeals.monthlyTrend,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
