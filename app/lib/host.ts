const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/**
 * The dashboard is a local-only tool bound to 127.0.0.1; only requests whose Host header
 * addresses this machine are served. Rejects lookalikes (localhost.attacker.example),
 * bare ::1 without brackets, empty ports and non-numeric ports.
 */
export function isLocalHostHeader(host: string | null | undefined): boolean {
  return host != null && LOCAL_HOST.test(host.trim());
}
