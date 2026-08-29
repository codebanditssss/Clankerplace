import "server-only";
import { applicationApi, type ServerAttributes } from "../pelican";
import {
  listPendingLifecycleEffects,
  markLifecycleEffectCompleted,
  recordLifecycleEffectFailure,
} from "./lifecycle";

export type PodPowerAction = "start" | "stop";
export type PowerPod = (
  podUuidShort: string,
  action: PodPowerAction,
) => Promise<void>;

export async function runLifecycleEffects(args: {
  powerPod?: PowerPod;
  limit?: number;
  nowSeconds?: number;
} = {}): Promise<{ scanned: number; completed: number; failed: number }> {
  const powerPod = args.powerPod ?? powerPodWithPelican;
  const limit = args.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("effect limit must be a positive integer");
  }

  const pending = listPendingLifecycleEffects().slice(0, limit);
  let completed = 0;
  let failed = 0;
  for (const effect of pending) {
    try {
      await powerPod(
        effect.pod_uuid_short,
        effect.kind === "power_start" ? "start" : "stop",
      );
      markLifecycleEffectCompleted(effect.id, args.nowSeconds);
      completed += 1;
    } catch (error) {
      recordLifecycleEffectFailure(effect.id, error);
      failed += 1;
      console.error(
        `[fuelborn] lifecycle ${effect.effect_key} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { scanned: pending.length, completed, failed };
}

async function powerPodWithPelican(
  podUuidShort: string,
  action: PodPowerAction,
): Promise<void> {
  const found = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(podUuidShort)}`);
  const server = found.data?.[0]?.attributes;
  if (!server) {
    throw new Error(`Pelican pod ${podUuidShort} was not found`);
  }
  await applicationApi(
    `/servers/${server.id}/${action === "start" ? "unsuspend" : "suspend"}`,
    { method: "POST" },
  );
}
