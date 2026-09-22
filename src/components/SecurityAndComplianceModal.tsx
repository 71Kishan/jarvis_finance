import React, { useState, useEffect } from "react";
import {
  Shield,
  Lock,
  Unlock,
  KeyRound,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Scale,
  Database,
  Cpu,
  RefreshCw,
  X,
  ExternalLink,
  Sliders,
  EyeOff,
  Zap,
  Check,
} from "lucide-react";
import { cryptoSecurityService, CryptographicTradeBlock } from "../utils/cryptoSecurity";
import { systemNotificationService } from "../utils/systemNotifications";

interface SecurityAndComplianceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionLocked?: () => void;
  onExportAuditLedger?: () => void;
}

type TabType = "LEGAL" | "RISK_EXPERT" | "SECURITY_VAULT";

export const SecurityAndComplianceModal: React.FC<SecurityAndComplianceModalProps> = ({
  isOpen,
  onClose,
  onSessionLocked,
  onExportAuditLedger,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("LEGAL");
  const [termsAcknowledged, setTermsAcknowledged] = useState(() =>
    cryptoSecurityService.isLegalTermsAcknowledged()
  );
  const [pinConfigured, setPinConfigured] = useState(() =>
    cryptoSecurityService.isPinConfigured()
  );
  const [autoLockMin, setAutoLockMin] = useState(() =>
    cryptoSecurityService.getAutoLockMinutes()
  );
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinFeedback, setPinFeedback] = useState<string | null>(null);

  // Cryptographic Ledger Verification State
  const [ledger, setLedger] = useState<CryptographicTradeBlock[]>([]);
  const [isVerifyingLedger, setIsVerifyingLedger] = useState(false);
  const [ledgerVerificationResult, setLedgerVerificationResult] = useState<{
    isValid: boolean;
    tamperedIndex: number | null;
    verifiedCount: number;
  } | null>(null);

  // Trading Expert Risk Defense Controls
  const [slippageFilterActive, setSlippageFilterActive] = useState(true);
  const [atrSpikeFilterActive, setAtrSpikeFilterActive] = useState(true);
  const [maxDailyLossActive, setMaxDailyLossActive] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setLedger(cryptoSecurityService.getLedger());
      setTermsAcknowledged(cryptoSecurityService.isLegalTermsAcknowledged());
      setPinConfigured(cryptoSecurityService.isPinConfigured());
      setAutoLockMin(cryptoSecurityService.getAutoLockMinutes());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAcknowledgeTerms = () => {
    cryptoSecurityService.acknowledgeLegalTerms();
    setTermsAcknowledged(true);
    systemNotificationService.triggerHaptic("SUCCESS");
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 4) {
      setPinFeedback("PIN must be exactly 6 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setPinFeedback("PIN numbers do not match.");
      return;
    }
    await cryptoSecurityService.setPin(newPin);
    setPinConfigured(true);
    setNewPin("");
    setConfirmPin("");
    setPinFeedback("Six-digit local session PIN set successfully. This protects the app session; it is not brokerage key custody.");
    systemNotificationService.triggerHaptic("SUCCESS");
  };

  const handleRemovePin = () => {
    cryptoSecurityService.removePin();
    setPinConfigured(false);
    setPinFeedback("PIN lock disabled.");
    systemNotificationService.triggerHaptic("WARNING");
  };

  const handleAutoLockChange = (min: number) => {
    setAutoLockMin(min);
    cryptoSecurityService.setAutoLockMinutes(min);
  };

  const handleLockNow = () => {
    cryptoSecurityService.lockSession();
    onClose();
    if (onSessionLocked) onSessionLocked();
  };

  const handleVerifyLedger = async () => {
    setIsVerifyingLedger(true);
    try {
      const res = await cryptoSecurityService.verifyLedgerIntegrity();
      setLedgerVerificationResult(res);
      systemNotificationService.triggerHaptic(res.isValid ? "SUCCESS" : "DANGER");
    } finally {
      setIsVerifyingLedger(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        id="security-compliance-modal"
        className="relative w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-800/80 bg-neutral-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold font-mono text-white flex items-center gap-2">
                Security Vault, Legal Disclosures & Quant Defense
              </h2>
              <p className="text-xs text-neutral-400 font-sans">
                Local session security, audit checks, risk controls, and key-handling guidance
              </p>
            </div>
          </div>

          <button
            id="close-security-modal-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-neutral-800 bg-neutral-900/40 text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveTab("LEGAL")}
            className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === "LEGAL"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>1. Legal & Regulatory Disclosures</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("RISK_EXPERT")}
            className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === "RISK_EXPERT"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>2. Quant Risk & Audit Ledger</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("SECURITY_VAULT")}
            className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === "SECURITY_VAULT"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>3. Cybersecurity & Encryption</span>
          </button>
        </div>

        {/* Scrollable Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* TAB 1: FINANCIAL LAWYER */}
          {activeTab === "LEGAL" && (
            <div className="space-y-4">
              {/* Statutory CFTC 4.41 Box */}
              <div className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-mono font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>SIMULATED PERFORMANCE DISCLOSURE</span>
                </div>
                <div className="text-neutral-300 text-xs leading-relaxed space-y-2 font-sans">
                  <p>
                    <strong>HYPOTHETICAL OR SIMULATED PERFORMANCE RESULTS HAVE CERTAIN INHERENT LIMITATIONS:</strong>{" "}
                    Unlike an actual performance record, simulated results do not represent actual trading. Also, since the trades have not actually been executed, the results may have under- or over-compensated for the impact, if any, of certain market factors, such as lack of liquidity.
                  </p>
                  <p>
                    Simulated trading programs in general are also subject to the fact that they are designed with the benefit of hindsight. No representation is being made that any account will or is likely to achieve profits or losses similar to those shown.
                  </p>
                </div>
              </div>

              {/* SEC, FINRA & Non-Custodial Software Notice */}
              <div className="p-4 rounded-xl bg-neutral-900/50 border border-neutral-800/80 space-y-2">
                <h4 className="text-xs font-mono font-bold text-white flex items-center gap-2">
                  <Scale className="w-4 h-4 text-emerald-400" />
                  RESEARCH & PAPER-TRADING SOFTWARE
                </h4>
                <p className="text-neutral-400 text-xs leading-relaxed font-sans">
                  This build is a research and paper-trading application. It is not connected to a broker, does not custody funds, and does not place real-money orders. Paper results and backtests are hypothetical and can differ materially from live execution because of costs, liquidity, gaps, data quality, and model assumptions.
                </p>
              </div>

              {/* LOCAL DATA & PRIVACY NOTES */}
              <div className="p-4 rounded-xl bg-neutral-900/50 border border-neutral-800/80 space-y-2">
                <h4 className="text-xs font-mono font-bold text-white flex items-center gap-2">
                  <EyeOff className="w-4 h-4 text-sky-400" />
                  LOCAL DATA & PRIVACY NOTES
                </h4>
                <div className="text-neutral-400 text-xs leading-relaxed space-y-1.5 font-sans">
                  <p>
                    &bull; <strong>Local-First Paper State:</strong> Current paper state is primarily client-side. Cross-device synchronization requires a server-side journal, which is not yet enabled.
                  </p>
                  <p>
                    &bull; <strong>Local-first state:</strong> The current paper journal and security settings are primarily stored on the device. A durable cross-device journal is not enabled in this build.
                  </p>
                  <p>
                    &bull; <strong>Data clearing:</strong> Local application data can be cleared from the app settings. Local storage is not an immutable audit system or a custody layer.
                  </p>
                </div>
              </div>

              {/* Legal Acknowledgment Checkpoint */}
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-mono font-bold text-white">
                      Risk of Capital Loss & Terms of Service
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      {termsAcknowledged
                        ? "Acknowledged & Electronically Stored on Local Device"
                        : "Please review and acknowledge legal disclosures"}
                    </div>
                  </div>
                </div>

                {!termsAcknowledged ? (
                  <button
                    type="button"
                    onClick={handleAcknowledgeTerms}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-xs transition-colors shadow-sm cursor-pointer"
                  >
                    I Acknowledge & Accept Terms
                  </button>
                ) : (
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> ACKNOWLEDGED
                  </span>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: TRADING EXPERT (QUANT RISK & AUDIT LEDGER) */}
          {activeTab === "RISK_EXPERT" && (
            <div className="space-y-4">
              {/* Defense Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      Slippage & Spread Guard
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-tight">
                      Rejects fills if market spread &gt; 0.10% to prevent execution drag.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSlippageFilterActive(!slippageFilterActive)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                      slippageFilterActive
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {slippageFilterActive ? "ACTIVE" : "DISABLED"}
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                      ATR Volatility Spike Halt
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-tight">
                      Auto-pauses new orders if 14-period ATR spikes &gt; 2.5x normal baseline.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAtrSpikeFilterActive(!atrSpikeFilterActive)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                      atrSpikeFilterActive
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {atrSpikeFilterActive ? "ACTIVE" : "DISABLED"}
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-sky-400" />
                      Daily Drawdown Lock
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-tight">
                      Hard stop liquidation if daily drawdown reaches circuit breaker threshold.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMaxDailyLossActive(!maxDailyLossActive)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                      maxDailyLossActive
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {maxDailyLossActive ? "ACTIVE" : "DISABLED"}
                  </button>
                </div>
              </div>

              {/* Cryptographic Trade Audit Ledger (SHA-256 Provenance) */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-mono font-bold text-white flex items-center gap-2">
                      <Database className="w-4 h-4 text-emerald-400" />
                      Cryptographic Trade Audit Ledger (SHA-256 Provenance)
                    </h4>
                    <p className="text-[11px] text-neutral-400">
                      Trade records can be hashed for local integrity checks. A local hash is not a tamper-proof external ledger or custody record.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleVerifyLedger}
                    disabled={isVerifyingLedger}
                    className="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-emerald-400 border border-neutral-700 font-mono text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingLedger ? "animate-spin" : ""}`} />
                    <span>Verify Block Integrity</span>
                  </button>
                </div>

                {/* Verification Result Banner */}
                {ledgerVerificationResult && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-mono flex items-center gap-2 ${
                      ledgerVerificationResult.isValid
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                    }`}
                  >
                    {ledgerVerificationResult.isValid ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>
                          LOCAL HASH CHECK: {ledgerVerificationResult.verifiedCount} stored records passed the current client-side hash check. This is not an external audit.
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          TAMPER DETECTED at block #{ledgerVerificationResult.tamperedIndex}! Data modification detected outside trading engine.
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Ledger Blocks Table */}
                <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-800/80 bg-neutral-950 font-mono text-[11px]">
                  {ledger.length === 0 ? (
                    <div className="p-4 text-center text-neutral-500">
                      No closed trades in audit ledger yet. Open and close a trade to generate block #0.
                    </div>
                  ) : (
                    <table className="w-full text-left">
                      <thead className="bg-neutral-900/80 text-neutral-400 text-[10px] uppercase border-b border-neutral-800">
                        <tr>
                          <th className="p-2">Block</th>
                          <th className="p-2">Asset</th>
                          <th className="p-2">Type</th>
                          <th className="p-2">PnL</th>
                          <th className="p-2">SHA-256 Hash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-900 text-neutral-300">
                        {ledger.map((b) => (
                          <tr key={b.blockIndex} className="hover:bg-neutral-900/40">
                            <td className="p-2 text-neutral-400">#{b.blockIndex}</td>
                            <td className="p-2 font-bold text-white">{b.asset}</td>
                            <td className="p-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                  b.type === "LONG"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : "bg-rose-500/10 text-rose-400"
                                }`}
                              >
                                {b.type}
                              </span>
                            </td>
                            <td className="p-2 font-bold">
                              <span className={b.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                {b.pnl >= 0 ? "+" : ""}${b.pnl.toFixed(2)}
                              </span>
                            </td>
                            <td className="p-2 text-neutral-500 font-mono text-[10px]">
                              {b.blockHash.slice(0, 16)}...
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CYBERSECURITY ARCHITECT (ENCRYPTION & MOBILE PIN LOCK) */}
          {activeTab === "SECURITY_VAULT" && (
            <div className="space-y-4">
              {/* Web Crypto AES-256 Card */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold text-white">
                      AES-256-GCM Native Web Crypto Engine
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    HARDWARE ACCELERATED
                  </span>
                </div>
                <p className="text-neutral-400 text-xs font-sans leading-relaxed">
                  Keys are derived using <strong>PBKDF2 with 100,000 SHA-256 iterations</strong> and unique random 128-bit salts. Encrypted payloads use Galois/Counter Mode (GCM) for authenticated cipher integrity.
                </p>
              </div>

              {/* Physical Security PIN Lock Configuration */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-mono font-bold text-white flex items-center gap-2">
                      <Lock className="w-4 h-4 text-amber-400" />
                      Mobile & Desktop Security PIN Lock
                    </h4>
                    <p className="text-[11px] text-neutral-400">
                      Protects your terminal from unauthorized physical access if your Android phone or device is unlocked.
                    </p>
                  </div>

                  {pinConfigured && (
                    <button
                      type="button"
                      onClick={handleLockNow}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-mono font-bold transition-colors cursor-pointer"
                    >
                      Lock Terminal Now
                    </button>
                  )}
                </div>

                {!pinConfigured ? (
                  <form onSubmit={handleSavePin} className="space-y-3 pt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[11px] font-mono text-neutral-400 block mb-1">
                          Enter 4-Digit Security PIN
                        </label>
                        <input
                          type="password"
                          maxLength={6}
                          value={newPin}
                          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                          placeholder="e.g. 8492"
                          className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-white font-mono text-sm focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-mono text-neutral-400 block mb-1">
                          Confirm PIN
                        </label>
                        <input
                          type="password"
                          maxLength={6}
                          value={confirmPin}
                          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                          placeholder="Repeat PIN"
                          className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-white font-mono text-sm focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-xs transition-colors cursor-pointer"
                    >
                      Enable Security PIN
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between pt-2">
                    <div className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Security PIN Active & Session Guarded</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleRemovePin}
                      className="text-xs font-mono text-neutral-400 hover:text-rose-400 transition-colors"
                    >
                      Remove PIN
                    </button>
                  </div>
                )}

                {pinFeedback && (
                  <div className="text-xs font-mono text-neutral-300 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                    {pinFeedback}
                  </div>
                )}
              </div>

              {/* Auto-Lock Inactivity Timer */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="text-xs font-mono font-bold text-white">
                  Session Auto-Lock Inactivity Timeout
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  {[5, 15, 30, 0].map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => handleAutoLockChange(min)}
                      className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                        autoLockMin === min
                          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 font-bold"
                          : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white"
                      }`}
                    >
                      {min === 0 ? "Disabled" : `${min} Minutes`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Server-Side Defense Layer Info */}
              <div className="p-4 rounded-xl bg-neutral-900/40 border border-neutral-800/80 space-y-1.5 text-xs font-mono text-neutral-400">
                <div className="text-white font-bold mb-1 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Active Server Infrastructure Defense
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>HTTP Strict Header Defense (nosniff, XSS)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>In-Memory 150 req/min DDoS Shield</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>250KB JSON Payload Buffer Overflow Guard</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Broker/API credentials remain server-side; this client is not a credential vault.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-neutral-800 bg-neutral-900/50 flex items-center justify-between text-xs font-mono text-neutral-400">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>Security Controls & Local Audit Integrity</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-mono text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
