/** Nova tab: detect host ID and offer Send to SheetsCRM. */

const PANEL_ID = "sheetscrm-nova-host-bridge";

function extractHostIdFromDom() {
  const link =
    document.querySelector('a[data-tracking-name="NovaProfilesLink"]') ||
    document.querySelector('a[href*="/profiles/"]');
  if (!link) return null;
  const href = link.getAttribute("href") || "";
  const match = href.match(/\/profiles\/(\d+)\b/);
  return match?.[1] || null;
}

function extractReservationCode() {
  const fromPath = window.location.pathname.match(/\/reservations\/([A-Z0-9]+)/i);
  if (fromPath?.[1]) return fromPath[1].toUpperCase();
  return "";
}

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="scrm-bridge-title">SheetsCRM</div>
    <div class="scrm-bridge-id" data-role="host-id">Looking for host ID…</div>
    <button type="button" data-role="send" disabled>Send host ID to CRM</button>
    <div class="scrm-bridge-status" data-role="status"></div>
  `;
  document.documentElement.appendChild(panel);

  panel.querySelector('[data-role="send"]').addEventListener("click", () => {
    void sendToCrm();
  });

  return panel;
}

function setStatus(text, tone) {
  const el = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
  if (!el) return;
  el.textContent = text || "";
  el.dataset.tone = tone || "";
}

async function sendToCrm() {
  const hostId = extractHostIdFromDom();
  const button = document.querySelector(`#${PANEL_ID} [data-role="send"]`);
  if (!hostId || !button) return;

  button.disabled = true;
  setStatus("Sending…", "pending");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SEND_HOST_ID",
      hostId,
      reservationCode: extractReservationCode(),
    });
    if (!response?.ok) {
      setStatus(response?.error || "Failed to send", "error");
      button.disabled = false;
      return;
    }
    setStatus(`Saved ${response.hostId} on open ticket`, "ok");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to send", "error");
    button.disabled = false;
  }
}

function refreshPanel() {
  const panel = ensurePanel();
  const hostId = extractHostIdFromDom();
  const idEl = panel.querySelector('[data-role="host-id"]');
  const button = panel.querySelector('[data-role="send"]');
  if (!idEl || !button) return;

  if (hostId) {
    idEl.textContent = `Host ID: ${hostId}`;
    button.disabled = false;
  } else {
    idEl.textContent = "Host ID not found on this page yet";
    button.disabled = true;
  }
}

ensurePanel();
refreshPanel();

const observer = new MutationObserver(() => refreshPanel());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.setInterval(refreshPanel, 1500);
