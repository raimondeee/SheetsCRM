async function refresh() {
  const status = document.getElementById("status");
  if (!status) return;

  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_CRM_TICKET" });
    const ticket = response?.ticket;
    if (!ticket?.rowId) {
      status.textContent = "No ticket linked yet. Select a ticket in SheetsCRM (localhost:3000).";
      return;
    }
    const reso = ticket.reservationCode ? ` · Reso ${ticket.reservationCode}` : "";
    status.textContent = `Linked ticket ready${reso}. Origin: ${ticket.origin || "localhost"}`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not read bridge state";
  }
}

void refresh();
