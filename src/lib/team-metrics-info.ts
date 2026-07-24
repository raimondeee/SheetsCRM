export const TEAM_METRICS_CHART_INFO = {
  overview:
    "Experimental aggregate view across regional intake tabs plus your North East and Canada Form Responses data. No CRM ticket linking.",
  regionVolume:
    "Share of intakes in the selected period by regional team. Each slice is one configured sheet tab.",
  category:
    "Top contact reasons / categories from each regional tab, combined across teams.",
  owner:
    "Market manager or owner column from each tab, using short first-name labels where possible.",
  categoryByWeek:
    "Stacked weekly intake volume by category across all included regional tabs.",
  categoryByRegion:
    "Category mix within each regional team (100% stacked). Useful for comparing what each region handles.",
  casesByWeek: "New intakes per week based on each row's timestamp column (week starting Sunday).",
  casesByMonth: "Monthly intake volume from timestamp columns across all regional tabs.",
  casesByDayOfWeek:
    "Intake volume by weekday (Sunday–Saturday) for the selected period, based on each row's timestamp.",
  statusByWeek:
    "Of intakes submitted each week, how many look resolved vs pending based on raw sheet status text.",
  regionCards:
    "Large All regions total on the left, with per-region period/all-time counts in a grid. Case status cards show sheet status values (Blank, Open, Pending, etc.) for the selected period.",
} as const;
