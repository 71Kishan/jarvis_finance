export function normalizeDecimal(value: string): string {
  const raw = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    throw new Error("Invalid non-negative decimal.");
  }
  const [integer, fraction = ""] = raw.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? integer + "." + normalizedFraction : integer;
}

function parts(value: string): { units: bigint; scale: number } {
  const normalized = normalizeDecimal(value);
  const [integer, fraction = ""] = normalized.split(".");
  return {
    units: BigInt(integer + fraction),
    scale: fraction.length,
  };
}

export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = parts(left);
  const b = parts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftUnits = a.units * 10n ** BigInt(scale - a.scale);
  const rightUnits = b.units * 10n ** BigInt(scale - b.scale);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

export function multiplyDecimals(left: string, right: string): string {
  const a = parts(left);
  const b = parts(right);
  const units = a.units * b.units;
  const scale = a.scale + b.scale;
  const digits = units.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const point = digits.length - scale;
  return normalizeDecimal(digits.slice(0, point) + "." + digits.slice(point));
}

export function isMultipleOfStep(value: string, step: string): boolean {
  const a = parts(value);
  const b = parts(step);
  if (b.units <= 0n) return true;
  const scale = Math.max(a.scale, b.scale);
  const valueUnits = a.units * 10n ** BigInt(scale - a.scale);
  const stepUnits = b.units * 10n ** BigInt(scale - b.scale);
  return valueUnits % stepUnits === 0n;
}
