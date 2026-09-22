// Global Financial Market Session Clock & Holiday Engine
// Computes real-time open/close status, countdowns, and active trading hours across Crypto, Forex, US Equities, and Asian/European sessions.

export interface MarketSession {
  id: string;
  name: string;
  category: "CRYPTO" | "STOCK" | "FOREX";
  timezone: string;
  isOpen: boolean;
  statusLabel: "OPEN" | "CLOSED" | "PRE_MARKET" | "POST_MARKET" | "WEEKEND";
  currentSessionProgress: number; // 0 to 100%
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

export function getGlobalMarketSchedule(): MarketHoursSchedule {
  const now = new Date();

  const zoned = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
    const weekday = get("weekday");
    const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    return { dayIndex, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  };

  const formatDuration = (minutes: number) => {
    const total = Math.max(0, Math.round(minutes));
    return `${Math.floor(total / 60)}h ${total % 60}m`;
  };

  const sessionProgress = (minutes: number, open: number, close: number) =>
    Math.max(0, Math.min(100, Math.round(((minutes - open) / Math.max(1, close - open)) * 100)));

  const us = zoned("America/New_York");
  const london = zoned("Europe/London");
  const tokyo = zoned("Asia/Tokyo");
  const utcDay = now.getUTCDay();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Crypto is continuously tradeable from a market-hours perspective; execution still
  // depends on fresh provider data and risk gates.
  const cryptoSession: MarketSession = {
    id: "CRYPTO_24_7",
    name: "Crypto Continuous",
    category: "CRYPTO",
    timezone: "UTC",
    isOpen: true,
    statusLabel: "OPEN",
    currentSessionProgress: sessionProgress(utcMinutes, 0, 1440),
    nextTransitionLabel: "Daily clock rollover",
    nextTransitionTime: `in ${formatDuration(1440 - utcMinutes)}`,
    hoursDisplay: "24/7 market availability",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  };

  const isUsWeekday = us.dayIndex >= 1 && us.dayIndex <= 5;
  const usOpenMinutes = 9 * 60 + 30;
  const usCloseMinutes = 16 * 60;
  const usPreStart = 4 * 60;
  const usPostEnd = 20 * 60;

  let usStatus: MarketSession["statusLabel"] = "CLOSED";
  let usOpen = false;
  let usProgress = 0;
  let usNextTrans = "Next regular session";
  let usNextTime = "09:30 ET";

  if (!isUsWeekday) {
    usStatus = "WEEKEND";
    usNextTrans = "Next regular session";
    usNextTime = "Monday 09:30 ET";
  } else if (us.minutes >= usOpenMinutes && us.minutes < usCloseMinutes) {
    usStatus = "OPEN";
    usOpen = true;
    usProgress = sessionProgress(us.minutes, usOpenMinutes, usCloseMinutes);
    usNextTrans = "Regular close";
    usNextTime = `in ${formatDuration(usCloseMinutes - us.minutes)}`;
  } else if (us.minutes >= usPreStart && us.minutes < usOpenMinutes) {
    usStatus = "PRE_MARKET";
    usNextTrans = "Regular open";
    usNextTime = `in ${formatDuration(usOpenMinutes - us.minutes)}`;
  } else if (us.minutes >= usCloseMinutes && us.minutes < usPostEnd) {
    usStatus = "POST_MARKET";
    usNextTrans = "Extended-hours window ends";
    usNextTime = `in ${formatDuration(usPostEnd - us.minutes)}`;
  }

  const usStocksSession: MarketSession = {
    id: "US_EQUITIES",
    name: "US Equities (NYSE / NASDAQ)",
    category: "STOCK",
    timezone: "America/New_York",
    isOpen: usOpen,
    statusLabel: usStatus,
    currentSessionProgress: usProgress,
    nextTransitionLabel: usNextTrans,
    nextTransitionTime: usNextTime,
    hoursDisplay: "Mon-Fri 09:30-16:00 ET",
    badgeColor: usOpen
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : usStatus === "PRE_MARKET" || usStatus === "POST_MARKET"
      ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  // FX spot market is typically active from Sunday 21:00 UTC through Friday 21:00 UTC;
  // broker/liquidity-provider schedules can differ around holidays and maintenance.
  const forexOpen = !(
    utcDay === 6 ||
    (utcDay === 5 && utcMinutes >= 21 * 60) ||
    (utcDay === 0 && utcMinutes < 21 * 60)
  );
  const forexSession: MarketSession = {
    id: "FOREX_24_5",
    name: "Global FX",
    category: "FOREX",
    timezone: "UTC",
    isOpen: forexOpen,
    statusLabel: forexOpen ? "OPEN" : "WEEKEND",
    currentSessionProgress: forexOpen ? 50 : 0,
    nextTransitionLabel: forexOpen ? "Continuous session" : "Next weekly open",
    nextTransitionTime: forexOpen ? "Active" : "Sunday 21:00 UTC",
    hoursDisplay: "Generally Sun 21:00-Fri 21:00 UTC",
    badgeColor: forexOpen
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  const londonOpenMinutes = 8 * 60;
  const londonCloseMinutes = 16 * 60 + 30;
  const londonWeekday = london.dayIndex >= 1 && london.dayIndex <= 5;
  const isLondonOpen = londonWeekday && london.minutes >= londonOpenMinutes && london.minutes < londonCloseMinutes;
  const londonSession: MarketSession = {
    id: "LONDON_SESSION",
    name: "London (LSE / Europe)",
    category: "STOCK",
    timezone: "Europe/London",
    isOpen: isLondonOpen,
    statusLabel: isLondonOpen ? "OPEN" : !londonWeekday ? "WEEKEND" : "CLOSED",
    currentSessionProgress: isLondonOpen ? sessionProgress(london.minutes, londonOpenMinutes, londonCloseMinutes) : 0,
    nextTransitionLabel: isLondonOpen ? "Regular close" : "Next regular session",
    nextTransitionTime: isLondonOpen ? `in ${formatDuration(londonCloseMinutes - london.minutes)}` : "08:00 local",
    hoursDisplay: "Mon-Fri 08:00-16:30 local",
    badgeColor: isLondonOpen
      ? "text-sky-400 bg-sky-500/10 border-sky-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  const tokyoOpenMinutes = 9 * 60;
  const tokyoCloseMinutes = 15 * 60;
  const tokyoWeekday = tokyo.dayIndex >= 1 && tokyo.dayIndex <= 5;
  const isTokyoOpen = tokyoWeekday && tokyo.minutes >= tokyoOpenMinutes && tokyo.minutes < tokyoCloseMinutes;
  const tokyoSession: MarketSession = {
    id: "TOKYO_SESSION",
    name: "Tokyo (TSE / Asia)",
    category: "STOCK",
    timezone: "Asia/Tokyo",
    isOpen: isTokyoOpen,
    statusLabel: isTokyoOpen ? "OPEN" : !tokyoWeekday ? "WEEKEND" : "CLOSED",
    currentSessionProgress: isTokyoOpen ? sessionProgress(tokyo.minutes, tokyoOpenMinutes, tokyoCloseMinutes) : 0,
    nextTransitionLabel: isTokyoOpen ? "Regular close" : "Next regular session",
    nextTransitionTime: isTokyoOpen ? `in ${formatDuration(tokyoCloseMinutes - tokyo.minutes)}` : "09:00 local",
    hoursDisplay: "Mon-Fri 09:00-15:00 local",
    badgeColor: isTokyoOpen
      ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/30"
      : "text-neutral-400 bg-neutral-900 border-neutral-800",
  };

  const sessions = [cryptoSession, usStocksSession, forexSession, londonSession, tokyoSession];
  const activeCount = sessions.filter((s) => s.isOpen).length;

  let recommendation: string;
  if (usOpen) {
    recommendation = "US regular session is open. Use the provider's current bid/ask and liquidity data; session status alone is never an entry signal.";
  } else if (forexOpen && isLondonOpen) {
    recommendation = "London session is open. Session clocks are informational; trade eligibility still requires fresh data and strategy/risk approval.";
  } else if (isTokyoOpen) {
    recommendation = "Tokyo session is open. Session clocks are informational; trade eligibility still requires fresh data and strategy/risk approval.";
  } else if (utcDay === 0 || utcDay === 6) {
    recommendation = "Weekend: traditional equity sessions are closed. Crypto remains open, but Jarvis does not auto-route capital solely because another market is closed.";
  } else {
    recommendation = "No highlighted regular session is open. Jarvis should wait for fresh data and a qualified setup rather than trade because the clock says a session is active.";
  }

  return {
    nowUtc: now,
    activeSessionCount: activeCount,
    cryptoOpen: true,
    forexOpen,
    usStocksOpen: usOpen,
    asianSessionOpen: isTokyoOpen,
    londonSessionOpen: isLondonOpen,
    nySessionOpen: usOpen,
    recommendation,
    sessions,
  };
}

export function isUsRegularMarketOpen(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const minutes =
    Number(parts.find((p) => p.type === "hour")?.value || 0) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value || 0);
  return dayIndex >= 1 && dayIndex <= 5 && minutes >= 570 && minutes < 960;
}

// This clock intentionally models regular weekday session hours only.
// Exchange-specific holiday and early-close calendars should be supplied by the
// authoritative market-data provider before real-money execution is enabled.
