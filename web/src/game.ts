import type { Booking, Core } from "./chain";
export const fmt = (v: bigint | number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-US");
export function integer(
  value: string,
  min = 0n,
  max = (1n << 64n) - 1n,
): bigint {
  if (!/^\d+$/.test(value.trim())) throw new Error("Enter a whole number.");
  const n = BigInt(value.trim());
  if (n < min || n > max)
    throw new Error(`Choose a number from ${min} to ${max}.`);
  return n;
}
export function validStart(core: Core, start: bigint): boolean {
  return (
    start > core.current &&
    (start - 1n) / 144n === core.day &&
    (start + 4n) / 144n === core.day
  );
}
export function trainState(
  b: Booking,
  core: Core | null,
): "empty" | "settled" | "unknown" | "paused" | "identity" | "ready" {
  if (b.start === 0n) return "empty";
  if (b.settled) return "settled";
  if (!core) return "unknown";
  if (!core.identity) return "identity";
  if (core.paused) return "paused";
  return b.start + 5n <= core.frontier ? "ready" : "unknown";
}
export function normalizeHandle(value: string): string {
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle))
    throw new Error(
      "Use 1–15 letters, numbers, or underscores for your X handle.",
    );
  return handle;
}
export function shareLink(handle: string, url = location.href): string {
  const link = new URL(url);
  link.search = "";
  link.hash = "";
  link.searchParams.set("ref", normalizeHandle(handle));
  return link.toString();
}

export const staminaBand = (stamina: bigint) =>
  Number((stamina < 10000n ? stamina : 9999n) / 2000n);
export const bandRange = (stamina: bigint) => {
  const band = staminaBand(stamina);
  return `${fmt(band * 2000)}–${fmt(band === 4 ? 10000 : band * 2000 + 1999)}`;
};
export function matchFromUrl(): bigint | null {
  try {
    return integer(
      new URL(location.href).searchParams.get("match") || "",
      1n,
      (1n << 256n) - 1n,
    );
  } catch {
    return null;
  }
}
export function matchLink(id: bigint): string {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("match", id.toString());
  url.hash = "play";
  return url.toString();
}
