/**
 * Browser-facing URLs for the dashboard backend.
 *
 * The dashboard is served by the bot HTTP server in production.  Building
 * URLs from the document's origin keeps custom ports, reverse proxies, and
 * HTTPS deployments coherent instead of coupling the bundle to 127.0.0.1.
 */

export interface DashboardLocation {
  readonly protocol: string;
  readonly host: string;
}

function browserLocation(): DashboardLocation {
  // The production path always has window.location. The fallback is only for
  // non-browser module evaluation (unit tests/SSR); callers can inject a
  // location explicitly and browser traffic never uses this value.
  if (typeof window === "undefined") {
    return { protocol: "http:", host: "127.0.0.1:7913" };
  }
  return window.location;
}

function dashboardBaseUrl(location: DashboardLocation, basePath: string): URL {
  const origin = `${location.protocol}//${location.host}`;
  // Vite's BASE_URL is the deployment base.  It is normally "/", but using
  // it here also keeps a dashboard mounted below a reverse-proxy prefix on
  // that prefix rather than silently escaping it.
  return new URL(basePath, origin);
}

/** Build a same-origin HTTP API URL, respecting Vite's configured base path. */
export function dashboardApiUrl(
  path: string,
  location: DashboardLocation = browserLocation(),
  basePath: string = import.meta.env.BASE_URL ?? "/",
): string {
  return new URL(path.replace(/^\/+/, ""), dashboardBaseUrl(location, basePath)).toString();
}

/** Build the matching same-origin WebSocket URL (http→ws, https→wss). */
export function dashboardWebSocketUrl(
  path = "ws",
  location: DashboardLocation = browserLocation(),
  basePath: string = import.meta.env.BASE_URL ?? "/",
): string {
  const url = new URL(path.replace(/^\/+/, ""), dashboardBaseUrl(location, basePath));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
