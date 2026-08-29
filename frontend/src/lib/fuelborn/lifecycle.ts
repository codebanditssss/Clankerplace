import "server-only";
import db, {
  type FuelbornAgentRow,
  type FuelLifecycleEffectRow,
  type FuelMeterStateRow,
} from "../db";
import {
  appendFuelEntry,
  getFuelBalance,
  type ChainEventRef,
} from "./ledger";

export type FuelTickResult = {
  agent_id: string;
  burned_micro_fuel: number;
  balance_micro_fuel: number;
  transition: "died" | null;
};

export function configureFuelMeter(args: {
  agentId: string;
  burnRateMicroFuelPerSecond: number;
  nowSeconds?: number;
}): FuelMeterStateRow {
  requirePositiveInteger(
    args.burnRateMicroFuelPerSecond,
    "burn rate",
  );
  const now = args.nowSeconds ?? unixNow();
  const agent = getAgent(args.agentId);
  const pod = db
    .prepare<[string], { economy_mode: string }>(
      `SELECT economy_mode FROM pod_meter_state WHERE pod_uuid_short = ?`,
    )
    .get(agent.pod_uuid_short);
  if (pod?.economy_mode !== "fuelborn") {
    throw new Error("agent pod is not owned by the FuelBorn economy");
  }

  db.prepare(
    `INSERT INTO fuel_meter_state (
       agent_id, burn_rate_micro_fuel_per_second, last_burned_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       burn_rate_micro_fuel_per_second = excluded.burn_rate_micro_fuel_per_second,
       last_burned_at = excluded.last_burned_at,
       updated_at = excluded.updated_at`,
  ).run(
    agent.id,
    args.burnRateMicroFuelPerSecond,
    now,
    now,
    now,
  );
  return db
    .prepare<[string], FuelMeterStateRow>(
      `SELECT * FROM fuel_meter_state WHERE agent_id = ?`,
    )
    .get(agent.id)!;
}

export function runFuelTick(nowSeconds: number = unixNow()): FuelTickResult[] {
  const agents = db
    .prepare<[], { agent_id: string }>(
      `SELECT a.id AS agent_id
         FROM fuelborn_agents a
         JOIN fuel_meter_state fms ON fms.agent_id = a.id
         JOIN pod_meter_state pms ON pms.pod_uuid_short = a.pod_uuid_short
        WHERE a.status = 'alive'
          AND pms.economy_mode = 'fuelborn'
          AND pms.state = 'running'
        ORDER BY a.id`,
    )
    .all();
  return agents.map((agent) => tickAgent(agent.agent_id, nowSeconds));
}

export function fundAgent(args: {
  agentId: string;
  deltaMicroFuel: number;
  chainEvent: ChainEventRef;
  nowSeconds?: number;
}): {
  credited: boolean;
  revived: boolean;
  balance_micro_fuel: number;
} {
  requirePositiveInteger(args.deltaMicroFuel, "funding amount");
  const now = args.nowSeconds ?? unixNow();

  const fund = db.transaction(() => {
    const credit = appendFuelEntry({
      agentId: args.agentId,
      deltaMicroFuel: args.deltaMicroFuel,
      reason: "funding",
      chainEvent: args.chainEvent,
      nowSeconds: now,
    });
    const agent = getAgent(args.agentId);
    let revived = false;
    if (credit.created && agent.status === "dead") {
      const nextRevival = agent.revival_count + 1;
      db.prepare(
        `UPDATE fuelborn_agents
            SET status = 'alive', revival_count = ?, updated_at = ?
          WHERE id = ?`,
      ).run(nextRevival, now, agent.id);
      db.prepare(
        `UPDATE pod_meter_state
            SET state = 'provisioning', updated_at = ?
          WHERE pod_uuid_short = ? AND economy_mode = 'fuelborn'`,
      ).run(now, agent.pod_uuid_short);
      db.prepare(
        `UPDATE fuel_meter_state
            SET last_burned_at = ?, updated_at = ?
          WHERE agent_id = ?`,
      ).run(now, now, agent.id);
      enqueueEffect({
        effectKey: `revival:${agent.id}:${nextRevival}`,
        agentId: agent.id,
        podUuidShort: agent.pod_uuid_short,
        kind: "power_start",
        nowSeconds: now,
      });
      revived = true;
    }
    return {
      credited: credit.created,
      revived,
      balance_micro_fuel: getFuelBalance(agent.id),
    };
  });

  return fund();
}

export function listPendingLifecycleEffects(): FuelLifecycleEffectRow[] {
  return db
    .prepare<[], FuelLifecycleEffectRow>(
      `SELECT * FROM fuel_lifecycle_effects
        WHERE status = 'pending' ORDER BY id`,
    )
    .all();
}

export function markLifecycleEffectCompleted(
  effectId: number,
  nowSeconds: number = unixNow(),
): void {
  requirePositiveInteger(effectId, "effect id");
  const complete = db.transaction(() => {
    const effect = db
      .prepare<[number], FuelLifecycleEffectRow>(
        `SELECT * FROM fuel_lifecycle_effects WHERE id = ?`,
      )
      .get(effectId);
    if (!effect) throw new Error("lifecycle effect not found");
    if (effect.status === "completed") return;

    db.prepare(
      `UPDATE fuel_lifecycle_effects
          SET status = 'completed', completed_at = ?, attempts = attempts + 1,
              last_error = NULL
        WHERE id = ?`,
    ).run(nowSeconds, effect.id);
    if (effect.kind === "power_start") {
      db.prepare(
        `UPDATE pod_meter_state
            SET state = 'running', last_billed_at = ?, updated_at = ?
          WHERE pod_uuid_short = ? AND economy_mode = 'fuelborn'`,
      ).run(nowSeconds, nowSeconds, effect.pod_uuid_short);
      db.prepare(
        `UPDATE fuel_meter_state
            SET last_burned_at = ?, updated_at = ?
          WHERE agent_id = ?`,
      ).run(nowSeconds, nowSeconds, effect.agent_id);
    }
  });
  complete();
}

export function recordLifecycleEffectFailure(
  effectId: number,
  error: unknown,
): void {
  requirePositiveInteger(effectId, "effect id");
  const message = error instanceof Error ? error.message : String(error);
  const result = db
    .prepare(
      `UPDATE fuel_lifecycle_effects
          SET attempts = attempts + 1, last_error = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(message.slice(0, 1_000), effectId);
  if (result.changes === 0) {
    const effect = db
      .prepare<[number], Pick<FuelLifecycleEffectRow, "status">>(
        `SELECT status FROM fuel_lifecycle_effects WHERE id = ?`,
      )
      .get(effectId);
    if (!effect) throw new Error("lifecycle effect not found");
  }
}

function tickAgent(agentId: string, nowSeconds: number): FuelTickResult {
  const tick = db.transaction(() => {
    const row = db
      .prepare<
        [string],
        FuelMeterStateRow & {
          pod_uuid_short: string;
          revival_count: number;
        }
      >(
        `SELECT fms.*, a.pod_uuid_short, a.revival_count
           FROM fuel_meter_state fms
           JOIN fuelborn_agents a ON a.id = fms.agent_id
          WHERE fms.agent_id = ? AND a.status = 'alive'`,
      )
      .get(agentId);
    if (!row) throw new Error("active FuelBorn meter not found");
    const elapsed = Math.max(0, nowSeconds - row.last_burned_at);
    const balance = Math.max(0, getFuelBalance(agentId));
    const requestedBurn = checkedProduct(
      row.burn_rate_micro_fuel_per_second,
      elapsed,
    );
    const burned = Math.min(balance, requestedBurn);
    if (burned > 0) {
      appendFuelEntry({
        agentId,
        deltaMicroFuel: -burned,
        reason: "idle_burn",
        refType: "fuel_tick",
        refId: `${row.last_burned_at}:${nowSeconds}`,
        nowSeconds,
      });
    }
    db.prepare(
      `UPDATE fuel_meter_state
          SET last_burned_at = ?, updated_at = ? WHERE agent_id = ?`,
    ).run(nowSeconds, nowSeconds, agentId);

    const remaining = balance - burned;
    let transition: "died" | null = null;
    if (remaining === 0) {
      db.prepare(
        `UPDATE fuelborn_agents
            SET status = 'dead', died_at = ?, updated_at = ? WHERE id = ?`,
      ).run(nowSeconds, nowSeconds, agentId);
      db.prepare(
        `UPDATE pod_meter_state
            SET state = 'stopped', updated_at = ?
          WHERE pod_uuid_short = ? AND economy_mode = 'fuelborn'`,
      ).run(nowSeconds, row.pod_uuid_short);
      enqueueEffect({
        effectKey: `death:${agentId}:${row.revival_count}`,
        agentId,
        podUuidShort: row.pod_uuid_short,
        kind: "power_stop",
        nowSeconds,
      });
      transition = "died";
    }
    return {
      agent_id: agentId,
      burned_micro_fuel: burned,
      balance_micro_fuel: remaining,
      transition,
    };
  });
  return tick();
}

function enqueueEffect(args: {
  effectKey: string;
  agentId: string;
  podUuidShort: string;
  kind: FuelLifecycleEffectRow["kind"];
  nowSeconds: number;
}): void {
  db.prepare(
    `INSERT OR IGNORE INTO fuel_lifecycle_effects (
       effect_key, agent_id, pod_uuid_short, kind, created_at
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    args.effectKey,
    args.agentId,
    args.podUuidShort,
    args.kind,
    args.nowSeconds,
  );
}

function getAgent(agentId: string): FuelbornAgentRow {
  const agent = db
    .prepare<[string], FuelbornAgentRow>(
      `SELECT * FROM fuelborn_agents WHERE id = ?`,
    )
    .get(agentId);
  if (!agent) throw new Error("FuelBorn agent not found");
  return agent;
}

function checkedProduct(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error("FUEL burn exceeds safe integer range");
  }
  return result;
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
