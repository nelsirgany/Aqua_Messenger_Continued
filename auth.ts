// Shared secret auth for device uploads. Not production auth — documented
// as such in files/api-contract.md.
import { NextRequest } from "next/server";

export function checkDeviceKey(req: NextRequest): boolean {
  const key = req.headers.get("X-Aqua-Key");
  return Boolean(key) && key === process.env.AQUA_DEVICE_KEY;
}
