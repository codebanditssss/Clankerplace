import "server-only";

/**
 * Structured billing logger. Emits one-line JSON per event so a
 * log-aggregation pipeline (jq grep at v1, Loki/Datadog at v2) can
 * filter by event kind, user_id, pod_uuid_short without parsing
 * free-form strings.
 *
 * Three levels: info, warn, error. Everything routes through
 * console.{log,warn,error} so it lands in the same systemd journal
 * stream the rest of the app uses.
 *
 * Convention:
 *   billingLog.info("meter.tick.completed", { pods_ticked: 12, owed_cents_total: 47 })
 *
 * The `event` field is a dot-delimited identifier; dashes are reserved
 * for IDs inside values. Keep the schema flat — nested objects are fine
 * but discourage them so jq filters stay simple.
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    lvl: level,
    src: "billing",
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const billingLog = {
  info(event: string, fields: Record<string, unknown> = {}): void {
    emit("info", event, fields);
  },
  warn(event: string, fields: Record<string, unknown> = {}): void {
    emit("warn", event, fields);
  },
  error(event: string, fields: Record<string, unknown> = {}): void {
    emit("error", event, fields);
  },
};
