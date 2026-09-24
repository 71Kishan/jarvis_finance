export type WorkspaceView =
  | "TERMINAL"
  | "MARKETS"
  | "PORTFOLIO"
  | "AUTOMATION"
  | "RESEARCH"
  | "PRACTICE"
  | "SETTINGS";

export const WORKSPACE_LABELS: Record<WorkspaceView, string> = {
  TERMINAL: "Terminal",
  MARKETS: "Markets",
  PORTFOLIO: "Portfolio",
  AUTOMATION: "Automation",
  RESEARCH: "Research",
  PRACTICE: "Practice Lab",
  SETTINGS: "Settings",
};
