/** Background: stores the open CRM ticket and PATCHes Manual User ID. */

const STORAGE_KEY = "sheetscrmBridge";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CRM_TICKET") {
    void chrome.storage.session
      .set({
        [STORAGE_KEY]: {
          rowId: message.rowId || null,
          reservationCode: message.reservationCode || "",
          origin: message.origin || "http://localhost:3000",
          updatedAt: Date.now(),
        },
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "GET_CRM_TICKET") {
    void chrome.storage.session.get(STORAGE_KEY).then((data) => {
      sendResponse({ ok: true, ticket: data[STORAGE_KEY] || null });
    });
    return true;
  }

  if (message?.type === "SEND_HOST_ID") {
    void sendHostIdToCrm(message.hostId, message.reservationCode)
      .then(async (result) => {
        if (result.ok) {
          await notifyCrmTabs(result);
        }
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

async function notifyCrmTabs(result) {
  const tabs = await chrome.tabs.query({ url: ["http://localhost:3000/*"] });
  await Promise.all(
    tabs.map((tab) =>
      tab.id != null
        ? chrome.tabs
            .sendMessage(tab.id, {
              type: "HOST_ID_SAVED",
              rowId: result.rowId,
              hostId: result.hostId,
            })
            .catch(() => {})
        : Promise.resolve()
    )
  );
}

async function sendHostIdToCrm(hostId, novaReservationCode) {
  const trimmed = String(hostId || "").trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: "Host ID must be numeric" };
  }

  const stored = await chrome.storage.session.get(STORAGE_KEY);
  const ticket = stored[STORAGE_KEY];
  if (!ticket?.rowId) {
    return {
      ok: false,
      error: "No ticket selected in SheetsCRM — open a ticket in the CRM tab first",
    };
  }

  const crmReso = String(ticket.reservationCode || "").trim().toUpperCase();
  const novaReso = String(novaReservationCode || "").trim().toUpperCase();
  if (crmReso && novaReso && crmReso !== novaReso) {
    return {
      ok: false,
      error: `Reso mismatch: CRM has ${crmReso}, Nova page looks like ${novaReso}`,
    };
  }

  const origin = ticket.origin || "http://localhost:3000";
  const url = `${origin}/api/tickets/${encodeURIComponent(ticket.rowId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rowId: ticket.rowId, airbnbUserId: trimmed }),
    credentials: "include",
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) detail = data.error;
    } catch {
      /* ignore */
    }
    return { ok: false, error: detail };
  }

  return { ok: true, rowId: ticket.rowId, hostId: trimmed };
}
