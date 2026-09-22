import React, { useState, useEffect } from "react";
import {
  Globe,
  Clock,
  Smartphone,
  Bell,
  CheckCircle2,
  AlertCircle,
  Wifi,
  Sparkles,
  ShieldCheck,
  Zap,
  Volume2,
  ChevronRight,
  ExternalLink,
  X,
  Share2,
  BatteryCharging,
} from "lucide-react";
import { getGlobalMarketSchedule, MarketHoursSchedule } from "../utils/marketHours";
import { systemNotificationService, NotificationPermissionState } from "../utils/systemNotifications";

interface MarketHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoRotateAssets: boolean;
  onToggleAutoRotate: () => void;
}

export const MarketHoursModal: React.FC<MarketHoursModalProps> = ({
  isOpen,
  onClose,
  autoRotateAssets,
  onToggleAutoRotate,
}) => {
  const [schedule, setSchedule] = useState<MarketHoursSchedule>(() => getGlobalMarketSchedule());
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    systemNotificationService.getPermission()
  );
  const [testNotificationSent, setTestNotificationSent] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setSchedule(getGlobalMarketSchedule());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestNotifications = async () => {
    const res = await systemNotificationService.requestPermission();
    setPermission(res);
    if (res === "granted") {
      systemNotificationService.notify("Jarvis Finance Connected", {
        body: "Real-time alerts are available when the server and notification channel are connected.",
        vibrate: [60, 40, 60],
      });
      setTestNotificationSent(true);
      setTimeout(() => setTestNotificationSent(false), 5000);
    }
  };

  const handleTestAlert = () => {
    systemNotificationService.notify("BTC/USD Limit Filled: +$142.50", {
      body: "Jarvis Finance event notification: verify the actual trade record and market data before acting.",
      vibrate: [60, 60, 80],
    });
    systemNotificationService.triggerHaptic("SUCCESS");
    setTestNotificationSent(true);
    setTimeout(() => setTestNotificationSent(false), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        id="market-hours-modal"
        className="relative w-full max-w-2xl bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-800/80 bg-neutral-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold font-mono text-white flex items-center gap-2">
                Market Sessions & Runtime Architecture
              </h2>
              <p className="text-xs text-neutral-400 font-sans">
                Global exchange schedules, push notifications, and background operation guide
              </p>
            </div>
          </div>

          <button
            id="close-market-hours-modal-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 divide-y divide-neutral-900">
          {/* Section 1: Android & Phone Monitoring */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase text-neutral-300 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                How To Keep It Running Automatically on Android
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                PWA Ready
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-sans">
              <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-emerald-400 font-mono font-bold text-[11px]">
                  <Share2 className="w-3.5 h-3.5" />
                  <span>1. Install to Home Screen</span>
                </div>
                <p className="text-neutral-400 text-[11px] leading-relaxed">
                  Open Chrome on Android, tap the <strong>⋮ (three dots)</strong> menu, and select <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong>. It runs full-screen as a standalone native app.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-sky-400 font-mono font-bold text-[11px]">
                  <BatteryCharging className="w-3.5 h-3.5" />
                  <span>2. Unrestricted Battery</span>
                </div>
                <p className="text-neutral-400 text-[11px] leading-relaxed">
                  In Android App Settings &rarr; Battery, change to <strong>"Unrestricted"</strong> so the operating system doesn't pause the background tab when your screen is locked.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-purple-400 font-mono font-bold text-[11px]">
                  <Bell className="w-3.5 h-3.5" />
                  <span>3. Enable Push Alerts</span>
                </div>
                <p className="text-neutral-400 text-[11px] leading-relaxed">
                  Allow browser notifications below so you receive vibrating lock-screen popups whenever trades open, reach TP/SL, or trigger risk breakers.
                </p>
              </div>
            </div>

            {/* Notification Permission Card */}
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-950 border border-neutral-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-neutral-800 text-neutral-300">
                  <Bell className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white font-mono flex items-center gap-2">
                    System Push Notifications & Haptics
                    {permission === "granted" ? (
                      <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> ENABLED
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-400 font-mono">
                        PERMISSION NEEDED
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    Receive push alerts for supported events. The phone is a monitoring/control surface; it is not a reliable server-side execution worker.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {permission !== "granted" ? (
                  <button
                    id="enable-phone-notifications-btn"
                    type="button"
                    onClick={handleRequestNotifications}
                    className="w-full sm:w-auto px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-xs transition-all shadow-md cursor-pointer"
                  >
                    Enable Notifications
                  </button>
                ) : (
                  <button
                    id="test-phone-notification-btn"
                    type="button"
                    onClick={handleTestAlert}
                    className="w-full sm:w-auto px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 font-mono text-xs transition-colors cursor-pointer"
                  >
                    {testNotificationSent ? "Alert Sent!" : "Test Alert"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Global Financial Market Sessions */}
          <div className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase text-neutral-300 flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" />
                Live Global Market Clock & Exchange Status
              </span>
              <span className="text-[10px] font-mono text-neutral-400">
                UTC {schedule.nowUtc.toUTCString().slice(17, 25)}
              </span>
            </div>

            {/* Smart Strategy Recommendation Banner */}
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800/80 flex items-center gap-2.5 text-xs font-mono text-neutral-300">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{schedule.recommendation}</span>
            </div>

            {/* Market Session Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {schedule.sessions.map((sess) => (
                <div
                  key={sess.id}
                  className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-2 font-mono"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">{sess.name}</span>
                    </div>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${sess.badgeColor}`}
                    >
                      {sess.statusLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span>{sess.hoursDisplay}</span>
                    <span className="text-neutral-300">
                      {sess.nextTransitionLabel}: <strong>{sess.nextTransitionTime}</strong>
                    </span>
                  </div>

                  {/* Progress bar */}
                  {sess.isOpen && sess.currentSessionProgress > 0 && (
                    <div className="w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${sess.currentSessionProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Server-Side Runtime & Asset Scheduling */}
          <div className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono font-bold text-white uppercase flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  Server Runtime & Research Scheduling
                </div>
                <p className="text-[11px] text-neutral-400">
                  A server-side scheduler may change the research universe across market sessions. Do not treat weekend crypto rotation as a promise of continuous profitability or unattended Android execution.
                </p>
              </div>
              <span className="px-3 py-1.5 rounded-xl font-mono text-xs font-bold bg-neutral-800 text-neutral-400 border border-neutral-700">
                SERVER SCHEDULER NOT CONNECTED
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-neutral-800 bg-neutral-900/50 flex items-center justify-between text-xs font-mono text-neutral-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Paper Research Mode: Online</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-mono text-xs transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
