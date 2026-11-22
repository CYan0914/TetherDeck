import { useCallback, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { APP_NAME } from '../config';
import type { BridgeState } from '../types';

const COOLDOWN_MS = 20000; // 每事件类型冷却，防抖

type Kind = 'approval' | 'done' | 'error';

// 桥消息 → 去重后的本地通知。首条消息只 seed 不通知；跃迁链严格上升沿防刷屏。
export function useNotificationBridge() {
  const prevRef = useRef<BridgeState | null>(null);
  const seededRef = useRef(false);
  const cooldownRef = useRef<Record<string, number>>({});

  const fire = useCallback(async (kind: Kind, next: BridgeState) => {
    const now = Date.now();
    if (cooldownRef.current[kind] && now - cooldownRef.current[kind] < COOLDOWN_MS) return;
    cooldownRef.current[kind] = now;

    const body =
      kind === 'approval'
        ? '🔐 ' + (next.approvalText || 'Claude 等待你的审批')
        : kind === 'done'
          ? '✅ Claude 已完成任务' + (next.lastAssistantText ? '：' + next.lastAssistantText : '')
          : '⚠️ ' + (next.lastError || 'Claude 出错');
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: APP_NAME, body, sound: 'default' },
        trigger: null,
      });
    } catch (e) {
      console.warn('notify failed', e);
    }
  }, []);

  const handle = useCallback(
    (raw: string) => {
      let next: BridgeState;
      try {
        next = JSON.parse(raw);
      } catch {
        return;
      }
      if (!seededRef.current) {
        prevRef.current = next;
        seededRef.current = true;
        return;
      }
      const prev = prevRef.current;
      prevRef.current = next;
      if (!prev) return;
      // 换了会话（新任务）→ 静默 reseed，避免旧会话残留状态误报
      if (next.sessionId && prev.sessionId && next.sessionId !== prev.sessionId) return;

      if (next.status === 'permission' && prev.status !== 'permission') {
        void fire('approval', next);
        return;
      }
      // 用 assistantCount（而非 messageCount）防 tool_result / user 消息误报
      if (prev.status === 'running' && next.status === 'idle' && next.assistantCount > prev.assistantCount) {
        void fire('done', next);
        return;
      }
      if (next.status === 'error' && prev.status !== 'error') {
        void fire('error', next);
        return;
      }
      // running 中 lastError 变化（如「任务运行超过8分钟」看门狗）
      if (next.lastError && next.lastError !== prev.lastError && prev.status === 'running') {
        void fire('error', next);
      }
    },
    [fire],
  );

  return handle;
}
