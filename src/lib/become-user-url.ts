const BECOME_USER_BASE = "https://admin.airbnb.com/become-user/web";

export const ADMIN_LOGOUT_URL = "https://admin.airbnb.com/logout";

/** Become-user requires a numeric Airbnb user ID (not email or text). */
export function isNumericUserId(userId: string): boolean {
  const trimmed = userId.trim();
  return trimmed.length > 0 && /^\d+$/.test(trimmed);
}

export function buildBecomeUserUrl(userId: string): string | null {
  const trimmed = userId.trim();
  if (!isNumericUserId(trimmed)) return null;

  const params = new URLSearchParams({
    userId: trimmed,
    service_id: "nova",
    object_id_value: "MAX",
    object_id_type: "8",
    reason_details: "View user interface",
    group: "MAX",
  });

  return `${BECOME_USER_BASE}?${params.toString()}`;
}
