"use client";

import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";

interface BusinessHoursUpdatedModalProps {
  onClose: () => void;
}

export function BusinessHoursUpdatedModal({ onClose }: BusinessHoursUpdatedModalProps) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3000);
    return () => window.clearTimeout(timer);
    // Auto-dismiss once when the confirmation opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-labelledby="business-hours-updated-title"
        aria-modal="true"
        className="w-full max-w-xs rounded-lg border border-zendesk-border bg-white p-5 shadow-xl"
      >
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="h-10 w-10 text-zendesk-green" aria-hidden />
          <h2
            id="business-hours-updated-title"
            className="mt-3 text-base font-semibold text-zendesk-navy"
          >
            Business hours updated
          </h2>
          <p className="mt-1 text-sm text-zendesk-muted">
            Service metrics and timers will use your new schedule.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
