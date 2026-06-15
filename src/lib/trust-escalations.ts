export interface TrustEscalationTeam {
  id: string;
  name: string;
  shortName: string;
  formUrl: string;
  guidance: string;
}

export const TRUST_ESCALATION_TEAMS: TrustEscalationTeam[] = [
  {
    id: "payment-fraud",
    name: "Payment Fraud",
    shortName: "PF",
    formUrl: "https://jira.airbnb.biz/plugins/servlet/desk/portal/21/create/399",
    guidance:
      "Use for fraudulent payment activity requiring internal Trust investigation: chargebacks (CBK), stolen credit cards, coupon/referral/credit abuse, negative balance fraud (FRR), and employee fraud. If the chargeback or coupon abuse stems from an account takeover, transfer to ACI instead — PF handles the money, ACI handles the compromised account. For queue work (CBQ, PQ, CCQ) or payout freezes, use Payments Risk Ops.",
  },
  {
    id: "account-content-integrity",
    name: "Account & Content Integrity",
    shortName: "ACI",
    formUrl: "https://jira.airbnb.biz/plugins/servlet/desk/portal/21/create/400",
    guidance:
      "Use for account takeovers (ATO), recoveries, vishing/social engineering with diverted payouts, phishing reports, fake inventory concerns, Fake Inventory queue exemptions, SCA/Airlock issues, suspicious or fake reviews, listing ownership disputes, and Connected Accounts Policy escalations (account-integrity driver). Run the duplicate-account playbook first — most duplicate escalations are denied.",
  },
  {
    id: "regulatory-standards-enforcement",
    name: "Regulatory and Standards Proactive Enforcement",
    shortName: "RSE",
    formUrl: "https://jira.airbnb.biz/plugins/servlet/desk/portal/21/create/577",
    guidance:
      'Use for listing-level policy violations and regulatory evasion: bait-and-switch, hosting standards enforcement, restricted/prohibited listings (incl. hotel arbitrage), address dodging ("Cannot Activate Listing" flag), attractive nuisance, party houses (regulatory angle), and Comms/Legal escalations. Fake listings entirely → ACI. Real listings being misrepresented or violating standards → RSE.',
  },
  {
    id: "identity-operations",
    name: "Identity Operations",
    shortName: "IDO",
    formUrl: "https://jira.airbnb.biz/plugins/servlet/desk/portal/21/create/679",
    guidance:
      "Use for identity-verification system issues: Face Match Queue reviews/exemptions, IDV exemptions and manual approvals, identity misuse appeals, DOB revisions, BFMR flags, underage users, redacted IDs, and legal name reviews. Hacked account → ACI. User who can't pass IDV → IDO. Some IDV exemptions route to UKO instead — follow the workflow when specified.",
  },
  {
    id: "payments-risk-ops",
    name: "Payments Risk Ops",
    shortName: "PRO",
    formUrl: "https://jira.airbnb.biz/plugins/servlet/desk/portal/21/create/897",
    guidance:
      "Use for chargeback and payout risk work: CBQ auto-cancel appeals, payment airlocks/CVV frictions, unauthorized transactions (UAT), payouts held by PRO/Trust freeze, suspension or payout recall, Tier 1 chargeback ghostings, fraudulent Resolution Center payments, and gift cards added during ATO. PRO = queue/ops work; PF = internal investigations (coupon abuse, employee fraud). When in doubt, default to PRO — they'll route to PF if needed.",
  },
  {
    id: "user-knowledge-operations",
    name: "User Knowledge Operations",
    shortName: "UKO",
    formUrl: "https://jira.airbnb.biz/plugins/servlet/desk/portal/21/create/401",
    guidance:
      "Use for bad-actor and community-safety cases: dangerous organizations, ghosted users, sex work, human trafficking, child exploitation, proactive property-damage risk, background check appeals, Connected Accounts Policy (safety driver), high-risk reservation reviews, and reported house parties (safety angle). Also the catch-all for urgent issues that don't fit PF/PRO/ACI/RSE/IDO. Post-incident damage → CRT, not UKO. CC gcm@airbnb.com for media-sensitive removals.",
  },
];
