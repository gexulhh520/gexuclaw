export type AgentStatus = "online" | "busy" | "idle";

export type WorkspaceType = "writing" | "browser" | "research" | "video";

export type CoordinationMode = "auto" | "sequential" | "parallel" | "lead_agent";

export interface SidebarAgent {
  id: string;
  name: string;
  short: string;
  avatar: string;
  description: string;
  status: AgentStatus;
  workspaceType: WorkspaceType;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
}

// Session-level coordination stays on the session model so UI and orchestration
// read from the same source of truth later.
export interface SessionCoordinationConfig {
  mode: CoordinationMode;
  leadAgentId: string | null;
  allowOverlap: boolean;
  finalResponder: "main_agent";
  userNote: string;
}

export interface SessionItem {
  id: string;
  title: string;
  description?: string;
  updatedAt: string;
  agentIds: string[];
  coordination?: SessionCoordinationConfig;
  messages: ChatMessage[];
}

export interface ProjectSpace {
  id: string;
  name: string;
  icon: string;
  sessions: SessionItem[];
}
