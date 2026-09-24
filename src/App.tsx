import React, { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { VitalityBar } from "./components/VitalityBar";
import { MarketChart } from "./components/MarketChart";
import { BotMindStream } from "./components/BotMindStream";
import { TradeExecutionTable } from "./components/TradeExecutionTable";
import { StudyAndOptimizeModal } from "./components/StudyAndOptimizeModal";
import { EmergencyHaltModal } from "./components/EmergencyHaltModal";
import { TradeCritiqueModal } from "./components/TradeCritiqueModal";
import { PaperTradingDeck } from "./components/PaperTradingDeck";
import { OrderBookWidget } from "./components/OrderBookWidget";
import { RiskSettingsModal } from "./components/RiskSettingsModal";
import { MultiAssetRadarModal } from "./components/MultiAssetRadarModal";
import { StrategyVaultModal } from "./components/StrategyVaultModal";
import { MarketHoursModal } from "./components/MarketHoursModal";
import { SecurityAndComplianceModal } from "./components/SecurityAndComplianceModal";
import { SecurityPinLockScreen } from "./components/SecurityPinLockScreen";
import { TradeVerificationToast } from "./components/TradeVerificationToast";
import { AnalyticsCharts } from "./components/AnalyticsCharts";
import { AiCopilotModal } from "./components/AiCopilotModal";
import { ProfitVaultModal } from "./components/ProfitVaultModal";
import { MainTerminal } from "./components/MainTerminal";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import type { WorkspaceView } from "./platform/workspace";
import { AssetSymbol, MarketSimulator, SUPPORTED_ASSETS } from "./engine/marketSimulator";
import { DEFAULT_STRATEGY, TradingEngine } from "./engine/tradingEngine";
import { strategyVaultInstance } from "./engine/strategyVault";
import { cryptoSecurityService } from "./utils/cryptoSecurity";
import { isUsRegularMarketOpen } from "./utils/marketHours";
import {
  BotState,
  BotThoughtLog,
  BotVitality,
  Candle,
  StrategyConfig,
  Trade,
  PaperOrderRequest,
  PaperTradingSettings,
  MarketDataSource,
  LiveExchangeTicker,
  DailyPerformanceGoal,
  ActionNotification,
  EquityCurvePoint,
} from "./types/trading";

export default function App() {
  const [currentAsset, setCurrentAsset] = useState<string>("BTC/USD");
  const [currentView, setCurrentView] = useState<WorkspaceView>("TERMINAL");
  const [marketSource, setMarketSource] = useState<MarketDataSource>("LIVE_MARKET_DATA");
  const [isAutoTrading, setIsAutoTrading] = useState<boolean>(false);
  const [simulationSpeed, setSimulationSpeed] = useState<number>(2); // 2x default for simulator
  const [liveTicker, setLiveTicker] = useState<LiveExchangeTicker | null>(null);
  const [formingCandle, setFormingCandle] = useState<Candle | null>(null);
  const [liveDataError, setLiveDataError] = useState<string | null>(null);

  // Engines refs
  const simulatorRef = useRef<MarketSimulator | null>(null);
  const tradingEngineRef = useRef<TradingEngine | null>(null);

  if (!simulatorRef.current) {
    simulatorRef.current = new MarketSimulator("BTC/USD", 80);
  }
  if (!tradingEngineRef.current) {
    tradingEngineRef.current = new TradingEngine(10000, 6, DEFAULT_STRATEGY);
  }

  // Synchronized state for React render
  const [candles, setCandles] = useState<Candle[]>(() => simulatorRef.current!.getCandles());
  const [vitality, setVitality] = useState<BotVitality | null>(() =>
    tradingEngineRef.current!.getVitality()
  );
  const [botState, setBotState] = useState<BotState>(() => tradingEngineRef.current!.getBotState());
  const [strategy, setStrategy] = useState<StrategyConfig>(() =>
    tradingEngineRef.current!.getStrategy()
  );
  const [activeTrade, setActiveTrade] = useState<Trade | null>(null);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [thoughts, setThoughts] = useState<BotThoughtLog[]>(() =>
    tradingEngineRef.current!.getThoughts()
  );
  const [paperSettings, setPaperSettings] = useState<PaperTradingSettings>(() =>
    tradingEngineRef.current!.getPaperSettings()
  );
  const [notifications, setNotifications] = useState<ActionNotification[]>(() =>
    tradingEngineRef.current!.getNotifications()
  );
  const [equityCurve, setEquityCurve] = useState<EquityCurvePoint[]>(() =>
    tradingEngineRef.current!.getEquityCurve()
  );

  // Modals state
  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [isRiskSettingsOpen, setIsRiskSettingsOpen] = useState(false);
  const [isRadarOpen, setIsRadarOpen] = useState(false);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [isMarketHoursOpen, setIsMarketHoursOpen] = useState(false);
  const [isSecurityVaultOpen, setIsSecurityVaultOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [copilotInitialMode, setCopilotInitialMode] = useState<"CHAT" | "VOICE">("CHAT");
  const [isProfitVaultOpen, setIsProfitVaultOpen] = useState(false);
  const [isSessionLocked, setIsSessionLocked] = useState(() => cryptoSecurityService.isSessionLocked());
  const [autoRotateAssets, setAutoRotateAssets] = useState(false);

  // Monitor user activity and session auto-lock
  useEffect(() => {
    const handleActivity = () => {
      cryptoSecurityService.touchActivity();
    };

    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("touchstart", handleActivity, { passive: true });

    // Check auto-lock timeout every 5 seconds
    const interval = setInterval(() => {
      if (cryptoSecurityService.isSessionLocked()) {
        setIsSessionLocked(true);
      }
    }, 5000);

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      clearInterval(interval);
    };
  }, [marketSource]);
  const [dailyGoal, setDailyGoal] = useState<DailyPerformanceGoal>(() =>
    strategyVaultInstance.getDailyGoal()
  );
  const [selectedTradeCritique, setSelectedTradeCritique] = useState<Trade | null>(null);
  const [verificationToastTrade, setVerificationToastTrade] = useState<Trade | null>(null);

  // Sync state helper
  const syncStateFromEngine = useCallback(() => {
    if (!tradingEngineRef.current || !simulatorRef.current) return;
    const engine = tradingEngineRef.current;
    const sim = simulatorRef.current;

    setVitality({ ...engine.getVitality() });
    const newState = engine.getBotState();
    setBotState(newState);
    setStrategy({ ...engine.getStrategy() });
    setActiveTrade(engine.getActiveTrade() ? { ...engine.getActiveTrade()! } : null);
    setTradeHistory([...engine.getTradeHistory()]);
    setThoughts([...engine.getThoughts()]);
    if (marketSource === "SIMULATED") setCandles([...sim.getCandles()]);
    setPaperSettings(engine.getPaperSettings());
    setDailyGoal(strategyVaultInstance.getDailyGoal());
    setNotifications([...engine.getNotifications()]);
    setEquityCurve([...engine.getEquityCurve()]);

    if (newState === "HALTED_DEAD") {
      setIsEmergencyModalOpen(true);
    }
  }, [marketSource]);

  // Hook state sync callback to engine
  useEffect(() => {
    if (tradingEngineRef.current) {
      tradingEngineRef.current.setOnStateChange(() => {
        syncStateFromEngine();
      });
    }
  }, [syncStateFromEngine]);

  // Tick execution loop for simulator mode
  const stepTick = useCallback(() => {
    if (!simulatorRef.current || !tradingEngineRef.current) return;
    const sim = simulatorRef.current;
    const engine = tradingEngineRef.current;

    const nextCandle = sim.nextTick();
    const allCandles = sim.getCandles();

    engine.onTick(nextCandle, allCandles);
    syncStateFromEngine();
  }, [syncStateFromEngine]);

  // High-Speed Simulation Interval (when SIMULATED is active)
  useEffect(() => {
    if (marketSource !== "SIMULATED") return;
    if (!isAutoTrading || botState === "HALTED_DEAD") return;

    const intervalMs = Math.max(120, Math.floor(1000 / simulationSpeed));
    const timer = setInterval(() => {
      stepTick();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [marketSource, isAutoTrading, simulationSpeed, botState, stepTick]);

  // Live Exchange Data Polling Loop (when LIVE_MARKET_DATA is active)
  useEffect(() => {
    if (marketSource !== "LIVE_MARKET_DATA") return;

    let isSubscribed = true;

    const fetchLiveFeed = async () => {
      try {
        const res = await fetch(`/api/market/live-feed?symbol=${encodeURIComponent(currentAsset)}&limit=80`);
        if (!res.ok) throw new Error(`Feed error: ${res.status}`);
        const data = await res.json();

        if (!isSubscribed) return;
        if (!data?.ticker || !Array.isArray(data.candles) || data.candles.length === 0) {
          throw new Error("Trusted provider returned an incomplete market snapshot.");
        }

        const bid = Number(data.ticker.bid);
        const ask = Number(data.ticker.ask);
        const mid = (bid + ask) / 2;
        const spreadBps = Number.isFinite(bid) && Number.isFinite(ask) && mid > 0
          ? ((ask - bid) / mid) * 10_000
          : undefined;
        tradingEngineRef.current?.setMarketQuality({
          spreadBps,
          dataTimestamp: Number(data.ticker.lastUpdated) || Date.now(),
          marketOpen: currentAsset.includes("/USD") ? true : isUsRegularMarketOpen(),
        });
        setLiveTicker(data.ticker);
        setLiveDataError(null);

        if (Array.isArray(data.candles) && data.candles.length > 0) {
          if (simulatorRef.current && tradingEngineRef.current) {
            simulatorRef.current.setExternalCandles(data.candles);
            const allCandles = simulatorRef.current.getCandles();
            const lastCandle = allCandles[allCandles.length - 1];

            if (isAutoTrading && botState !== "HALTED_DEAD") {
              tradingEngineRef.current.onTick(lastCandle, allCandles);
            } else if (tradingEngineRef.current.getActiveTrade()) {
              // Always manage active trade stop-loss/take-profit even if auto hunting is paused
              tradingEngineRef.current.onTick(lastCandle, allCandles);
            }

            setCandles([...allCandles]);
            syncStateFromEngine();
          }
        }
      } catch (err) {
        console.warn("Live feed unavailable; paper/live mode remains fail-closed:", err);
        setLiveTicker(null);
        setIsAutoTrading(false);
        setLiveDataError("Trusted market data is unavailable. Auto-paper execution has been paused and no synthetic price is substituted.");
        setCandles([]);
      }
    };

    // Initial fetch immediately
    fetchLiveFeed();

    // Poll live exchange every 2.5 seconds
    const interval = setInterval(fetchLiveFeed, 2500);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [marketSource, currentAsset, isAutoTrading, botState, syncStateFromEngine]);

  // Handle Asset Switch
  const handleSelectAsset = (asset: string) => {
    if (!asset) return;
    if (activeTrade) {
      tradingEngineRef.current?.addNotification({
        type: "RISK_ALERT",
        title: "Asset switch blocked",
        message: "Close the active paper position before changing assets. Position context must remain fixed until exit.",
        badgeText: "LOCKED",
      });
      syncStateFromEngine();
      return;
    }

    setCurrentAsset(asset);
    const strat = tradingEngineRef.current?.getStrategy();
    if (strat && tradingEngineRef.current) {
      tradingEngineRef.current.updateStrategy({ ...strat, asset });
    }

    // The synthetic simulator only knows its explicit demo universe. Any dynamically
    // discovered market is immediately treated as live-market-data-only.
    if (simulatorRef.current) {
      const knownSynthetic = Object.prototype.hasOwnProperty.call(
        SUPPORTED_ASSETS,
        asset as AssetSymbol,
      );
      if (knownSynthetic) {
        simulatorRef.current.setAsset(asset as AssetSymbol, 80);
      } else {
        setMarketSource("LIVE_MARKET_DATA");
        setCandles([]);
      }
    }

    if (!Object.prototype.hasOwnProperty.call(SUPPORTED_ASSETS, asset)) {
      setIsAutoTrading(false);
    }
    syncStateFromEngine();
  };

  // Toggle Auto Trading
  const handleToggleAutoTrading = () => {
    if (!isAutoTrading && botState === "HALTED_DEAD") return;
    if (!isAutoTrading && marketSource === "LIVE_MARKET_DATA" && liveDataError) return;
    setIsAutoTrading((prev) => !prev);
  };

  // Manual Kill Switch Trigger
  const handleTriggerKillSwitch = () => {
    if (!tradingEngineRef.current || !simulatorRef.current) return;
    const lastCandle = simulatorRef.current.getLastCandle();
    if (lastCandle) {
      tradingEngineRef.current.manualKillSwitch(lastCandle);
      syncStateFromEngine();
      setIsEmergencyModalOpen(true);
    }
  };

  // Resume Automated Execution
  const handleReviveBot = (recapital?: number) => {
    if (!tradingEngineRef.current) return;
    tradingEngineRef.current.reviveBot(recapital);
    setIsEmergencyModalOpen(false);
    setIsAutoTrading(false);
    syncStateFromEngine();
  };

  // Adjust circuit breaker threshold
  const handleAdjustCircuitBreaker = (newPercent: number) => {
    if (!tradingEngineRef.current) return;
    tradingEngineRef.current.setCircuitBreakerThreshold(newPercent);
    syncStateFromEngine();
  };

  // Manual Close of Active Trade
  const handleManualCloseActiveTrade = () => {
    if (!tradingEngineRef.current || !simulatorRef.current) return;
    const lastCandle = simulatorRef.current.getLastCandle();
    if (lastCandle) {
      tradingEngineRef.current.closeTrade(
        lastCandle.close,
        "CLOSED_MANUAL",
        "User manual market execution capture"
      );
      syncStateFromEngine();
    }
  };

  // Apply Evolved Strategy from AI Lab
  const handleApplyStrategy = (newStrategy: StrategyConfig) => {
    if (!tradingEngineRef.current) return;
    // Loading a research candidate never leaves automated paper execution running.
    setIsAutoTrading(false);
    tradingEngineRef.current.updateStrategy(newStrategy);
    syncStateFromEngine();
  };

  // Execute Manual Paper Order
  const handleExecutePaperTrade = (request: PaperOrderRequest): boolean => {
    if (!tradingEngineRef.current || !simulatorRef.current) return false;
    if (marketSource === "LIVE_MARKET_DATA" && liveDataError) return false;
    const lastCandle = simulatorRef.current.getLastCandle();
    if (!lastCandle || !Number.isFinite(lastCandle.close) || lastCandle.close <= 0) return false;
    const success = tradingEngineRef.current.executePaperTrade(request, lastCandle.close);
    if (success) {
      syncStateFromEngine();
      const trade = tradingEngineRef.current.getActiveTrade();
      if (trade) setVerificationToastTrade(trade);
    }
    return success;
  };

  // User action: run a fresh, rules-based paper scan. Direct/immediate execution is deliberately disabled.
  const handleRunImmediateTrade = () => {
    handleForceBotScan();
  };

  // Select an asset for review; selecting an asset never places an order automatically.
  const handleSelectAndTradeAsset = (asset: string, _executeTrade?: boolean) => {
    handleSelectAsset(asset);
  };

  // Force Quantitative Confluence Scan
  const handleForceBotScan = () => {
    if (!tradingEngineRef.current || !simulatorRef.current) return;
    const lastCandle = simulatorRef.current.getLastCandle();
    const allCandles = simulatorRef.current.getCandles();
    if (lastCandle) {
      tradingEngineRef.current.forceScanSignal(lastCandle, allCandles);
      syncStateFromEngine();
    }
  };

  // Simulate Emergency Drawdown Test
  const handleSimulateEmergencyTest = () => {
    if (!tradingEngineRef.current || !simulatorRef.current) return;
    const lastCandle = simulatorRef.current.getLastCandle();
    const currentPrice = lastCandle ? lastCandle.close : 65000;
    tradingEngineRef.current.simulateEmergencyDrawdownTest(currentPrice);
    syncStateFromEngine();
    setIsEmergencyModalOpen(true);
  };

  // Full Paper Account Reset
  const handleResetAccount = (initialCapital: number = 10000) => {
    if (!tradingEngineRef.current) return;
    tradingEngineRef.current.fullResetAccount(initialCapital);
    setIsEmergencyModalOpen(false);
    setIsAutoTrading(false);
    syncStateFromEngine();
  };

  // Update Paper Settings
  const handleUpdatePaperSettings = (settings: Partial<PaperTradingSettings>) => {
    if (!tradingEngineRef.current) return;
    tradingEngineRef.current.updatePaperSettings(settings);
    syncStateFromEngine();
  };

  // Notification actions
  const handleMarkAllNotificationsRead = () => {
    if (!tradingEngineRef.current) return;
    tradingEngineRef.current.markAllNotificationsRead();
    syncStateFromEngine();
  };

  const handleClearNotifications = () => {
    if (!tradingEngineRef.current) return;
    tradingEngineRef.current.clearNotifications();
    syncStateFromEngine();
  };

  const handleScrollToAnalytics = () => {
    const el = document.getElementById("analytics-charts-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const currentPrice =
    liveTicker?.price ??
    formingCandle?.close ??
    candles[candles.length - 1]?.close ??
    null;
  const currentRegime = simulatorRef.current ? simulatorRef.current.getRegime() : "CHOPPY_RANGE";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* 1. Header Navigation & Controls */}
      <Header
        currentAsset={currentAsset}
        onSelectAsset={handleSelectAsset}
        currentView={currentView}
        onChangeView={setCurrentView}
        botState={botState}
        marketSource={marketSource}
        isAutoTrading={isAutoTrading}
        onToggleAutoTrading={handleToggleAutoTrading}
        simulationSpeed={simulationSpeed}
        onSetSimulationSpeed={setSimulationSpeed}
        onStepTick={stepTick}
        onOpenStudyModal={() => setIsStudyModalOpen(true)}
        onOpenRiskSettings={() => setIsRiskSettingsOpen(true)}
        onOpenRadar={() => setIsRadarOpen(true)}
        onOpenVault={() => setIsVaultOpen(true)}
        onOpenMarketHours={() => setIsMarketHoursOpen(true)}
        onOpenSecurityVault={() => setIsSecurityVaultOpen(true)}
        onOpenCopilot={(mode) => {
          setCopilotInitialMode(mode || "CHAT");
          setIsCopilotOpen(true);
        }}
        onOpenProfitVault={() => setIsProfitVaultOpen(true)}
        securedVaultBalance={vitality?.securedProfitVault || 0}
        onTriggerKillSwitch={handleTriggerKillSwitch}
        onReviveBot={() => handleReviveBot()}
        notifications={notifications}
        onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
        onClearNotifications={handleClearNotifications}
        onScrollToAnalytics={handleScrollToAnalytics}
      />

      {/* Practice-only risk HUD. The primary terminal stays focused on markets. */}
      {currentView === "PRACTICE" && vitality && (
        <VitalityBar
          vitality={vitality}
          onAdjustCircuitBreaker={handleAdjustCircuitBreaker}
          onOpenProfitVault={() => setIsProfitVaultOpen(true)}
        />
      )}

      {marketSource === "LIVE_MARKET_DATA" && liveDataError && (
        <div className="mx-4 mt-3 max-w-7xl w-full self-center rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300 font-mono">
          DATA UNAVAILABLE • {liveDataError}
        </div>
      )}

      {currentView === "TERMINAL" ? (
        <MainTerminal
          asset={currentAsset}
          candles={candles}
          ticker={liveTicker}
          currentPrice={currentPrice}
          regime={currentRegime}
          onSelectAsset={handleSelectAsset}
          onOpenPortfolio={() => setCurrentView("PORTFOLIO")}
          onOpenAutomation={() => setCurrentView("AUTOMATION")}
          onOpenResearch={() => setCurrentView("RESEARCH")}
        />
      ) : currentView === "PRACTICE" ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 flex flex-col gap-4">
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/10 px-4 py-3">
            <div className="text-xs font-mono font-semibold text-amber-300">PRACTICE LAB</div>
            <div className="text-[11px] text-amber-200/70 mt-1">
              Paper/simulation only. This workspace is intentionally separate from the primary market terminal.
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-8 xl:col-span-9">
              {vitality && (
                <PaperTradingDeck
                  currentPrice={currentPrice}
                  asset={currentAsset}
                  botState={botState}
                  vitality={vitality}
                  strategy={strategy}
                  activeTrade={activeTrade}
                  marketSource={marketSource}
                  ticker={liveTicker}
                  isAutoTrading={isAutoTrading}
                  onToggleAutoTrading={handleToggleAutoTrading}
                  onToggleMarketSource={(src) => setMarketSource(src)}
                  onExecutePaperTrade={handleExecutePaperTrade}
                  onRunImmediateTrade={handleRunImmediateTrade}
                  onOpenMultiAssetRadar={() => setIsRadarOpen(true)}
                  onOpenStrategyVault={() => setIsVaultOpen(true)}
                  autoRotateAssets={autoRotateAssets}
                  onToggleAutoRotateAssets={() => setAutoRotateAssets((prev) => !prev)}
                  dailyGoal={dailyGoal}
                  onForceBotScan={handleForceBotScan}
                  onCloseActiveTrade={handleManualCloseActiveTrade}
                  onSimulateEmergencyTest={handleSimulateEmergencyTest}
                  onOpenSettings={() => setIsRiskSettingsOpen(true)}
                />
              )}
            </div>

            <div className="lg:col-span-4 xl:col-span-3">
              <OrderBookWidget
                currentPrice={currentPrice}
                symbol={currentAsset}
                dataSource={marketSource}
                bid={liveTicker?.bid}
                ask={liveTicker?.ask}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4">
              <MarketChart
                candles={candles}
                activeTrade={activeTrade}
                tradeHistory={tradeHistory}
                assetSymbol={currentAsset}
                regime={currentRegime}
              />
            </div>
            <div className="lg:col-span-5 xl:col-span-4 flex flex-col">
              <BotMindStream
                thoughts={thoughts}
                activeRuleCount={strategy.rules.length}
                strategyVersion={strategy.version}
              />
            </div>
          </div>

          {vitality && (
            <div id="analytics-charts-section" className="w-full">
              <AnalyticsCharts
                equityCurve={equityCurve}
                tradeHistory={tradeHistory}
                vitality={vitality}
                currentAsset={currentAsset}
              />
            </div>
          )}

          <div id="trade-journal-section" className="w-full">
            <TradeExecutionTable
              activeTrade={activeTrade}
              tradeHistory={tradeHistory}
              strategy={strategy}
              onManualCloseActiveTrade={handleManualCloseActiveTrade}
              onOpenTradeCritique={(trade) => setSelectedTradeCritique(trade)}
            />
          </div>
        </main>
      ) : (
        <WorkspaceSurface
          view={currentView as Exclude<WorkspaceView, "TERMINAL" | "PRACTICE">}
          onSelectAsset={handleSelectAsset}
          onOpenRadar={() => setIsRadarOpen(true)}
          onOpenResearch={() => setIsStudyModalOpen(true)}
          onOpenSettings={() => setIsRiskSettingsOpen(true)}
        />
      )}

      {/* Floating Verification Receipt Toast */}
      {verificationToastTrade && (
        <TradeVerificationToast
          trade={verificationToastTrade}
          onClose={() => setVerificationToastTrade(null)}
          onScrollToTable={() => {
            const el = document.getElementById("trade-journal-section");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }}
        />
      )}

      {/* Footer System Status */}
      <footer className="border-t border-neutral-900 bg-neutral-950/80 px-4 py-2.5 text-[11px] font-mono text-neutral-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                marketSource === "LIVE_MARKET_DATA" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            <span>
              Jarvis Finance Engine:{" "}
              {marketSource === "LIVE_MARKET_DATA"
                ? "Verified live market-data feed"
                : "Explicit demo simulator"}
            </span>
          </div>
          <div>
            <span>Research + paper trading &bull; Risk controls are modeled, not guaranteed</span>
          </div>
        </div>
      </footer>

      {/* AI Brain Study & Backtest Modal */}
      <StudyAndOptimizeModal
        isOpen={isStudyModalOpen}
        onClose={() => setIsStudyModalOpen(false)}
        currentStrategy={strategy}
        candles={candles}
        recentTrades={tradeHistory}
        drawdownPercent={vitality?.currentDrawdownPercent || 0}
        onApplyStrategy={handleApplyStrategy}
      />

      {/* Emergency Halt / Death Modal */}
      {vitality && (
        <EmergencyHaltModal
          isOpen={isEmergencyModalOpen}
          vitality={vitality}
          strategy={strategy}
          onReviveBot={(recapital) => handleReviveBot(recapital)}
          onUpdateThreshold={handleAdjustCircuitBreaker}
        />
      )}

      {/* Individual Trade Debrief / Critique Modal */}
      <TradeCritiqueModal
        trade={selectedTradeCritique}
        onClose={() => setSelectedTradeCritique(null)}
      />

      {/* Paper Trading Risk & Account Settings Modal */}
      {vitality && (
        <RiskSettingsModal
          isOpen={isRiskSettingsOpen}
          onClose={() => setIsRiskSettingsOpen(false)}
          vitality={vitality}
          paperSettings={paperSettings}
          tradeHistory={tradeHistory}
          onUpdateSettings={handleUpdatePaperSettings}
          onUpdateCircuitBreaker={handleAdjustCircuitBreaker}
          onResetAccount={handleResetAccount}
        />
      )}

      {/* Multi-Asset Research Radar Modal */}
      <MultiAssetRadarModal
        isOpen={isRadarOpen}
        onClose={() => setIsRadarOpen(false)}
        currentAsset={currentAsset}
        onSelectAndTradeAsset={handleSelectAndTradeAsset}
        autoRotate={autoRotateAssets}
        onToggleAutoRotate={() => setAutoRotateAssets((prev) => !prev)}
        minConfidence={strategy.minConfidence}
      />

      {/* Strategy Memory Vault & Anti-Duplication Modal */}
      <StrategyVaultModal
        isOpen={isVaultOpen}
        onClose={() => setIsVaultOpen(false)}
        currentStrategy={strategy}
        onApplyStrategy={handleApplyStrategy}
      />

      {/* Market Hours & Mobile Runtime Modal */}
      <MarketHoursModal
        isOpen={isMarketHoursOpen}
        onClose={() => setIsMarketHoursOpen(false)}
        autoRotateAssets={autoRotateAssets}
        onToggleAutoRotate={() => setAutoRotateAssets((prev) => !prev)}
      />

      {/* Financial Legal, Quant Defense & Cybersecurity Shield Modal */}
      <SecurityAndComplianceModal
        isOpen={isSecurityVaultOpen}
        onClose={() => setIsSecurityVaultOpen(false)}
        onSessionLocked={() => setIsSessionLocked(true)}
      />

      {/* AEGIS Quantitative AI Copilot & Voice Advisor Modal */}
      {vitality && (
        <AiCopilotModal
          isOpen={isCopilotOpen}
          onClose={() => setIsCopilotOpen(false)}
          vitality={vitality}
          currentAsset={currentAsset}
          currentPrice={currentPrice}
          activeTrade={activeTrade}
          strategy={strategy}
          isAutoTrading={isAutoTrading}
          initialMode={copilotInitialMode}
        />
      )}

      {/* Virtual Paper Reserve & Transfer Ledger Modal */}
      {vitality && tradingEngineRef.current && (
        <ProfitVaultModal
          isOpen={isProfitVaultOpen}
          onClose={() => setIsProfitVaultOpen(false)}
          engine={tradingEngineRef.current}
          vitality={vitality}
        />
      )}

      {/* Local Security PIN Lock Screen Overlay */}
      {isSessionLocked && (
        <SecurityPinLockScreen onUnlock={() => setIsSessionLocked(false)} />
      )}
    </div>
  );
}
