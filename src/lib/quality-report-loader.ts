import { getMockAppealsTab, getMockDisputesTab } from "@/lib/dispute-appeal-mock";
import {
  parseQualityAppealTab,
  parseReviewEscalationTab,
} from "@/lib/dispute-appeal-stats";
import {
  QUALITY_APPEALS_GID,
  QUALITY_APPEALS_SPREADSHEET_ID,
  REVIEW_ESCALATIONS_GID,
  REVIEW_ESCALATIONS_SPREADSHEET_ID,
} from "@/lib/quality-report-sources";
import { fetchSheetTabData, type SheetTabData } from "@/lib/sheet-tabs";
import { hasGoogleCredentials } from "@/lib/sheets";

export async function loadReviewEscalationSheetTab(): Promise<SheetTabData> {
  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true" || !hasAuth;
  if (useMock) return getMockDisputesTab();

  return fetchSheetTabData(REVIEW_ESCALATIONS_SPREADSHEET_ID, {
    gid: REVIEW_ESCALATIONS_GID,
  });
}

export async function loadQualityAppealsSheetTab(): Promise<SheetTabData> {
  const hasAuth = await hasGoogleCredentials();
  const useMock = process.env.USE_MOCK_DATA === "true" || !hasAuth;
  if (useMock) return getMockAppealsTab();

  return fetchSheetTabData(QUALITY_APPEALS_SPREADSHEET_ID, {
    gid: QUALITY_APPEALS_GID,
  });
}

export function parseReviewEscalationRecords(tab: SheetTabData) {
  return parseReviewEscalationTab(tab);
}

export function parseQualityAppealRecords(tab: SheetTabData) {
  return parseQualityAppealTab(tab);
}
