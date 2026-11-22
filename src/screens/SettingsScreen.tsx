import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CONNECT_TIMEOUT_MS } from '../config';

export interface SettingsScreenProps {
  initialUrls: string[];
  initialToken: string | null;
  onConnect: (urls: string[], token: string | null) => void;
  onTryDemo: () => void;
}

function normalizeUrl(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : 'http://' + s;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

// [2026-11-21] 允许一次填多个地址（局域网 / Tailscale / 隧道），逗号或换行分隔。
// 聊天页会按顺序试，哪个能通就用哪个 —— 出门在外 Tailscale 掉了也不会卡死。
export function parseUrls(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\n\r;]+/)) {
    const u = normalizeUrl(part);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

export function SettingsScreen({ initialUrls, initialToken, onConnect, onTryDemo }: SettingsScreenProps) {
  const [url, setUrl] = useState(initialUrls.join('\n'));
  const [token, setToken] = useState(initialToken ?? '');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const urls = parseUrls(url);

  // 逐个试，报第一个通的；全不通就把各自的错误拼起来，方便判断是网络还是服务没起。
  const testConnection = async () => {
    if (!urls.length) {
      setResult({ ok: false, msg: 'Enter a valid http(s) address.' });
      return;
    }
    setTesting(true);
    setResult(null);
    const errors: string[] = [];
    try {
      for (const base of urls) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
        try {
          const res = await fetch(base + '/api/state', { signal: controller.signal });
          if (res.status === 401) {
            setResult({ ok: true, msg: '✓ Reachable — token required · ' + base });
            return;
          }
          if (res.status === 200) {
            const d = (await res.json().catch(() => null)) as
              | { status?: string; project?: string; messages?: unknown[] }
              | null;
            const looksLikeBridge = !!d && ('status' in d || 'project' in d || 'messages' in d);
            if (!looksLikeBridge) {
              errors.push(base + ': not a TetherDeck bridge');
            } else {
              setResult({
                ok: true,
                msg:
                  '✓ Connected · ' +
                  base +
                  (d?.status ? ' · ' + d.status : '') +
                  (d?.project ? ' · ' + d.project : ''),
              });
              return;
            }
          } else {
            errors.push(base + ': HTTP ' + res.status);
          }
        } catch (e) {
          errors.push(base + ': ' + ((e as Error).message || String(e)));
        } finally {
          clearTimeout(timer);
        }
      }
      setResult({ ok: false, msg: '✗ Cannot connect\n' + errors.join('\n') });
    } finally {
      setTesting(false);
    }
  };

  const valid = urls.length > 0;

  const connect = () => {
    if (!urls.length) {
      setResult({ ok: false, msg: 'Enter a valid http(s) address.' });
      return;
    }
    onConnect(urls, token.trim() || null);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>TetherDeck</Text>
        <Text style={styles.subtitle}>Claude Code on your computer, from your phone</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Bridge server address</Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          value={url}
          onChangeText={setUrl}
          placeholder={'http://192.168.1.20:8789\nhttp://100.64.0.1:8789'}
          placeholderTextColor="#5c6470"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          multiline
        />
        <Text style={styles.hint}>
          Run the TetherDeck bridge on your computer (port 8789). You can list more than one address, one per
          line or comma separated — the app tries them in order and uses the first that answers. Put the LAN
          address first to use it at home, and a Tailscale / tunnel address for when you are away.
        </Text>

        <Text style={styles.label}>Access token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="Token from the bridge config"
          placeholderTextColor="#5c6470"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Pressable style={styles.testBtn} onPress={testConnection} disabled={testing || !valid}>
          {testing ? <ActivityIndicator color="#cbd5e1" /> : <Text style={styles.testText}>Test connection</Text>}
        </Pressable>
        {result ? (
          <Text style={[styles.result, result.ok ? styles.resultOk : styles.resultBad]}>{result.msg}</Text>
        ) : null}

        <Pressable style={[styles.connectBtn, !valid && styles.btnDisabled]} disabled={!valid} onPress={connect}>
          <Text style={styles.connectText}>Open console</Text>
        </Pressable>

        <View style={styles.divider} />

        <Pressable style={styles.demoBtn} onPress={onTryDemo}>
          <Text style={styles.demoText}>Try demo — no server needed</Text>
        </Pressable>
        <Text style={styles.demoHint}>Loads bundled sample data so you can explore the app offline.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111418' },
  header: { paddingTop: 72, paddingHorizontal: 24, paddingBottom: 8 },
  title: { color: '#f2f5f9', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#8b94a3', fontSize: 14, marginTop: 6 },
  body: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  label: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: '#1c2128',
    color: '#f2f5f9',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2a303a',
  },
  inputMulti: { minHeight: 76, textAlignVertical: 'top' },
  hint: { color: '#5c6470', fontSize: 12, marginTop: 8, lineHeight: 18 },
  testBtn: {
    marginTop: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a303a',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#1c2128',
  },
  testText: { color: '#cbd5e1', fontSize: 15, fontWeight: '600' },
  result: { fontSize: 13, marginTop: 12, lineHeight: 19 },
  resultOk: { color: '#4ade80' },
  resultBad: { color: '#f87171' },
  connectBtn: {
    marginTop: 24,
    borderRadius: 12,
    backgroundColor: '#3178c6',
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  connectText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#2a303a', marginVertical: 26 },
  demoBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3178c6',
    paddingVertical: 14,
    alignItems: 'center',
  },
  demoText: { color: '#7fb3e8', fontSize: 15, fontWeight: '700' },
  demoHint: { color: '#5c6470', fontSize: 12, marginTop: 10, textAlign: 'center' },
});
