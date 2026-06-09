import { isNumericUserId } from "./become-user-url";

const NOVA_BASE = "https://nova.airbnb.tools";

export function buildNovaProfileUrl(userId: string): string | null {
  const trimmed = userId.trim();
  if (!isNumericUserId(trimmed)) return null;
  return `${NOVA_BASE}/profiles/${encodeURIComponent(trimmed)}`;
}

export function buildNovaReservationUrl(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  return `${NOVA_BASE}/reservations/${encodeURIComponent(trimmed)}`;
}

export function buildNovaListingUrl(listingId: string): string | null {
  const trimmed = listingId.trim();
  if (!trimmed) return null;
  return `${NOVA_BASE}/listings/${encodeURIComponent(trimmed)}`;
}
