import React, { useState } from "react";
import { ActionNotification } from "../types/trading";
import {
  Bell,
  CheckCheck,
  Trash2,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Zap,
  Info,
  ExternalLink,
  ChevronDown,
} from "lucide-react";

interface NotificationCenterProps {
  notifications: ActionNotification[];
  onMarkAllRead: () => void;
  onClear: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onMarkAllRead,
  onClear,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "TRADES" | "RISK">("ALL");

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filtered = notifications.filter((n) => {
    if (filter === "ALL") return true;
    if (filter === "TRADES") {
      return ["TRADE_OPENED", "TAKE_PROFIT", "STOP_LOSS", "MANUAL_CLOSE"].includes(n.type);
    }
    if (filter === "RISK") {
      return ["RISK_ALERT", "CIRCUIT_BREAKER", "STRATEGY_LEARNED"].includes(n.type);
    }
    return true;
  });

  const getIcon = (type: ActionNotification["type"]) => {
    switch (type) {
      case "TRADE_OPENED":
        return <Zap className="w-4 h-4 text-sky-400" />;
      case "TAKE_PROFIT":
        return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case "STOP_LOSS":
      case "MANUAL_CLOSE":
        return <TrendingDown className="w-4 h-4 text-rose-400" />;
      case "CIRCUIT_BREAKER":
        return <ShieldAlert className="w-4 h-4 text-rose-500 animate-pulse" />;
      case "RISK_ALERT":
        return <ShieldAlert className="w-4 h-4 text-amber-400" />;
      default:
        return <Info className="w-4 h-4 text-indigo-400" />;
    }
  };

  const getBadgeColor = (type: ActionNotification["type"]) => {
    switch (type) {
      case "TAKE_PROFIT":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "STOP_LOSS":
      case "CIRCUIT_BREAKER":
        return "bg-rose-500/10 text-rose-400 border-rose-500/30";
      case "TRADE_OPENED":
        return "bg-sky-500/10 text-sky-400 border-sky-500/30";
      default:
        return "bg-neutral-800 text-neutral-300 border-neutral-700";
    }
  };

  return (
    <div className="relative inline-block text-left" id="notification-center-dropdown">
      {/* Trigger Button */}
      <button
        id="notification-bell-btn"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 transition-all font-mono text-xs cursor-pointer"
        title="Live System Notifications & Action Logs"
      >
        <Bell className="w-4 h-4" />
        <span className="hidden sm:inline">Alerts</span>
        {unreadCount > 0 && (
          <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-black text-[10px] font-bold font-mono animate-bounce">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          id="notification-popover"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-neutral-950/95 border border-neutral-800 rounded-2xl shadow-2xl z-50 backdrop-blur-md overflow-hidden flex flex-col max-h-[480px]"
        >
          {/* Header */}
          <div className="p-3.5 border-b border-neutral-800/80 flex items-center justify-between bg-neutral-900/50">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold font-mono text-white uppercase tracking-wider">
                Action Notifications
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
                {notifications.length} Total
              </span>
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  id="mark-all-read-btn"
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-neutral-400 hover:text-emerald-400 p-1 transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  id="clear-all-notif-btn"
                  type="button"
                  onClick={onClear}
                  className="text-neutral-400 hover:text-rose-400 p-1 transition-colors"
                  title="Clear history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-neutral-800/50 bg-neutral-900/30 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setFilter("ALL")}
              className={`px-2 py-0.5 rounded ${
                filter === "ALL" ? "bg-neutral-800 text-white font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("TRADES")}
              className={`px-2 py-0.5 rounded ${
                filter === "TRADES" ? "bg-neutral-800 text-sky-300 font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Fills & PnL
            </button>
            <button
              type="button"
              onClick={() => setFilter("RISK")}
              className={`px-2 py-0.5 rounded ${
                filter === "RISK" ? "bg-neutral-800 text-amber-300 font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Risk & Safety
            </button>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto divide-y divide-neutral-900 p-1">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-xs font-mono text-neutral-500">
                No notifications logged yet. Actions will show up here in real time.
              </div>
            ) : (
              filtered.map((item) => {
                const timeString = new Date(item.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl transition-all flex items-start gap-2.5 hover:bg-neutral-900/60 ${
                      !item.read ? "bg-neutral-900/30 border-l-2 border-emerald-500" : ""
                    }`}
                  >
                    <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 shrink-0 mt-0.5">
                      {getIcon(item.type)}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-0.5 font-sans">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-neutral-200 truncate">
                          {item.title}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-500 shrink-0">
                          {timeString}
                        </span>
                      </div>

                      <p className="text-[11px] text-neutral-400 leading-snug break-words">
                        {item.message}
                      </p>

                      {item.badgeText && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <span
                            className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${getBadgeColor(
                              item.type
                            )}`}
                          >
                            {item.badgeText}
                          </span>
                          {item.details?.price && (
                            <span className="text-[10px] font-mono text-neutral-400">
                              @ ${item.details.price.toLocaleString()}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-neutral-900 bg-neutral-950 text-center">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[11px] font-mono text-neutral-400 hover:text-white"
            >
              Close Notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
