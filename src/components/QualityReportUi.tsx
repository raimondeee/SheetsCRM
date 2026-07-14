"use client";

import type { ReactNode } from "react";
import { ChartInfoTooltip } from "./ChartInfoTooltip";

export function QualityMetricCard({
  title,
  subtitle,
  info,
  children,
}: {
  title: string;
  subtitle: string;
  info: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-2 border-b border-zendesk-border/60 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-zendesk-navy">{title}</h3>
          <p className="text-xs text-zendesk-muted">{subtitle}</p>
        </div>
        <ChartInfoTooltip title={title}>{info}</ChartInfoTooltip>
      </header>
      {children}
    </section>
  );
}

export function QualityChartCard({
  title,
  subtitle,
  info,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  info: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-zendesk-border bg-white p-4 shadow-sm ${className}`}
    >
      <header className="mb-3 flex items-start justify-between gap-2 border-b border-zendesk-border/60 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-zendesk-navy">{title}</h3>
          <p className="text-xs text-zendesk-muted">{subtitle}</p>
        </div>
        <ChartInfoTooltip title={title}>{info}</ChartInfoTooltip>
      </header>
      {children}
    </section>
  );
}

export function QualityEmptyChart() {
  return <p className="py-12 text-center text-sm text-zendesk-muted">No data in this period</p>;
}

export function QualitySectionHeader({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rounded-lg border border-zendesk-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zendesk-navy">{title}</h2>
          <div className="mt-1 text-xs text-zendesk-muted">{children}</div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}

export function QualityReportFilterBar({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zendesk-border bg-white px-3 py-2 shadow-sm">
      {children}
    </div>
  );
}

export function QualityReportFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zendesk-muted">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[14rem] rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-gray-900"
      >
        <option value="all">All in period</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function QualitySourceLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zendesk-green underline-offset-2 hover:underline"
    >
      {label}
    </a>
  );
}
