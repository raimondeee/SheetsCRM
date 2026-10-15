export type HelpTourSpot = {
  id: string;
  title: string;
  body: string;
  /** Visible label / aria text used to locate the control in the DOM */
  match: {
    /** Stable CRM attribute — preferred when present */
    dataHelpTour?: string;
    /** Preferred visible text; first match wins when several are listed */
    text?: string | string[];
    ariaLabel?: string | string[];
    /** Prefer matching a specific tag name when several share the same text */
    tagNames?: string[];
  };
  /** Optional note when the target is not on screen */
  missingHint?: string;
};

export const HELP_TOUR_SPOTS: HelpTourSpot[] = [
  {
    id: "views-tickets",
    title: "Views and Tickets",
    body: "The left Views column switches dashboards and status filters (All, New, Open, Pending, and more). Next to it, the Tickets list shows cases in the current view — search, quality filters, and click a row to open it in the detail pane.",
    match: { text: ["Views", "Tickets"], tagNames: ["p", "span", "h2", "div"] },
    missingHint: "Expand the Views column if it is collapsed.",
  },
  {
    id: "calendar",
    title: "Calendar",
    body: "Shows upcoming Google Calendar events while you work tickets. Use it to spot meetings and reminders without leaving the CRM. Refresh the list from the calendar panel when you need the latest schedule.",
    match: {
      text: "Calendar",
      ariaLabel: "Upcoming calendar events",
      tagNames: ["span", "p", "div", "button"],
    },
    missingHint: "Sign in with Google on a live sheet to see Calendar in the Views sidebar.",
  },
  {
    id: "unread-gmail",
    title: "Unread Gmail",
    body: "Opens your unread Gmail inbox inside SheetsCRM. From there you can open, create, or link messages to tickets so customer email stays tied to the right case.",
    match: {
      text: "Unread Gmail",
      ariaLabel: "Open unread Gmail inbox",
      tagNames: ["button", "span"],
    },
    missingHint: "Look at the bottom of the Views sidebar (or the mail icon when Views is collapsed).",
  },
  {
    id: "details",
    title: "Details section",
    body: "Above the conversation thread, expand Details to see ticket metadata — status, contact reason, SLA, listing fields, and other sheet-mapped values. Collapse it when you want more room for the thread and draft.",
    match: { text: "Details", tagNames: ["button"] },
    missingHint: "Select a ticket first. The Details control is in the top-right of the ticket header.",
  },
  {
    id: "conversation",
    title: "Conversation window",
    body: "The conversation pane shows the original request and the full email thread for this ticket. Scroll to review history; you can expand it fullscreen when you need a larger reading area.",
    match: { text: "Conversation", tagNames: ["span", "p", "div"] },
    missingHint: "Select a ticket to open the conversation pane.",
  },
  {
    id: "draft",
    title: "Draft window",
    body: "Compose your reply under Email draft (plus Admin notes, Attachments, and CRM log tabs). Write freeform, insert Mixmax templates from the right rail, then send or update status with the action buttons below the editor.",
    match: { text: "Email draft", tagNames: ["button", "span"] },
    missingHint: "Select a ticket to open the draft composer.",
  },
  {
    id: "set-pending",
    title: "Set to Pending",
    body: "Marks the ticket Pending without sending email — useful when you are waiting on the customer or another team. Open the menu to choose how long the pending timer should run, or set Longterm Hold/Bugs (reopens when the customer replies).",
    match: { text: "Set to Pending", tagNames: ["button"] },
    missingHint: "Select a ticket and keep the Email draft tab open to see status actions.",
  },
  {
    id: "resolve-close",
    title: "Resolve & Close",
    body: "Resolves the ticket and closes it without sending a reply. You will be asked three required close-case questions (host outcome, CS, remediation) which write to sheet columns P–R.",
    match: { text: "Resolve & Close", tagNames: ["button"] },
    missingHint: "Select a ticket and keep the Email draft tab open to see status actions.",
  },
  {
    id: "unlink-thread",
    title: "Unlink & new thread",
    body: "Disconnects the current Gmail thread from this ticket so the next customer reply can start a fresh linked thread. Use carefully when a thread was linked incorrectly or the conversation should be reset.",
    match: { text: "Unlink & new thread", tagNames: ["button"] },
    missingHint: "Only appears when a Gmail thread is linked to the selected ticket.",
  },
  {
    id: "internal-tools",
    title: "Internal tools",
    body: "The right rail collects agent utilities for the selected ticket: Salesforce search, Airbnb user ID, Nova profile, Host Performance, Become user, Log out, linked cases, external tools, Mixmax, Trust escalations, and Recent sends. Collapse the rail to free space for the conversation.",
    match: { text: "Internal tools", tagNames: ["h3", "h2", "span", "p"], dataHelpTour: "internal-tools" },
    missingHint: "Select a ticket, then expand Internal tools if the rail is collapsed.",
  },
  {
    id: "nova-profile",
    title: "Nova Profile",
    body: "Opens the guest or host Nova profile for the Airbnb user ID on this ticket so you can review account context while drafting a reply.",
    match: { text: "Nova profile", tagNames: ["button", "a"], dataHelpTour: "nova-profile" },
    missingHint: "Expand Internal tools and enter an Airbnb User ID when needed.",
  },
  {
    id: "host-performance",
    title: "Host Performance",
    body: "Opens Host Performance for the current user so you can check host metrics and quality signals related to the case.",
    match: { text: "Host Performance", tagNames: ["button", "a"], dataHelpTour: "host-performance" },
    missingHint: "Expand Internal tools on a selected ticket.",
  },
  {
    id: "become-user",
    title: "Become user",
    body: "Launches the admin “become user” flow for the Airbnb account on this ticket when you need to view the product as that user.",
    match: { text: "Become user", tagNames: ["button", "a"], dataHelpTour: "become-user" },
    missingHint: "Expand Internal tools on a selected ticket.",
  },
  {
    id: "logout",
    title: "Log out",
    body: "Signs out of the admin / become-user session opened from Internal tools. Use this when you are done acting as a user and need to return to your agent session.",
    match: { text: "Log out", tagNames: ["button", "a"], dataHelpTour: "logout" },
    missingHint: "Expand Internal tools on a selected ticket.",
  },
  {
    id: "linked-cases",
    title: "Linked cases",
    body: "Store related case references (up to three slots) so you can jump between connected tickets. Edit a slot to attach or update a linked case ID.",
    match: { text: "Linked cases", tagNames: ["p", "h3", "span"], dataHelpTour: "linked-cases" },
    missingHint: "Expand Internal tools on a selected ticket.",
  },
  {
    id: "external-tools",
    title: "External tools",
    body: "Shortcuts to tools you configure in Preferences. Each link opens with ticket context when available so you can leave SheetsCRM quickly and return without losing your place.",
    match: { text: "External tools", tagNames: ["p", "h3", "span"], dataHelpTour: "external-tools" },
    missingHint: "Expand Internal tools. Configure slots under View preferences.",
  },
  {
    id: "mixmax",
    title: "Mixmax templates",
    body: "Browse and insert Mixmax email templates into the draft. Star favorites for faster access; use Reorder to drag starred rows. Stars sync to your local CRM preferences (survive clearing browser cache). Variables resolve from the current ticket when you apply a template.",
    match: {
      text: "Mixmax templates",
      ariaLabel: "Mixmax templates",
      tagNames: ["button", "span", "p", "h3"],
      dataHelpTour: "mixmax",
    },
    missingHint: "Expand Internal tools at the bottom of the right rail.",
  },
  {
    id: "trust-escalations",
    title: "Trust Escalations",
    body: "Opens Trust Escalations workflows and references so you can escalate sensitive trust and safety cases without leaving the ticket workspace.",
    match: {
      text: "Trust escalations",
      ariaLabel: "Trust Escalations",
      tagNames: ["button", "span"],
      dataHelpTour: "trust-escalations",
    },
    missingHint: "Expand Internal tools at the bottom of the right rail.",
  },
  {
    id: "gso-triage",
    title: "GSO Triage",
    body: "Opens the GSO Escalations Triage playbook so you can search Homes escalation cases, teams, and host scripts without leaving the ticket workspace.",
    match: {
      text: "GSO Triage",
      ariaLabel: "GSO Triage",
      tagNames: ["button", "span"],
      dataHelpTour: "gso-triage",
    },
    missingHint: "Expand Internal tools at the bottom of the right rail.",
  },
  {
    id: "recent-sends",
    title: "Recent Sends",
    body: "Shows a short archive of emails you recently sent from SheetsCRM. Use it to confirm delivery, reopen a prior send, or copy context for follow-up. Enable the panel in Preferences → Ticket right rail (sends are still archived when the panel is hidden).",
    match: {
      text: ["Recent sends", "Recent Sends"],
      ariaLabel: "Recent sends",
      tagNames: ["button", "span", "p", "h3"],
      dataHelpTour: "recent-sends",
    },
    missingHint: "Enable Recent sends in Preferences → Ticket right rail, then open Internal tools on the right rail.",
  },
];
