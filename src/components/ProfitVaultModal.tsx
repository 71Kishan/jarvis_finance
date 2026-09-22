import React, { useState } from "react";
import {
  Vault,
  ShieldCheck,
  ArrowDownRight,
  ArrowUpRight,
  Lock,
  Download,
  CheckCircle2,
  RefreshCw,
  Coins,
  History,
  Info,
  Sliders,
  X,
  FileCheck2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { BotVitality, ProfitWithdrawalRecord } from "../types/trading";
import { TradingEngine } from "../engine/tradingEngine";

interface ProfitVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  engine: TradingEngine;
  vitality: BotVitality;
}

export const ProfitVaultModal: React.FC<ProfitVaultModalProps> = ({
  isOpen,
  onClose,
  engine,
  vitality,
}) => {
  const [activeTab, setActiveTab] = useState<"LEDGER" | "SETTINGS" | "MANUAL">("LEDGER");
  const [withdrawPct, setWithdrawPct] = useState<number>(vitality.withdrawPercentage || 50);
  const [autoEnabled, setAutoEnabled] = useState<boolean>(vitality.autoWithdrawProfitEnabled ?? true);
  const [minThreshold, setMinThreshold] = useState<number>(vitality.minProfitThresholdUsd || 5.0);
  const [manualAmount, setManualAmount] = useState<string>("50");
  const [manualMemo, setManualMemo] = useState<string>("");
  const [transferBackAmount, setTransferBackAmount] = useState<string>("50");
  const [selectedReceipt, setSelectedReceipt] = useState<ProfitWithdrawalRecord | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const records = engine.getProfitWithdrawals();
  const vaultBalance = vitality.securedProfitVault || 0;
  const totalWithdrawn = vitality.totalProfitWithdrawn || 0;

  const handleSaveSettings = () => {
    engine.setAutoWithdrawProfitEnabled(autoEnabled);
    engine.setWithdrawPercentage(withdrawPct);
    engine.setMinProfitThresholdUsd(minThreshold);
    setActionSuccess("Paper reserve settings saved.");
    setTimeout(() => setActionSuccess(null), 3500);
  };

  const handleManualSweep = async () => {
    const amt = parseFloat(manualAmount);
    if (isNaN(amt) || amt <= 0) return;
    if (amt > vitality.cash) {
      alert(`Insufficient cash. Available trading cash is $${vitality.cash.toFixed(2)}.`);
      return;
    }
    const rec = await engine.manualSweepToVault(amt, manualMemo.trim() || undefined);
    if (rec) {
      setActionSuccess(`Successfully swept $${amt.toFixed(2)} into the Paper Profit Reserve Vault!`);
      setManualMemo("");
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleTransferBack = () => {
    const amt = parseFloat(transferBackAmount);
    if (isNaN(amt) || amt <= 0) return;
    if (amt > vaultBalance) {
      alert(`Insufficient vault balance. Available vault capital is $${vaultBalance.toFixed(2)}.`);
      return;
    }
    const ok = engine.transferVaultToTrading(amt);
    if (ok) {
      setActionSuccess(`Transferred $${amt.toFixed(2)} from Vault back to active trading liquidity.`);
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleExportCsv = () => {
    if (records.length === 0) {
      alert("No withdrawal records found to export.");
      return;
    }
    const headers = [
      "Receipt ID",
      "Timestamp",
      "Date UTC",
      "Asset",
      "Policy",
      "Gross Profit USD",
      "Swept to Vault USD",
      "Retained in Cash USD",
      "Vault Balance After USD",
      "SHA-256 Proof",
      "Memo",
    ];
    const rows = records.map((r) => [
      r.id,
      r.timestamp,
      new Date(r.timestamp).toISOString(),
      r.asset,
      r.policy,
      r.grossProfit.toFixed(2),
      r.withdrawnAmount.toFixed(2),
      r.retainedCapital.toFixed(2),
      r.vaultBalanceAfter.toFixed(2),
      r.sha256Proof,
      `"${r.documentationMemo.replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `jarvis-paper-reserve-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2500);
  };

  return (
    <div
      id="profit-vault-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Vault className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  Paper Profit Reserve & Transfer Ledger
                </h2>
                <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Virtual Paper Reserve
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Manual paper-reserve accounting and local SHA-256 audit receipts
              </p>
            </div>
          </div>
          <button
            id="close-vault-modal-btn"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action feedback toast */}
        {actionSuccess && (
          <div className="px-6 py-2.5 bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Vault Stats Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-5 bg-slate-950/40 border-b border-slate-800">
          <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-900/10 border border-amber-500/25">
            <div className="flex items-center justify-between text-xs text-amber-300/80 mb-1">
              <span>Secured Vault Balance</span>
              <Lock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-400 tracking-tight">
              ${vaultBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              Separate virtual reserve balance; not a real cash account
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Total Lifetime Swept</span>
              <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white tracking-tight">
              ${totalWithdrawn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {records.length} documented paper-reserve transfers
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Reserve Mode</span>
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-indigo-300 tracking-tight">
              Manual only
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Available Cash: ${vitality.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Nav Tabs */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-slate-800 bg-slate-900/90 text-sm">
          <div className="flex items-center gap-2">
            <button
              id="tab-vault-ledger"
              onClick={() => setActiveTab("LEDGER")}
              className={`px-3.5 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === "LEDGER"
                  ? "bg-amber-500 text-slate-950 font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Documented Receipts ({records.length})
            </button>
            <button
              id="tab-vault-settings"
              onClick={() => setActiveTab("SETTINGS")}
              className={`px-3.5 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === "SETTINGS"
                  ? "bg-amber-500 text-slate-950 font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Reserve Rules
            </button>
            <button
              id="tab-vault-manual"
              onClick={() => setActiveTab("MANUAL")}
              className={`px-3.5 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === "MANUAL"
                  ? "bg-amber-500 text-slate-950 font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              Capital Sweep & Transfer
            </button>
          </div>

          {activeTab === "LEDGER" && records.length > 0 && (
            <button
              id="export-withdrawal-csv-btn"
              onClick={handleExportCsv}
              className="px-3 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3 h-3 text-amber-400" />
              Export Statement (CSV)
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === "LEDGER" && (
            <div>
              {records.length === 0 ? (
                <div className="py-14 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/20">
                  <div className="p-3 w-12 h-12 mx-auto rounded-xl bg-slate-800/80 text-slate-400 mb-3 flex items-center justify-center">
                    <FileCheck2 className="w-6 h-6 text-amber-400/80" />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1">No Documented Profit Withdrawals Yet</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    This is a virtual paper-account transfer ledger. It never moves real money and is not a custody, brokerage, or bank account.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-semibold uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="py-3 px-4">Receipt / Date</th>
                          <th className="py-3 px-4">Asset & Policy</th>
                          <th className="py-3 px-4 text-right">Gross Profit</th>
                          <th className="py-3 px-4 text-right">Swept to Vault</th>
                          <th className="py-3 px-4 text-right">Vault Total</th>
                          <th className="py-3 px-4 text-center">SHA-256 Proof</th>
                          <th className="py-3 px-4 text-center">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                        {records.map((rec) => (
                          <tr key={rec.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-mono font-semibold text-white">{rec.id}</div>
                              <div className="text-[10px] text-slate-400">
                                {new Date(rec.timestamp).toLocaleDateString()} {new Date(rec.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-200">{rec.asset}</div>
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                {rec.policy === "AUTO_SWEEP_WIN" ? "AUTO SWEEP" : "MANUAL SWEEP"}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-emerald-400 font-semibold">
                              +${rec.grossProfit.toFixed(2)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-amber-400 font-bold">
                              +${rec.withdrawnAmount.toFixed(2)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-slate-300">
                              ${rec.vaultBalanceAfter.toFixed(2)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => handleCopyHash(rec.sha256Proof)}
                                title="Click to copy SHA-256 cryptographic proof"
                                className="font-mono text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center justify-center gap-1 mx-auto"
                              >
                                <span>{rec.sha256Proof.slice(0, 8)}...</span>
                                {copiedHash === rec.sha256Proof ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-400" />
                                )}
                              </button>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => setSelectedReceipt(rec)}
                                className="px-2.5 py-1 text-[11px] font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded border border-amber-500/30 transition-colors"
                              >
                                View Slip
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "SETTINGS" && (
            <div className="space-y-4 max-w-xl">
              <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-white text-sm font-semibold">
                  <Info className="w-4 h-4 text-amber-400" />
                  Paper reserve policy
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Automatic profit sweeping is intentionally disabled in this build. A professional trading system should
                  not silently move capital between sub-ledgers without an explicit accounting rule, reconciliation, and durable journal.
                  Use the manual paper sweep for research scenarios only.
                </p>
                <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 text-[11px] text-neutral-400">
                  <strong className="text-neutral-200">Current status:</strong> Virtual reserve only. No external cash transfer occurs.
                </div>
              </div>
            </div>
          )}

          {activeTab === "MANUAL" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Sweep To Vault */}
              <div className="p-5 rounded-xl bg-slate-950/40 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                  <ArrowDownRight className="w-4 h-4 text-emerald-400" />
                  Manual Profit Sweep into Vault
                </div>
                <p className="text-xs text-slate-400">
                  Transfer realized capital out of active trading liquidity into Paper Profit Reserve. Removes the virtual amount from the simulated trading cash balance; it does not move real money.
                </p>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Amount to Sweep (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-500">$</span>
                    <input
                      type="number"
                      min="1"
                      max={vitality.cash}
                      value={manualAmount}
                      onChange={(e) => setManualAmount(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Max available cash: ${vitality.cash.toFixed(2)}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Documentation Memo (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. End of session profit lock"
                    value={manualMemo}
                    onChange={(e) => setManualMemo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <button
                  id="execute-manual-sweep-btn"
                  onClick={handleManualSweep}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Lock Capital to Vault
                </button>
              </div>

              {/* Transfer Back to Trading */}
              <div className="p-5 rounded-xl bg-slate-950/40 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                  <ArrowUpRight className="w-4 h-4 text-amber-400" />
                  Transfer Vault Capital to Trading Balance
                </div>
                <p className="text-xs text-slate-400">
                  Release funds from Paper Profit Reserve back into the active trading margin pool to expand buying power.
                </p>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Amount to Transfer (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-500">$</span>
                    <input
                      type="number"
                      min="1"
                      max={vaultBalance}
                      value={transferBackAmount}
                      onChange={(e) => setTransferBackAmount(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Available in vault: ${vaultBalance.toFixed(2)}
                  </div>
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-300">
                  <Info className="w-3.5 h-3.5 inline mr-1 text-amber-400" />
                  Transferring capital back exposes it to market drawdown up to your circuit-breaker threshold.
                </div>

                <button
                  id="execute-transfer-back-btn"
                  onClick={handleTransferBack}
                  disabled={vaultBalance <= 0}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors border border-slate-700 flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Transfer to Trading Cash
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Receipt Detail Modal Popup */}
        {selectedReceipt && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-amber-400" />
                  <h3 className="font-bold text-white text-sm">
                    Cryptographic Withdrawal Slip
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400">Transaction ID:</span>
                  <span className="font-mono font-semibold text-white">{selectedReceipt.id}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400">Date UTC:</span>
                  <span className="text-slate-200">{new Date(selectedReceipt.timestamp).toUTCString()}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400">Asset:</span>
                  <span className="font-semibold text-white">{selectedReceipt.asset}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400">Gross Realized Gain:</span>
                  <span className="font-mono text-emerald-400 font-bold">+${selectedReceipt.grossProfit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400">Swept to Paper Profit Reserve:</span>
                  <span className="font-mono text-amber-400 font-bold">+${selectedReceipt.withdrawnAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400">Retained in Cash Pool:</span>
                  <span className="font-mono text-slate-300">${selectedReceipt.retainedCapital.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800/80">
                  <span className="text-slate-400">Vault Balance After:</span>
                  <span className="font-mono text-white font-bold">${selectedReceipt.vaultBalanceAfter.toFixed(2)}</span>
                </div>

                <div className="pt-2">
                  <span className="text-slate-400 block mb-1">SHA-256 Cryptographic Proof:</span>
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[10px] break-all text-amber-300/90 flex items-center justify-between gap-2">
                    <span>{selectedReceipt.sha256Proof}</span>
                    <button
                      onClick={() => handleCopyHash(selectedReceipt.sha256Proof)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-white shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="pt-1">
                  <span className="text-slate-400 block mb-1">Audit Memo:</span>
                  <p className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800 text-[11px] text-slate-300">
                    {selectedReceipt.documentationMemo}
                  </p>
                </div>
              </div>

              <div className="pt-3">
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
                >
                  Close Receipt
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
