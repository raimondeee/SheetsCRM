# SheetsCRM Nova Host Bridge (Chrome extension)

Sends the host profile ID from a Nova reservation page into the **Manual User ID** field on the ticket currently open in SheetsCRM.

## Requirements

- SheetsCRM running at `http://localhost:3000`
- A ticket selected in the CRM
- Ability to **sideload an unpacked extension** (Chrome Web Store install may be blocked by admin policy; unpacked developer mode sometimes still works — check with IT if Load unpacked is disabled)

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose this folder: `extensions/nova-host-bridge`
4. Keep SheetsCRM open and select a ticket
5. Open the matching Nova reservation (`nova.airbnb.tools/reservations/...`)
6. Use the floating **Send host ID to CRM** panel

## How it works

1. CRM writes the selected ticket id / Reso onto `document.documentElement` dataset attributes
2. Extension content script on `localhost:3000` publishes that to the background worker
3. On Nova, the extension reads `a[data-tracking-name="NovaProfilesLink"]` (or `/profiles/{id}`)
4. Background `PATCH`es `/api/tickets/{rowId}` with `{ airbnbUserId }`

If both CRM and Nova have a reservation code, a mismatch blocks the send (safety check).

## Admin / policy notes

This extension is intended for **local sideload**, not enterprise force-install. If your admin blocks all extensions including unpacked loads, this path will not work and Manual User ID entry remains the fallback.

## Privacy

- Does not store Nova cookies
- Uses your existing browser session only insofar as you are already logged into Nova/CRM in those tabs
- Talks only to `localhost:3000` and reads host ID from the Nova DOM
