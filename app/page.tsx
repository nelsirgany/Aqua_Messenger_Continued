import { getHydrantStatuses, getDeviceHealth, getOpenEvents } from "@/lib/db";
import { evaluateOfflineDevices } from "@/lib/faults";
import { ConsoleView } from "@/components/ConsoleView";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  // Opening the console counts as a read, and DEVICE_OFFLINE is evaluated
  // on read — nothing arrives to trigger it. This runs before the three
  // queries so a device that went silent is already in the health queue
  // on first paint. See lib/faults.ts.
  await evaluateOfflineDevices();

  const [hydrants, health, events] = await Promise.all([
    getHydrantStatuses(),
    getDeviceHealth(),
    getOpenEvents(50),
  ]);

  return <ConsoleView initialHydrants={hydrants} health={health} events={events} />;
}
