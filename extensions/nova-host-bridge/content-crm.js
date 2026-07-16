/** SheetsCRM tab: publish the selected ticket to the extension. */

function readTicketFromDom() {
  const root = document.documentElement;
  return {
    type: "CRM_TICKET",
    rowId: root.dataset.sheetscrmTicketRowId || null,
    reservationCode: root.dataset.sheetscrmReservationCode || "",
    origin: root.dataset.sheetscrmOrigin || window.location.origin,
  };
}

function publish() {
  const payload = readTicketFromDom();
  chrome.runtime.sendMessage(payload).catch(() => {
    /* extension context invalidated during reload */
  });
}

publish();

const observer = new MutationObserver(() => publish());
observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: [
    "data-sheetscrm-ticket-row-id",
    "data-sheetscrm-reservation-code",
    "data-sheetscrm-origin",
    "data-sheetscrm-ready",
  ],
});

window.setInterval(publish, 2000);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "HOST_ID_SAVED" || !message.rowId || !message.hostId) return;
  window.dispatchEvent(
    new CustomEvent("sheetscrm:host-id-saved", {
      detail: { rowId: message.rowId, hostId: message.hostId },
    })
  );
});
