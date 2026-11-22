import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { buildBridgeInjection } from '../bridge/injection';
import { useNotificationBridge } from '../bridge/useNotificationBridge';
import { PAGE_LOAD_TIMEOUT_MS } from '../config';
import { DEMO_HTML } from '../demo/demoHtml';
import type { BridgeSession, BridgeState } from '../types';
import { isNativeMessage } from '../types';
import { HistoryModal } from './HistoryModal';

export interface ChatScreenProps {
  serverUrls: string[];
  token: string | null;
  onBack: () => void;
  demo?: boolean;
  // 某个地址真的连上了就回传，外层把它存成下次的首选
  onGoodUrl?: (url: string) => void;
}

export function ChatScreen({ serverUrls, token, onBack, demo, onGoodUrl }: ChatScreenProps) {
  const webRef = useRef<WebView>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<BridgeState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sessions, setSessions] = useState<BridgeSession[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);

  // [2026-11-21] 多地址：局域网 / Tailscale / 隧道可能同时只有一个通。按顺序试，
  // 加载失败就自动换下一个，全不通才把错误抛给用户。idxRef 给 onError 用（闭包拿不到最新 state）。
  const urls = useMemo(() => serverUrls, [serverUrls]);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const active = urls[Math.min(idx, Math.max(0, urls.length - 1))] ?? '';

  const goTo = useCallback((i: number) => {
    idxRef.current = i;
    setIdx(i);
  }, []);

  // 迟到的事件要能认出来自哪个地址：onError 和 onHttpError 会为同一次导航各报一次，
  // 重挂载时旧 WebView 的错误也可能晚一步到。不认地址的话会连跳两格、静默少试一个。
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const handleLoadError = useCallback(
    (msg: string, from?: string) => {
      if (from && from !== activeRef.current) return;
      const next = idxRef.current + 1;
      if (next < urls.length) {
        setLoadError(null);
        goTo(next);
      } else {
        setLoadError(urls.length > 1 ? `${msg} (tried ${urls.length} addresses)` : msg);
      }
    },
    [urls.length, goTo]
  );

  const retryAll = useCallback(() => {
    setLoadError(null);
    const wasFirst = idxRef.current === 0;
    goTo(0);
    // 已经在 0 时不会因 key 变化重挂载，才需要手动 reload；否则 reload 打在即将卸载的实例上
    if (wasFirst) webRef.current?.reload();
  }, [goTo]);

  const handleBridge = useNotificationBridge();
  const injection = useMemo(() => buildBridgeInjection(token), [token]);

  // 页面真的送回过状态才说明这条地址能用，只记一次，避免每次状态推送都写存储。
  const goodReported = useRef(false);
  useEffect(() => {
    goodReported.current = false;
  }, [active]);

  // [2026-11-22] 单地址超时。原来只靠 WebView 的 onError，而黑洞地址要等 URLSession
  // 自己超时（约 60s）才报错，N 个地址就是 N×60s 的黑屏。这里给每个地址一个独立时限：
  // 到时间还没拿到真桥状态，就当作失败换下一个。
  useEffect(() => {
    if (demo || !active) return;
    const timer = setTimeout(() => {
      if (!goodReported.current) handleLoadError('No response', active);
    }, PAGE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [active, demo, handleLoadError]);

  // iOS 后台会挂起 WKWebView（SSE + 注入桥一起断）。回前台优先让页面自己重连 SSE
  // （秒级、不重建 DOM、滚动位置和输入框都还在），2.5s 内没回执才整页 reload 兜底。
  // Demo 是本地 HTML、没有连接可断，不处理。
  const reconnected = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (demo) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const wv = webRef.current;
      if (!wv) return;
      let done = false;
      const timer = setTimeout(() => {
        if (!done) wv.reload();
      }, 2500);
      reconnected.current = () => {
        done = true;
        clearTimeout(timer);
        reconnected.current = null;
      };
      wv.injectJavaScript('try{window.__tdReconnect&&window.__tdReconnect();}catch(e){}true;');
    });
    return () => {
      sub.remove();
      reconnected.current = null;
    };
  }, [demo]);

  const runInPage = useCallback((cmd: string, arg?: unknown) => {
    const js = `try{window.__tdNative(${JSON.stringify(cmd)}, ${JSON.stringify(arg ?? null)});}catch(e){}true;`;
    webRef.current?.injectJavaScript(js);
  }, []);

  const onMessage = useCallback(
    (raw: string) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (isNativeMessage(msg)) {
        if (msg.type === 'td-reconnected') {
          reconnected.current?.();
        } else if (msg.type === 'td-sessions') {
          setSessions(msg.sessions ?? []);
          setHistoryLoading(false);
        } else if (msg.type === 'td-resumed') {
          setApprovalBusy(false);
        } else if (msg.type === 'td-approved') {
          setApprovalBusy(false);
          setBridgeState((prev) =>
            prev ? { ...prev, hasApproval: false, approvalRequestId: null, approvalText: null } : prev
          );
        } else if (msg.type === 'td-error') {
          setHistoryLoading(false);
          setApprovalBusy(false);
        }
        return;
      }
      // [2026-11-22] 只有真桥才认。注入脚本在任何页面上都会 post，酒店门户、Cloudflare
      // 登录页这类返回 200 的陌生页面会发一条 src:'dom' 的假状态；以前它被当作"连上了"
      // 并写回存储排到第一位，下次冷启动直接进那个页面。src==='state' 只在页面拿到
      // SSE 快照后出现，是现成可用的真桥判据。
      // 只认 src==='state'：注入脚本够到页面顶层 state 对象时才置这个值，而那是桥页面独有的。
      // 不再额外要求 status 是字符串 —— status 有可能是 null，那会让可用地址被判死。
      const s = msg as BridgeState;
      if (s && typeof s === 'object' && s.src === 'state') {
        setLoadError(null);
        if (!goodReported.current) {
          goodReported.current = true;
          onGoodUrl?.(active);
        }
      }
      setBridgeState(s);
      handleBridge(raw);
    },
    [handleBridge, onGoodUrl, active]
  );

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setSessions([]);
    runInPage('sessions');
  };

  const pickSession = (s: BridgeSession) => {
    setHistoryOpen(false);
    setHistoryLoading(true);
    runInPage('resume', { project: s.project, resumeId: s.id });
  };

  const decide = (decision: 'allow' | 'deny') => {
    const requestId = bridgeState?.approvalRequestId;
    if (!requestId) return;
    setApprovalBusy(true);
    runInPage('approve', { requestId, decision });
  };

  const showApproval = !demo && !!bridgeState?.hasApproval && !!bridgeState?.approvalRequestId;

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.headerBtn}>‹ Back</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.url}>
          {demo ? 'Demo mode' : active.replace(/^https?:\/\//, '')}
        </Text>
        <View style={styles.headerRight}>
          <Pressable onPress={openHistory} hitSlop={8} style={styles.headerAction}>
            <Text style={styles.headerBtn}>History</Text>
          </Pressable>
          {demo ? null : (
            <Pressable onPress={() => webRef.current?.reload()} hitSlop={8} style={styles.headerAction}>
              <Text style={styles.headerBtn}>⟳</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      {loadError ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={retryAll}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {showApproval ? (
        <View style={styles.approvalBar}>
          <Text numberOfLines={2} style={styles.approvalText}>
            {bridgeState?.approvalText || 'Approval requested'}
          </Text>
          <View style={styles.approvalActions}>
            <Pressable
              style={[styles.approvalBtn, styles.denyBtn]}
              disabled={approvalBusy}
              onPress={() => decide('deny')}
            >
              <Text style={styles.denyText}>Deny</Text>
            </Pressable>
            <Pressable
              style={[styles.approvalBtn, styles.allowBtn]}
              disabled={approvalBusy}
              onPress={() => decide('allow')}
            >
              {approvalBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.allowText}>Allow</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      <WebView
        ref={webRef}
        key={demo ? 'demo' : active} // 换地址干净重挂载 → token 变更生效
        source={demo ? { html: DEMO_HTML } : { uri: active + '/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false} // 挡 target=_blank / window.open
        pullToRefreshEnabled={false}
        contentInsetAdjustmentBehavior="never" // 页面自己管 safe-area（env()）
        injectedJavaScriptBeforeContentLoaded={demo ? undefined : injection}
        onMessage={(e) => onMessage(e.nativeEvent.data)}
        onHttpError={
          demo ? undefined : (s) => handleLoadError('HTTP ' + s.nativeEvent.statusCode, active)
        }
        onError={
          demo
            ? undefined
            : (s) => handleLoadError(s.nativeEvent.description ?? 'Failed to load', active)
        }
        style={styles.web}
      />

      <HistoryModal
        visible={historyOpen}
        loading={historyLoading}
        sessions={sessions}
        onClose={() => setHistoryOpen(false)}
        onPick={pickSession}
        demo={demo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111418' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1c2128',
  },
  headerBtn: { color: '#3178c6', fontSize: 16, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { marginLeft: 14 },
  url: { color: '#8b94a3', fontSize: 13, flex: 1, textAlign: 'center', marginHorizontal: 12 },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#3a2222',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: { color: '#fca5a5', fontSize: 13, flex: 1 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 12 },
  approvalBar: {
    backgroundColor: '#2a2416',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#4a3d1e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  approvalText: { color: '#f5d98b', fontSize: 13, flex: 1, marginRight: 12 },
  approvalActions: { flexDirection: 'row' },
  approvalBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 8 },
  denyBtn: { backgroundColor: '#3a2222' },
  allowBtn: { backgroundColor: '#2f6f3e', minWidth: 62, alignItems: 'center' },
  denyText: { color: '#fca5a5', fontSize: 14, fontWeight: '700' },
  allowText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  web: { flex: 1, backgroundColor: '#111418' },
});
