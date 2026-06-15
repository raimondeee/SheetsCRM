"use client";

import { useEffect } from "react";
import { attachTicketChimeUnlockListeners } from "@/lib/ticket-chime";

/** Unlocks Web Audio on first user interaction so refresh chimes can play. */
export function useTicketChimeUnlock() {
  useEffect(() => attachTicketChimeUnlockListeners(), []);
}
