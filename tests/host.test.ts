import { describe, expect, it } from "vitest";
import { isLocalHostHeader } from "../app/lib/host";

describe("isLocalHostHeader", () => {
  it.each(["localhost", "localhost:3000", "LOCALHOST:8080", "127.0.0.1", "127.0.0.1:3000", "[::1]", "[::1]:3000"])(
    "accepts local host %s", (host) => expect(isLocalHostHeader(host)).toBe(true),
  );
  it.each([
    null,
    undefined,
    "",
    "   ",
    "localhost.attacker.example",
    "evil-localhost.com",
    "127.0.0.1.evil.com",
    "0.0.0.0",
    "::1",
    "[::1]x",
    "localhost:",
    "localhost:abc",
    "localhost:3000/extra",
    "example.com",
    "localhost..",
  ])("rejects %j", (host) => expect(isLocalHostHeader(host as string | null)).toBe(false));
});
