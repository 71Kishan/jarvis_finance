// Exchange/session clock.
// Uses IANA time zones rather than fixed UTC offsets and treats the clock as
// informational. A session being open is not a trading signal.

export interface MarketSession {
  id: string;
  name: string;
  category: "CRYPTO" | "STOCK" | "FOREX";
  timezone: string;
  isOpen: boolean;
  statusLabel: "OPEN" | "CLOSED" | "PRE_MARKET" | "POST_MARKET" | "WEEKEND";
  currentSessionProgress: number;
  nextTransitionLabel: string;
  nextTransitionTime: string;
  hoursDisplay: string;
  badgeColor: string;
}

export interface MarketHoursSchedule {
  nowUtc: Date;
  activeSessionCount: number;
  cryptoOpen: boolean;
  forexOpen: boolean;
  usStocksOpen: boolean;
  asianSessionOpen: boolean;
  londonSessionOpen: boolean;
  nySessionOpen: boolean;
  recommendation: string;
  sessions: MarketSession[];
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function minutes(parts: ZonedParts) {
  return parts.hour * 60 + parts.minute;
}

function isoDate(parts: ZonedParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (nth - 1) * 7));
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset));
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();

  if (weekday === 6) date.setUTCDate(day - 1);
  if (weekday === 0) date.setUTCDate(day + 1);

  return date.toISOString().slice(0, 10);
}

function goodFriday(year: number) {
  // Gregorian computus.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return easter.toISOString().slice(0, 10);
}

function usEquityHolidays(year: number): Set<string> {
  const set = new Set<string>();

  set.add(nthWeekday(year, 1, 1, 3).toISOString().slice(0, 10)); // MLK
  set.add(nthWeekday(year, 2, 1, 3).toISOString().slice(0, 10)); // Presidents
  set.add(lastWeekday(year, 5, 1).toISOString().slice(0, 10)); // Memorial
  set.add(observedFixedHoliday(year, 6, 19)); // Juneteenth
  set.add(observedFixedHoliday(year, 7, 4)); // Independence
  set.add(nthWeekday(year, 9, 1, 1).toISOString().slice(0, 10)); // Labor
  set.add(nthWeekday(year, 11, 4, 4).toISOString().slice(0, 10)); // Thanksgiving
  set.add(observedFixedHoliday(year, 12, 25)); // Christmas
  set.add(goodFriday(year)); // Good Friday

  return set;
}

function minutesToTransition(current: number, transition: number) {
  const diff = transition - current;
  const normalized = diff >= 0 ? diff : diff + 1440;
  return `in ${Math.floor(normalized / 60)}h ${normalized % 60}m`;
}

function regularSession(
  id: string,
  name: string,
  category: MarketSession["category"],
  timeZone: string,
  openMinute: number,
  closeMinute: number,
  dateOpen: boolean,
  holiday: boolean,
  hoursDisplay: string
): MarketSession {
  const now = new Date();
  const local = zonedParts(now, timeZone);
  const current = minutes(local);
  const isWeekend = local.weekday === "Sat" || local.weekday === "Sun";

  let isOpen = false;
  let status: MarketSession["statusLabel"] = "CLOSED";
  let nextLabel = "Opens";
  let nextTime = "";

  if (!dateOpen || isWeekend || holiday) {
    status = holiday ? "CLOSED" : isWeekend ? "WEEKEND" : "CLOSED";
    nextLabel = holiday ? "Next trading day" : "Opens";
    nextTime = holiday ? "after exchange holiday" : "next session";
  } else if (current >= openMinute && current < closeMinute) {
    isOpen = true;
    status = "OPEN";
    nextLabel = "Closes";
    nextTime = minutesToTransition(current, closeMinute);
  } else if (current < openMinute) {
    status = "PRE_MARKET";
    nextLabel = "Opens";
    nextTime = minutesToTransition(current, openMinute);
  } else {
    status = "POST_MARKET";
    nextLabel = "Next open";
    nextTime = "next session";
  }

  const progress = isOpen
    ? Math.round(((current - openMinute) / Math.max(1, closeMinute - openMinute)) * 100)
    : 0;

  return {
    id,
    name,
    category,
    timezone: timeZone,
    isOpen,
    statusLabel: status,
    currentSessionProgress: Math.max(0, Math.min(100, progress)),
    nextTransitionLabel: nextLabel,
    nextTransitionTime: nextTime,
    hoursDisplay,
    badgeColor: isOpen
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : status === "PRE_MARKET" || status === "POST_MARKET"
      ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };
}

export function getGlobalMarketSchedule(): MarketHoursSchedule {
  const now = new Date();

  const utc = zonedParts(now, "UTC");
  const ny = zonedParts(now, "America/New_York");
  const london = zonedParts(now, "Europe/London");
  const tokyo = zonedParts(now, "Asia/Tokyo");

  const holidays = usEquityHolidays(ny.year);
  const usHoliday = holidays.has(isoDate(ny));

  const crypto: MarketSession = {
    id: "CRYPTO_24_7",
    name: "Crypto Continuous",
    category: "CRYPTO",
    timezone: "UTC",
    isOpen: true,
    statusLabel: "OPEN",
    currentSessionProgress: Math.round((minutes(utc) / 1440) * 100),
    nextTransitionLabel: "UTC day rollover",
    nextTransitionTime: minutesToTransition(minutes(utc), 0),
    hoursDisplay: "24/7",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  };

  const weekdayNY = ny.weekday !== "Sat" && ny.weekday !== "Sun";
  const usStocks = regularSession(
    "US_EQUITIES",
    "US Equities (NYSE/Nasdaq)",
    "STOCK",
    "America/New_York",
    9 * 60 + 30,
    16 * 60,
    weekdayNY,
    usHoliday,
    "Mon-Fri 09:30-16:00 ET"
  );

  const londonSession = regularSession(
    "LONDON",
    "London",
    "FOREX",
    "Europe/London",
    8 * 60,
    16 * 60 + 30,
    london.weekday !== "Sat" && london.weekday !== "Sun",
    false,
    "Mon-Fri 08:00-16:30 local"
  );

  const tokyoSession = regularSession(
    "TOKYO",
    "Tokyo",
    "FOREX",
    "Asia/Tokyo",
    9 * 60,
    18 * 60,
    tokyo.weekday !== "Sat" && tokyo.weekday !== "Sun",
    false,
    "Mon-Fri 09:00-18:00 local"
  );

  const nySession = regularSession(
    "NEW_YORK_SESSION",
    "New York FX Session",
    "FOREX",
    "America/New_York",
    8 * 60,
    17 * 60,
    weekdayNY,
    false,
    "Mon-Fri 08:00-17:00 ET"
  );

  const forexOpen =
    ny.weekday !== "Sat" &&
    !(ny.weekday === "Sun" && minutes(ny) < 17 * 60) &&
    !(ny.weekday === "Fri" && minutes(ny) >= 17 * 60);

  const forexSession: MarketSession = {
    id: "FOREX_24_5",
    name: "Global FX (indicative 24/5)",
    category: "FOREX",
    timezone: "America/New_York",
    isOpen: forexOpen,
    statusLabel: forexOpen ? "OPEN" : "WEEKEND",
    currentSessionProgress: 0,
    nextTransitionLabel: forexOpen ? "Weekend close" : "Weekend reopen",
    nextTransitionTime: forexOpen ? "Friday 17:00 ET" : "Sunday 17:00 ET",
    hoursDisplay: "Sun 17:00 ET - Fri 17:00 ET",
    badgeColor: forexOpen
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  const sessions = [crypto, usStocks, londonSession, tokyoSession, nySession, forexSession];

  return {
    nowUtc: now,
    activeSessionCount: sessions.filter((s) => s.isOpen).length,
    cryptoOpen: true,
    forexOpen,
    usStocksOpen: usStocks.isOpen,
    asianSessionOpen: tokyoSession.isOpen,
    londonSessionOpen: londonSession.isOpen,
    nySessionOpen: nySession.isOpen,
    recommendation: "Market clock only. Session status does not imply a trade opportunity.",
    sessions,
  };
}
