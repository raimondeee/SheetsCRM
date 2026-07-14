export const TEAM_METRICS_CHART_INFO = {
  overview:
    "Experimental aggregate view across regional intake tabs plus your North East and Canada Form Responses data. No CRM ticket linking.",
  regionVolume:
    "Share of intakes in the selected period by regional team. Each slice is one configured sheet tab.",
  category:
    "Contact reason or category field from each regional tab, combined across teams.",
  owner:
    "Market manager or owner column from each tab, using short first-name labels where possible.",
  categoryByWeek:
    "Stacked weekly intake volume by category across all included regional tabs.",
  categoryByRegion:
    "Category mix within each regional team (100% stacked). Useful for comparing what each region handles.",
  casesByWeek: "New intakes per week based on each row's timestamp column.",
  casesByMonth: "Monthly intake volume from timestamp columns across all regional tabs.",
  statusByWeek:
    "Of intakes submitted each week, how many look resolved vs pending based on raw sheet status text.",
  regionCards:
    "Per-region intake count in the period. Includes your local tab when not filtered out.",
} as const;
