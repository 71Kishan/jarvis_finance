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

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function weekdayNumber(short: string): number {
  return (
    { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>
  )[short] ?? 0;
}

function minuteOfDay(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

function countdownMinutes(nowMinutes: number, targetMinutes: number): string {
  const raw = targetMinutes - nowMinutes;
  const delta = raw >= 0 ? raw : raw + 1440;
  return "in " + Math.floor(delta / 60) + "h " + (delta % 60) + "m";
}

function sessionProgress(now: number, start: number, end: number): number {
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start) / (end - start)) * 100);
}

export function getGlobalMarketSchedule(): MarketHoursSchedule {
  const now = new Date();

  // Crypto trades continuously in principle, but exchanges can suspend/maintain markets.
  const utcMinutes = minuteOfDay(now, "UTC");
  const cryptoSession: MarketSession = {
    id: "CRYPTO_24_7",
    name: "Crypto Continuous",
    category: "CRYPTO",
    timezone: "UTC",
    isOpen: true,
    statusLabel: "OPEN",
    currentSessionProgress: Math.round((utcMinutes / 1440) * 100),
    nextTransitionLabel: "UTC reference day boundary",
    nextTransitionTime: countdownMinutes(utcMinutes, 1440),
    hoursDisplay: "Generally 24/7; exchange outages/maintenance may apply",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  };

  // US regular session: local Eastern time automatically handles DST.
  const usZone = "America/New_York";
  const us = zonedParts(now, usZone);
  const usMinutes = us.hour * 60 + us.minute;
  const usDay = weekdayNumber(us.weekday);
  const usWeekend = usDay === 0 || usDay === 6;
  const usOpenAt = 9 * 60 + 30;
  const usCloseAt = 16 * 60;
  const usPreAt = 4 * 60;
  const usPostEnd = 20 * 60;

  let usStatus: MarketSession["statusLabel"] = usWeekend ? "WEEKEND" : "CLOSED";
  let usOpen = false;
  let usProgress = 0;
  let usNext = usWeekend ? "Next weekday regular session" : "Regular open";
  let usNextTime = usWeekend ? "Next weekday" : countdownMinutes(usMinutes, usMinutes < usOpenAt ? usOpenAt : 1440);

  if (!usWeekend && usMinutes >= usPreAt && usMinutes < usOpenAt) {
    usStatus = "PRE_MARKET";
    usNext = "Regular open";
    usNextTime = countdownMinutes(usMinutes, usOpenAt);
  } else if (!usWeekend && usMinutes >= usOpenAt && usMinutes < usCloseAt) {
    usStatus = "OPEN";
    usOpen = true;
    usProgress = sessionProgress(usMinutes, usOpenAt, usCloseAt);
    usNext = "Regular close";
    usNextTime = countdownMinutes(usMinutes, usCloseAt);
  } else if (!usWeekend && usMinutes >= usCloseAt && usMinutes < usPostEnd) {
    usStatus = "POST_MARKET";
    usNext = "Extended-hours reference end";
    usNextTime = countdownMinutes(usMinutes, usPostEnd);
  }

  const usStocksSession: MarketSession = {
    id: "US_EQUITIES",
    name: "US Equities (NYSE/Nasdaq)",
    category: "STOCK",
    timezone: usZone,
    isOpen: usOpen,
    statusLabel: usStatus,
    currentSessionProgress: usProgress,
    nextTransitionLabel: usNext,
    nextTransitionTime: usNextTime,
    hoursDisplay: "Regular session: Mon-Fri 09:30-16:00 ET",
    badgeColor: usOpen
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : usStatus === "PRE_MARKET" || usStatus === "POST_MARKET"
        ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
        : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  // FX is a general 24/5 reference. Broker/venue calendars and rollover can differ.
  const utc = zonedParts(now, "UTC");
  const utcDay = weekdayNumber(utc.weekday);
  const utcNow = utc.hour * 60 + utc.minute;
  const forexWeekend =
    utcDay === 6 ||
    (utcDay === 5 && utcNow >= 21 * 60) ||
    (utcDay === 0 && utcNow < 21 * 60);

  const forexOpen = !forexWeekend;
  const forexSession: MarketSession = {
    id: "FOREX_24_5",
    name: "FX Reference Session",
    category: "FOREX",
    timezone: "UTC reference",
    isOpen: forexOpen,
    statusLabel: forexWeekend ? "WEEKEND" : "OPEN",
    currentSessionProgress: forexOpen ? 50 : 0,
    nextTransitionLabel: forexWeekend ? "Weekly reopen (reference)" : "Weekly close (reference)",
    nextTransitionTime: forexWeekend ? "Sunday evening UTC" : "Friday evening UTC",
    hoursDisplay: "Generally 24/5; broker/venue hours vary",
    badgeColor: forexOpen
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  const londonZone = "Europe/London";
  const london = zonedParts(now, londonZone);
  const londonMinutes = london.hour * 60 + london.minute;
  const londonDay = weekdayNumber(london.weekday);
  const londonOpenAt = 8 * 60;
  const londonCloseAt = 16 * 60 + 30;
  const londonOpen =
    londonDay >= 1 &&
    londonDay <= 5 &&
    londonMinutes >= londonOpenAt &&
    londonMinutes < londonCloseAt;

  const londonSession: MarketSession = {
    id: "LONDON_SESSION",
    name: "London (LSE / Europe)",
    category: "STOCK",
    timezone: londonZone,
    isOpen: londonOpen,
    statusLabel: londonOpen ? "OPEN" : londonDay === 0 || londonDay === 6 ? "WEEKEND" : "CLOSED",
    currentSessionProgress: londonOpen ? sessionProgress(londonMinutes, londonOpenAt, londonCloseAt) : 0,
    nextTransitionLabel: londonOpen ? "Reference regular close" : "Reference regular open",
    nextTransitionTime: londonOpen ? countdownMinutes(londonMinutes, londonCloseAt) : "08:00 local",
    hoursDisplay: "Reference: Mon-Fri 08:00-16:30 London time",
    badgeColor: londonOpen
      ? "text-sky-400 bg-sky-500/10 border-sky-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  const tokyoZone = "Asia/Tokyo";
  const tokyo = zonedParts(now, tokyoZone);
  const tokyoMinutes = tokyo.hour * 60 + tokyo.minute;
  const tokyoDay = weekdayNumber(tokyo.weekday);
  const morningOpen = tokyoMinutes >= 9 * 60 && tokyoMinutes < 11 * 60 + 30;
  const afternoonOpen = tokyoMinutes >= 12 * 60 + 30 && tokyoMinutes < 15 * 60 + 30;
  const tokyoOpen = tokyoDay >= 1 && tokyoDay <= 5 && (morningOpen || afternoonOpen);

  const tokyoSession: MarketSession = {
    id: "TOKYO_SESSION",
    name: "Tokyo (TSE / Asia)",
    category: "STOCK",
    timezone: tokyoZone,
    isOpen: tokyoOpen,
    statusLabel: tokyoOpen ? "OPEN" : tokyoDay === 0 || tokyoDay === 6 ? "WEEKEND" : "CLOSED",
    currentSessionProgress: tokyoOpen
      ? morningOpen
        ? sessionProgress(tokyoMinutes, 9 * 60, 11 * 60 + 30)
        : sessionProgress(tokyoMinutes, 12 * 60 + 30, 15 * 60 + 30)
      : 0,
    nextTransitionLabel: tokyoOpen ? "Reference session close" : "Reference regular open",
    nextTransitionTime: tokyoOpen ? "Within today's session" : "09:00 local",
    hoursDisplay: "Reference: Mon-Fri 09:00-11:30 & 12:30-15:30 JST",
    badgeColor: tokyoOpen
      ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  const sessions = [cryptoSession, usStocksSession, forexSession, londonSession, tokyoSession];
  let recommendation = "Session status is reference data only; it never authorizes or routes a trade.";
  if (usOpen) {
    recommendation = "US regular session is open; treat liquidity as context, not a signal.";
  } else if (londonOpen) {
    recommendation = "London reference session is open; use verified market data rather than session timing alone.";
  } else if (tokyoOpen) {
    recommendation = "Tokyo reference session is open; session timing alone is not evidence of edge.";
  } else {
    recommendation = "No tracked regular equity session is open; that does not imply better or worse opportunity.";
  }

  return {
    nowUtc: now,
    activeSessionCount: sessions.filter((session) => session.isOpen).length,
    cryptoOpen: true,
    forexOpen,
    usStocksOpen: usOpen,
    asianSessionOpen: tokyoOpen,
    londonSessionOpen: londonOpen,
    nySessionOpen: usOpen,
    recommendation,
    sessions,
  };
}
