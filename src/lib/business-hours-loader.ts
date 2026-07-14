import { businessHoursFromSheetConfig, type BusinessHoursConfig } from "./business-hours";
import { withWorkspaceHolidays } from "./business-holidays";
import { loadSheetConfig } from "./overlay-db";

export function loadWorkspaceBusinessHours(): BusinessHoursConfig {
  return withWorkspaceHolidays(businessHoursFromSheetConfig(loadSheetConfig("default")));
}
