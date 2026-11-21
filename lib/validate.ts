// Shared request validation. Reject with 422 and a plain message — bad
// data reaching the console during a demo is worse than a rejected packet.
// See files/api-contract.md section 6.
export class ValidationError extends Error {}

export function requireDeviceUid(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) throw new ValidationError("device_uid is required");
  return v;
}

export function checkRecordedAt(iso: unknown): string {
  if (typeof iso !== "string") throw new ValidationError("recorded_at must be an ISO timestamp");
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new ValidationError("recorded_at is not a valid timestamp");
  if (t > Date.now() + 24 * 3_600_000) throw new ValidationError("recorded_at is more than 24 hours in the future");
  return iso;
}

export function checkAngleDeg(v: unknown, field: string): number {
  if (typeof v !== "number" || v < -180 || v > 180) throw new ValidationError(`${field} must be between -180 and 180`);
  return v;
}

export function checkEventType(v: unknown): "opened" | "closed" {
  if (v !== "opened" && v !== "closed") throw new ValidationError('event must be "opened" or "closed"');
  return v;
}
