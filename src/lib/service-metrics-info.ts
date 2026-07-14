import { getServiceMetricsEpoch } from "./service-metrics-epoch";

export function serviceMetricsInfoText(): {
  throughput: string;
  initialResponse: string;
  handleTime: string;
  touches: string;
  fcr: string;
  initialTrend: string;
} {
  const epoch = getServiceMetricsEpoch().toLocaleDateString();
  return {
    throughput: `Counts tickets created vs resolved in the selected period. Only intakes on or after ${epoch} are included. "Created" uses the sheet submission date. "Resolved" uses when the ticket was marked Resolved in CRM (Do not action is excluded). The difference hints at backlog growth or shrinkage.`,
    initialResponse: `Median time from intake to the agent's first CRM email reply, counting only your Setup business hours. Nights, weekends, US federal holidays, and time while a ticket is Pending or Long-term hold are paused. Cohort: tickets created in the selected period. Intake time is the earlier of the sheet timestamp and the first imported customer email.`,
    handleTime: `Median active handling time from the first agent reply until Resolved, in business hours, with the same pauses (including US federal holidays). Cohort: tickets resolved in the selected period (not Do not action). Tickets resolved without any CRM outbound reply are excluded.`,
    touches: `How many agent outbound emails were sent before the ticket was resolved. Cohort: resolved in the selected period. The breakdown shows how many cases needed one reply vs several.`,
    fcr: `First-contact resolution: share of resolved tickets that needed only one agent outbound email. Higher is better for simple issues; complex contact reasons may legitimately need more.`,
    initialTrend: `Weekly median first-reply time for tickets created that week (business hours). Helps spot whether new intake is getting slower or faster over time.`,
  };
}
