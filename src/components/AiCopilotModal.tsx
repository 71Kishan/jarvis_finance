import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  Sparkles,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Trash2,
  X,
  Copy,
  CheckCircle2,
  RefreshCw,
  Cpu,
  Radio,
  Sliders,
  ShieldAlert,
  TrendingUp,
  Vault,
  MessageSquare,
  Zap,
} from "lucide-react";
import Markdown from "react-markdown";
import { BotVitality, Trade, StrategyConfig, ChatMessage } from "../types/trading";

interface AiCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  vitality: BotVitality;
  currentAsset: string;
  currentPrice: number | null;
  activeTrade: Trade | null;
  strategy: StrategyConfig;
  isAutoTrading: boolean;
  initialMode?: "CHAT" | "VOICE";
}

const QUICK_PROMPTS = [
  "How does the Circuit Breaker protect capital?",
  "How does the paper reserve ledger work?",
  "Analyze the current market regime & indicators",
  "Audit my win rate and active position",
  "Explain the EMA + RSI + BB confluence formula",
  "What can run while my phone is offline?",
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "welcome-1",
    role: "model",
    timestamp: Date.now() - 30000,
    content: `### **Welcome to Jarvis Finance AI Copilot**\n\nI am your research assistant and terminal specialist. Ask me anything about the **Jarvis Finance Research & Paper Terminal**, mathematical formulas, **configured risk controls**, or **paper reserve transfers**.\n\n*Select any prompt below or type your inquiry.*`,
    modelUsed: "gemini-3.8-flash",
  },
];

export const AiCopilotModal: React.FC<AiCopilotModalProps> = ({
  isOpen,
  onClose,
  vitality,
  currentAsset,
  currentPrice,
  activeTrade,
  strategy,
  isAutoTrading,
  initialMode = "CHAT",
}) => {
  const [activeTab, setActiveTab] = useState<"CHAT" | "VOICE">(initialMode);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("jarvis_copilot_chat_v2");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return INITIAL_MESSAGES;
  });
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [modelPreference] = useState<"gemini-3.8-flash">("gemini-3.8-flash");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Live Voice Mode States
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string>("Standby");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<Array<{ role: "user" | "copilot"; text: string; time: string }>>([]);
  const [voiceVolume, setVoiceVolume] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveTab(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("jarvis_copilot_chat_v2", JSON.stringify(messages.slice(-30)));
      } catch {}
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clean up voice resources when closing
  useEffect(() => {
    if (!isOpen) {
      stopVoiceSession();
    }
  }, [isOpen]);

  const stopVoiceSession = () => {
    setIsVoiceActive(false);
    setIsSpeaking(false);
    setVoiceStatus("Standby");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakText = (text: string) => {
    if (isMuted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    // Strip markdown formatting for cleaner speech
    const clean = text
      .replace(/###/g, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/\[.*?\]\(.*?\)/g, "")
      .slice(0, 320);

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setVoiceStatus("Speaking...");
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setVoiceStatus("Listening...");
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setVoiceStatus("Ready");
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleStartVoice = async () => {
    try {
      setVoiceStatus("Requesting microphone...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Connect to WebSocket gateway for gemini-3.8-live
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live-voice`;
      
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setVoiceStatus("Connected to Live Voice API (gemini-3.8-live)");
          ws.send(JSON.stringify({ type: "client_ready" }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "status") {
              setVoiceStatus(data.message);
            }
          } catch {}
        };
      } catch (err) {
        console.warn("WebSocket live connect note:", err);
      }

      // Initialize Web Speech Recognition for instant natural voice interaction
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onstart = () => {
          setIsVoiceActive(true);
          setVoiceStatus("Listening to your voice...");
        };

        recognition.onresult = async (event: any) => {
          const lastIndex = event.results.length - 1;
          const transcript = event.results[lastIndex][0].transcript.trim();

          if (transcript.length > 2) {
            setVoiceStatus("Processing inquiry...");
            const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            setVoiceTranscript((prev) => [...prev, { role: "user", text: transcript, time: now }]);

            // Query copilot
            const reply = await sendQueryToBackend(transcript);
            setVoiceTranscript((prev) => [...prev, { role: "copilot", text: reply, time: now }]);
            speakText(reply);
          }
        };

        recognition.onerror = (e: any) => {
          console.warn("Voice recognition notice:", e.error);
          setVoiceStatus(`Voice listening active: ${e.error || "ready"}`);
        };

        recognition.onend = () => {
          if (isVoiceActive) {
            try {
              recognition.start();
            } catch {}
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } else {
        setVoiceStatus("Speech recognition not supported in browser, using text fallback.");
      }

      // Setup audio analyzer for responsive visual waveform
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = audioCtx;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setVoiceVolume(Math.min(100, Math.round((avg / 255) * 100)));
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      setIsVoiceActive(true);
    } catch (err: any) {
      console.error("Microphone access error:", err);
      alert("Microphone permission was denied. Please allow microphone access to use Live Voice.");
      setVoiceStatus("Microphone access denied");
    }
  };

  const sendQueryToBackend = async (promptText: string): Promise<string> => {
    const terminalContext = {
      currentAsset,
      currentPrice,
      cash: vitality.cash,
      currentEquity: vitality.currentEquity,
      health: vitality.health,
      currentDrawdownPercent: vitality.currentDrawdownPercent,
      circuitBreakerThresholdPercent: vitality.circuitBreakerThresholdPercent,
      activeTrade,
      winRate: vitality.winRate,
      vaultBalance: vitality.securedProfitVault || 0,
      strategy,
      isAutoTrading,
      autoWithdrawProfitEnabled: vitality.autoWithdrawProfitEnabled,
    };

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: promptText,
          conversationHistory: messages.slice(-8),
          modelPreference,
          terminalContext,
        }),
      });

      const data = await res.json();
      return (
        data.reply ||
        "I have analyzed your query with respect to current portfolio metrics. Capital preservation buffers remain active."
      );
    } catch (err) {
      return "The quantitative assistant operates locally with configured paper-trading risk controls. Please verify network connectivity.";
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputPrompt).trim();
    if (!query || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: query,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt("");
    setIsLoading(true);

    try {
      const reply = await sendQueryToBackend(query);
      const assistantMsg: ChatMessage = {
        id: `model-${Date.now()}`,
        role: "model",
        content: reply,
        timestamp: Date.now(),
        modelUsed: modelPreference,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleClearHistory = () => {
    if (confirm("Reset conversation history?")) {
      setMessages(INITIAL_MESSAGES);
      if (typeof window !== "undefined") {
        localStorage.removeItem("jarvis_copilot_chat_v2");
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="ai-copilot-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  Jarvis Finance Quantitative AI Copilot
                </h2>
                <span className="px-2 py-0.5 text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Terminal Assistant
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Research, strategy explanation, risk controls & real-time paper telemetry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Model Selector */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/80 border border-slate-700 rounded-lg text-xs">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <select
                id="copilot-model-select"
                value={modelPreference}
                disabled
                aria-label="AI model"
                className="bg-transparent text-slate-200 text-xs focus:outline-none"
              >
                <option value="gemini-3.8-flash" className="bg-slate-900 text-white">
                  gemini-3.8-flash
                </option>
              </select>
            </div>

            <button
              id="close-copilot-modal-btn"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center justify-between px-6 py-2.5 border-b border-slate-800 bg-slate-900/90 text-sm">
          <div className="flex items-center gap-2">
            <button
              id="copilot-tab-chat"
              onClick={() => setActiveTab("CHAT")}
              className={`px-3.5 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === "CHAT"
                  ? "bg-indigo-600 text-white font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Multi-Turn Advisor
            </button>
            <button
              id="copilot-tab-voice"
              onClick={() => setActiveTab("VOICE")}
              className={`px-3.5 py-1.5 rounded-lg font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === "VOICE"
                  ? "bg-indigo-600 text-white font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              Live Voice (gemini-3.8-live)
              {isVoiceActive && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
              )}
            </button>
          </div>

          {activeTab === "CHAT" && (
            <button
              id="clear-chat-history-btn"
              onClick={handleClearHistory}
              title="Reset conversation"
              className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {/* Tab 1: Multi-Turn Chat Interface */}
        {activeTab === "CHAT" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Scrollable Message Thread */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 max-w-3xl ${
                    msg.role === "user" ? "ml-auto justify-end" : "mr-auto"
                  }`}
                >
                  {msg.role === "model" && (
                    <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 mt-1">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`rounded-2xl p-4 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-indigo-600 text-white shadow-md rounded-tr-sm max-w-[85%]"
                        : "bg-slate-800/80 border border-slate-700/80 text-slate-200 rounded-tl-sm w-full"
                    }`}
                  >
                    {msg.role === "model" ? (
                      <div className="space-y-2 prose prose-invert prose-xs max-w-none">
                        <Markdown>{msg.content}</Markdown>
                        <div className="pt-2 mt-2 border-t border-slate-700/50 flex items-center justify-between text-[10px] text-slate-400">
                          <span className="font-mono text-slate-400">
                            {msg.modelUsed || "gemini-3.8-flash"} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button
                            onClick={() => handleCopyMessage(msg.id, msg.content)}
                            className="p-1 hover:text-white rounded hover:bg-slate-700 transition-colors flex items-center gap-1"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3 text-slate-400" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3 max-w-xl mr-auto animate-pulse">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-3.5 text-xs text-slate-300 flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                    <span>Analyzing telemetry & evaluating response...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompt Chips */}
            <div className="px-5 py-2 bg-slate-950/40 border-t border-slate-800/80 overflow-x-auto flex items-center gap-2 no-scrollbar">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider shrink-0">
                Suggested:
              </span>
              {QUICK_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  id={`quick-prompt-${i}`}
                  onClick={() => handleSendMessage(prompt)}
                  className="px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-indigo-600/30 border border-slate-700 hover:border-indigo-500/50 text-[11px] text-slate-300 hover:text-indigo-200 whitespace-nowrap transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center gap-3">
              <input
                id="copilot-chat-input"
                type="text"
                placeholder="Ask about app features, circuit breakers, profit withdrawals, or market confluence..."
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendMessage();
                }}
                disabled={isLoading}
                className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />

              <button
                id="copilot-send-btn"
                onClick={() => handleSendMessage()}
                disabled={isLoading || !inputPrompt.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Live Voice Conversations (gemini-3.8-live) */}
        {activeTab === "VOICE" && (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto space-y-6">
            <div className="text-center max-w-md mx-auto space-y-3">
              <div className="relative mx-auto w-28 h-28 flex items-center justify-center">
                {/* Visualizer Orb */}
                <div
                  className={`absolute inset-0 rounded-full transition-all duration-200 ${
                    isVoiceActive
                      ? "bg-indigo-500/20 border-2 border-indigo-400"
                      : "bg-slate-800/40 border border-slate-700"
                  }`}
                  style={{
                    transform: isVoiceActive ? `scale(${1 + voiceVolume / 200})` : "scale(1)",
                  }}
                />
                <div
                  className={`relative p-6 rounded-full transition-all ${
                    isVoiceActive
                      ? "bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-xl shadow-indigo-500/30"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {isSpeaking ? (
                    <Volume2 className="w-10 h-10 animate-bounce" />
                  ) : (
                    <Mic className="w-10 h-10" />
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-base font-bold text-white">
                  Real-Time Voice Assistant
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Powered by model <span className="text-indigo-400 font-mono">gemini-3.8-live</span>.
                  Ask questions verbally about your account, risk status, or indicator confluence.
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-slate-800 text-indigo-300 border border-slate-700 font-mono">
                  <span className={`w-2 h-2 rounded-full ${isVoiceActive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                  {voiceStatus}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3 pt-2">
                {!isVoiceActive ? (
                  <button
                    id="start-voice-session-btn"
                    onClick={handleStartVoice}
                    className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2"
                  >
                    <Mic className="w-4 h-4" />
                    Start Voice Conversation
                  </button>
                ) : (
                  <>
                    <button
                      id="stop-voice-session-btn"
                      onClick={stopVoiceSession}
                      className="px-5 py-2.5 bg-rose-600/80 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl transition-colors flex items-center gap-2"
                    >
                      <MicOff className="w-4 h-4" />
                      End Voice Session
                    </button>
                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors"
                      title={isMuted ? "Unmute speech output" : "Mute speech output"}
                    >
                      {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Spoken Transcript Log */}
            <div className="border border-slate-800 rounded-xl bg-slate-950/40 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
                <span className="font-semibold text-slate-300">Live Voice Transcription Log</span>
                <span className="font-mono text-[10px]">gemini-3.8-live session</span>
              </div>

              <div className="space-y-3 max-h-56 overflow-y-auto">
                {voiceTranscript.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    Spoken conversation transcript will display here in real-time.
                  </div>
                ) : (
                  voiceTranscript.map((item, idx) => (
                    <div
                      key={idx}
                      className={`text-xs p-3 rounded-xl ${
                        item.role === "user"
                          ? "bg-indigo-950/40 border border-indigo-800/40 text-indigo-200 ml-8"
                          : "bg-slate-800/60 border border-slate-700/60 text-slate-200 mr-8"
                      }`}
                    >
                      <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1">
                        <span className="font-semibold uppercase tracking-wider text-slate-400">
                          {item.role === "user" ? "You" : "Jarvis Finance Voice"}
                        </span>
                        <span className="font-mono">{item.time}</span>
                      </div>
                      <p className="leading-relaxed">{item.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
