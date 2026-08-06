export const TEAM_METRICS_CHART_INFO = {
  overview:
    "Experimental aggregate view across configured regional intake tabs. In full CRM, your Form Responses data is included as North East and Canada only when that region is not already a configured source (avoids double-counting). No CRM ticket linking.",
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
    "Large All regions total on the left, with per-region period/all-time counts in a grid. Case status cards show sheet status values (Blank, Open, Pending, etc.) for the selected period. Use Map statuses to roll regional spellings into shared buckets.",
  topParentAccounts:
    "Parent/host accounts ranked by intake volume in the selected period (user ID on each regional tab). Display names come from each region’s companion profiles tab when found.",
} as const;
