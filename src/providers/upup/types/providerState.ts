export interface ForkSource {
  sessionId: string;
  resumeAt: string;
}

export interface UpupProviderState {
  sessionId: string | null;
  agentId?: string;
  model?: string;
  provider?: string;
  forkSource?: ForkSource;
  resumeAt?: string;
  previousSessions?: string[];
}
