import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DEFAULT_SERVER_URL } from './src/config';
import { loadServerUrls, loadToken, saveServerUrls, saveToken } from './src/storage';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ChatScreen } from './src/screens/ChatScreen';

// 前台通知展示策略（SDK 57 形状）：横幅 + 列表 + 声音
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Route = { name: 'settings' } | { name: 'chat' } | { name: 'demo' };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'settings' });
  const [serverUrls, setServerUrls] = useState<string[]>(
    DEFAULT_SERVER_URL ? [DEFAULT_SERVER_URL] : []
  );
  const [token, setToken] = useState<string | null>(null);
  // 仅给设置页当初值用：连上的地址排到前面，但不动 serverUrls（避免 WebView 重挂载）
  const [preferred, setPreferred] = useState<string[] | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [u, t] = await Promise.all([loadServerUrls(), loadToken()]);
        if (u.length) setServerUrls(u);
        setToken(t);
        // [2026-11-19] 有保存的地址就直接进聊天页: 冷启动不再停在设置页等着点一下。
        // [2026-11-22] 不再要求口令非空 —— 桥可以不开鉴权，设置页的测试也把 200 当"连上了"。
        // 设置页仍可从聊天页的 Back 回去改。
        if (u.length) setRoute({ name: 'chat' });
      } finally {
        setBooted(true);
      }
      // 通知授权放到启动之后,别让它挡首屏
      void (async () => {
        try {
          const p = await Notifications.getPermissionsAsync();
          if (!p.granted) await Notifications.requestPermissionsAsync();
        } catch {
          // 授权失败不影响使用
        }
      })();
    })();
  }, []);

  const handleConnect = (urls: string[], tok: string | null) => {
    setPreferred(null);
    setServerUrls(urls);
    setToken(tok);
    void saveServerUrls(urls);
    void saveToken(tok);
    setRoute({ name: 'chat' });
  };

  // 哪个地址真的连上了，就把它排到第一位 —— 下次冷启动直接命中，不用再从死地址开始试。
  // 同时写一份 preferred 给设置页当初始值：只改这次渲染用的 serverUrls 会让 ChatScreen
  // 的列表错位、WebView 白重挂一次，但完全不更新又会让用户从设置页原样点回来时，
  // 把刚记住的顺序用旧值覆盖掉。
  const handleGoodUrl = (url: string) => {
    const next = [url, ...serverUrls.filter((u) => u !== url)];
    setPreferred(next);
    void saveServerUrls(next);
  };

  if (!booted) {
    return <View style={styles.center} />;
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        {route.name === 'settings' ? (
          <SettingsScreen
            initialUrls={preferred ?? serverUrls}
            initialToken={token}
            onConnect={handleConnect}
            onTryDemo={() => setRoute({ name: 'demo' })}
          />
        ) : route.name === 'demo' ? (
          <ChatScreen
            serverUrls={serverUrls}
            token={null}
            demo
            onBack={() => setRoute({ name: 'settings' })}
          />
        ) : (
          <ChatScreen
            serverUrls={serverUrls}
            token={token}
            onBack={() => setRoute({ name: 'settings' })}
            onGoodUrl={handleGoodUrl}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111418' },
  center: { flex: 1, backgroundColor: '#111418' },
});
