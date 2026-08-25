import type { ErrorInfo } from "react";

/**
 * Everything the error screen needs to build a report, in one place.
 *
 * The report leaves the device three ways, in order of preference: the Convex
 * mutation (lands in the admin inbox), the clipboard, and a prefilled email —
 * because the kind of crash that needs reporting is exactly the kind that
 * might have taken the backend down with it.
 */

export interface ErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  description?: string;
  platform: string;
  appVersion?: string;
  url?: string;
  at: string;
}

export const REPORT_EMAIL = "minus4399@gmail.com";

export function buildWebReport(
  error: Error,
  info?: ErrorInfo | null,
): ErrorReport {
  return {
    message: error.message || "Unexpected app error",
    stack: error.stack?.slice(0, 8000),
    componentStack: info?.componentStack?.slice(0, 8000),
    platform: "web",
    appVersion: "1.0",
    url: typeof window !== "undefined" ? window.location.href : undefined,
    at: new Date().toISOString(),
  };
}

export function reportToText(r: ErrorReport): string {
  return [
    `hooked. error report`,
    `at:      ${r.at}`,
    `platform:${r.platform} ${r.appVersion ?? ""}`,
    `url:     ${r.url ?? "-"}`,
    ``,
    `what the listener said:${r.description ? `\n${r.description}` : " (nothing)"}`,
    ``,
    `error: ${r.message}`,
    r.stack ? `\nstack:\n${r.stack}` : "",
    r.componentStack ? `\ncomponent stack:\n${r.componentStack}` : "",
  ].join("\n");
}

export function mailtoHref(r: ErrorReport): string {
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(
    "hooked. error report",
  )}&body=${encodeURIComponent(reportToText({ ...r, description: r.description ?? "(add notes here)" }))}`;
}

export async function copyReport(r: ErrorReport): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(reportToText(r));
    return true;
  } catch {
    return false;
  }
}
