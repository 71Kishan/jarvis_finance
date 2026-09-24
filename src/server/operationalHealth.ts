export type OperationalState = "HEALTHY" | "DEGRADED" | "HALTED";

export interface OperationalComponent {
  id: string;
  label: string;
  state: "READY" | "DEGRADED" | "HALTED" | "DISABLED";
  critical: boolean;
  message: string;
  ageMs?: number | null;
}

export interface OperationalHealthInput {
  now?: number;
  database: { state: string; configured: boolean; lastSuccessfulCheckAt?: number | null };
  market: { state: string; connected: boolean; lastMessageAt?: number | null };
  catalog: { state: string };
  testnetConfigured: boolean;
  userDataStream: { connected: boolean; subscribed: boolean; lastEventAt?: number; lastErrorAt?: number; lastError?: string };
  reconciliation: { lastRunAt?: number; lastSuccessAt?: number; lastErrorAt?: number; lastError?: string; ordersChecked: number };
  paper: { status: string; lastPollAt?: number | null; lastProcessedCandleAt?: number | null };
  shadow: { status: string; lastPollAt?: number | null; lastProcessedCandleAt?: number | null };
  shadowValidation?: { status?: "INSUFFICIENT_EVIDENCE" | "FAILED" | "PROVISIONALLY_VALIDATED" } | null;
};

export interface OperationalHealthResult {
  state: OperationalState;
  safeToStartShadow: boolean;
  components: OperationalComponent[];
  generatedAt: number;
};

function age(now: number, timestamp?: number | null): number | null {
  if (timestamp === undefined || timestamp === null || !Number.isFinite(timestamp)) return null;
  return Math.max(0, now - timestamp);
}

export function evaluateOperationalHealth(input: OperationalHealthInput): OperationalHealthResult {
  const now = input.now ?? Date.now();
  const components: OperationalComponent[] = [];

  if (input.database.configured) {
    const dbAge = age(now, input.database.lastSuccessfulCheckAt);
    const ready = input.database.state === "READY" && (dbAge === null || dbAge <= 60_000);
    components.push({
      id: "DATABASE",
      label: "PostgreSQL",
      state: ready ? "READY" : "DEGRADED",
      critical: true,
      message: ready ? "Persistent platform database is available." : "Persistent database is configured but not healthy.",
      ageMs: dbAge,
    });
  } else {
    components.push({
      id: "DATABASE",
      label: "PostgreSQL",
      state: "DISABLED",
      critical: false,
      message: "Database is not configured; authenticated automation cannot be considered production-ready.",
    });
  }

  const marketAge = age(now, input.market.lastMessageAt);
  const marketReady = input.market.state === "READY" && input.market.connected && marketAge !== null && marketAge <= 15_000;
  components.push({
    id: "MARKET_DATA",
    label: "Binance market gateway",
    state: marketReady ? "READY" : "DEGRADED",
    critical: true,
    message: marketReady ? "Trusted market stream is connected and fresh." : "Market data is disconnected, stale, or reconnecting.",
    ageMs: marketAge,
  });

  const catalogReady = input.catalog.state === "READY";
  components.push({
    id: "INSTRUMENT_CATALOG",
    label: "Instrument catalog",
    state: catalogReady ? "READY" : "DEGRADED",
    critical: true,
    message: catalogReady ? "Tradable provider instrument metadata is ready." : "Instrument metadata is unavailable or stale.",
  });

  if (input.testnetConfigured) {
    const streamAge = age(now, input.userDataStream.lastEventAt);
    const userDataReady = input.userDataStream.connected && input.userDataStream.subscribed && streamAge !== null && streamAge <= 120_000;
    components.push({
      id: "USER_DATA_STREAM",
      label: "Binance account stream",
      state: userDataReady ? "READY" : "DEGRADED",
      critical: true,
      message: userDataReady
        ? "Provider account event stream is subscribed and recent."
        : input.userDataStream.lastError || "Provider account event stream is not healthy.",
      ageMs: streamAge,
    });

    const reconcileAge = age(now, input.reconciliation.lastSuccessAt);
    const reconciliationReady = input.reconciliation.lastSuccessAt !== undefined && reconcileAge !== null && reconcileAge <= 120_000 && !input.reconciliation.lastError;
    components.push({
      id: "RECONCILIATION",
      label: "Sandbox reconciliation",
      state: reconciliationReady ? "READY" : "DEGRADED",
      critical: true,
      message: reconciliationReady ? "Periodic provider reconciliation is healthy." : input.reconciliation.lastError || "Provider reconciliation has not produced a recent successful cycle.",
      ageMs: reconcileAge,
    });
  } else {
    components.push({
      id: "USER_DATA_STREAM",
      label: "Binance account stream",
      state: "DISABLED",
      critical: false,
      message: "No provider account is configured.",
    });
  }

  for (const runtime of [
    { id: "PAPER_RUNTIME", label: "Paper runtime", value: input.paper },
    { id: "SHADOW_RUNTIME", label: "Shadow runtime", value: input.shadow },
  ]) {
    const runtimeState = runtime.value.status;
    const halted = ["ERROR", "HALTED"].includes(runtimeState);
    const runtimeAge = age(now, runtime.value.lastPollAt);
    components.push({
      id: runtime.id,
      label: runtime.label,
      state: halted ? "HALTED" : ["RUNNING", "WAITING_FOR_DATA", "STARTING"].includes(runtimeState) ? "READY" : "DEGRADED",
      critical: false,
      message: halted ? "Runtime is blocked and requires operator attention." : runtimeState,
      ageMs: runtimeAge,
    });
  }

  if (input.shadowValidation?.status === "FAILED") {
    components.push({
      id: "SHADOW_VALIDATION",
      label: "Shadow validation",
      state: "DEGRADED",
      critical: true,
      message: "Forward shadow evidence currently fails at least one promotion gate.",
    });
  } else if (input.shadowValidation?.status === "PROVISIONALLY_VALIDATED") {
    components.push({
      id: "SHADOW_VALIDATION",
      label: "Shadow validation",
      state: "READY",
      critical: true,
      message: "Forward shadow evidence currently passes the research policy.",
    });
  } else {
    components.push({
      id: "SHADOW_VALIDATION",
      label: "Shadow validation",
      state: "DEGRADED",
      critical: true,
      message: "Forward shadow evidence is not yet sufficient for promotion.",
    });
  }

  const criticalBlocked = components.some((component) => component.critical && (component.state === "DEGRADED" || component.state === "HALTED"));
  const anyHalted = components.some((component) => component.state === "HALTED");
  const state: OperationalState = anyHalted ? "HALTED" : criticalBlocked ? "DEGRADED" : "HEALTHY";
  const safeToStartShadow = components.every((component) =>
    !component.critical || component.id === "SHADOW_VALIDATION"
      ? component.state !== "HALTED"
      : component.state === "READY"
  ) && input.shadowValidation?.status === "PROVISIONALLY_VALIDATED";

  return { state, safeToStartShadow, components, generatedAt: now };
}