import React, { useState } from "react";
import { Shield, Lock, Unlock, AlertTriangle, KeyRound } from "lucide-react";
import { cryptoSecurityService } from "../utils/cryptoSecurity";
import { systemNotificationService } from "../utils/systemNotifications";

interface SecurityPinLockScreenProps {
  onUnlock: () => void;
}

export const SecurityPinLockScreen: React.FC<SecurityPinLockScreenProps> = ({ onUnlock }) => {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleDigit = (digit: string) => {
    if (pin.length < 6) {
      const nextPin = pin + digit;
      setPin(nextPin);
      setErrorMsg(null);
      systemNotificationService.triggerHaptic("LIGHT");

      if (nextPin.length === 6) {
        checkPin(nextPin);
      }
    }
  };

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
    systemNotificationService.triggerHaptic("LIGHT");
  };

  const handleClear = () => {
    setPin("");
    setErrorMsg(null);
  };

  const checkPin = async (candidatePin: string) => {
    setIsVerifying(true);
    try {
      const isValid = await cryptoSecurityService.verifyPin(candidatePin);
      if (isValid) {
        systemNotificationService.triggerHaptic("SUCCESS");
        onUnlock();
      } else {
        systemNotificationService.triggerHaptic("DANGER");
        setErrorMsg("Incorrect Security PIN. Access denied.");
        setPin("");
      }
    } catch (e) {
      setErrorMsg("Decryption error. Please try again.");
      setPin("");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      id="security-pin-lock-overlay"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 bg-neutral-950/95 backdrop-blur-md select-none"
    >
      <div className="w-full max-w-xs flex flex-col items-center gap-6">
        {/* Shield Icon Header */}
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <Lock className="w-8 h-8 text-emerald-400 animate-pulse" />
          </div>
          <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-neutral-900 border border-neutral-700 text-amber-400">
            <Shield className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Text Prompt */}
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold font-mono text-white tracking-wide">
            Jarvis Local Session Lock
          </h2>
          <p className="text-xs text-neutral-400 font-sans">
            Enter your six-digit PIN to unlock the local paper-trading session
          </p>
        </div>

        {/* PIN Indicators */}
        <div className="flex items-center gap-3">
          {[0, 1, 2, 3, 4, 5].map((idx) => {
            const isFilled = pin.length > idx;
            return (
              <div
                key={idx}
                className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                  isFilled
                    ? "bg-emerald-400 scale-125 shadow-md shadow-emerald-400/50"
                    : "bg-neutral-800 border border-neutral-700"
                }`}
              />
            );
          })}
        </div>

        {/* Error Feedback */}
        {errorMsg && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono animate-bounce">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Numeric Keypad for Mobile & Touch */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigit(num)}
              disabled={isVerifying}
              className="h-14 rounded-2xl bg-neutral-900/90 hover:bg-neutral-800 active:bg-emerald-500/20 border border-neutral-800 text-lg font-bold font-mono text-white transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center"
            >
              {num}
            </button>
          ))}

          <button
            type="button"
            onClick={handleClear}
            className="h-14 rounded-2xl bg-neutral-900/50 hover:bg-neutral-800 border border-neutral-800/80 text-xs font-mono text-neutral-400 transition-colors flex items-center justify-center active:scale-95 cursor-pointer"
          >
            CLEAR
          </button>

          <button
            type="button"
            onClick={() => handleDigit("0")}
            disabled={isVerifying}
            className="h-14 rounded-2xl bg-neutral-900/90 hover:bg-neutral-800 active:bg-emerald-500/20 border border-neutral-800 text-lg font-bold font-mono text-white transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center"
          >
            0
          </button>

          <button
            type="button"
            onClick={handleDelete}
            className="h-14 rounded-2xl bg-neutral-900/50 hover:bg-neutral-800 border border-neutral-800/80 text-xs font-mono text-neutral-400 transition-colors flex items-center justify-center active:scale-95 cursor-pointer"
          >
            DEL
          </button>
        </div>

        {/* Footer Note */}
        <div className="text-[11px] text-neutral-500 font-mono text-center flex items-center gap-1.5">
          <KeyRound className="w-3 h-3 text-emerald-400" />
          <span>Web Crypto protected local session lock; not brokerage key custody</span>
        </div>
      </div>
    </div>
  );
};
