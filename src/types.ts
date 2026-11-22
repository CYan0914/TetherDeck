// 注入桥 postMessage 到原生层的状态快照（仅变化时发）
export interface BridgeState {
  status: string | null;
  messageCount: number;
  assistantCount: number;
  hasApproval: boolean;
  lastError: string | null;
  lastAssistantText: string | null;
  approvalText: string | null;
  approvalRequestId: string | null;
  sessionId: string | null;
  src?: 'state' | 'dom';
}

// 页面里 window.__tdNative 回给原生壳的应答
export interface NativeMessage {
  type:
    | 'td-sessions'
    | 'td-resumed'
    | 'td-approved'
    | 'td-error'
    | 'td-reconnected'
    | 'td-voice-start'
    | 'td-voice-stop';
  sessions?: BridgeSession[];
  ok?: boolean;
  cmd?: string;
  message?: string;
}

export interface BridgeSession {
  id: string;
  title?: string | null;
  firstMsg?: string | null;
  project: string;
  model?: string | null;
  size?: number;
  lastAt?: number;
}

export function isNativeMessage(v: unknown): v is NativeMessage {
  return !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string'
    && (v as { type: string }).type.startsWith('td-');
}
