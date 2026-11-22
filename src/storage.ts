import * as SecureStore from 'expo-secure-store';

const KEY_SERVER_URL = 'ccr_server_url';
const KEY_SERVER_URLS = 'ccr_server_urls'; // [2026-11-21] 多地址：局域网 + Tailscale
const KEY_TOKEN = 'ccr_token';

// 旧版只存了一个地址；读到数组就读数组，读不到就退回单个地址，老用户升级不丢配置。
export async function loadServerUrls(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY_SERVER_URLS);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const clean = list.filter((u): u is string => typeof u === 'string' && !!u.trim());
        if (clean.length) return clean;
      }
    }
  } catch {
    // 落到旧键
  }
  const one = await loadServerUrl();
  return one ? [one] : [];
}

export async function saveServerUrls(urls: string[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY_SERVER_URLS, JSON.stringify(urls));
    // 首个地址写回旧键，回退到单地址逻辑时也能用
    if (urls[0]) await SecureStore.setItemAsync(KEY_SERVER_URL, urls[0]);
  } catch {
    // 忽略：SecureStore 失败不阻塞主流程
  }
}

export async function loadServerUrl(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_SERVER_URL);
  } catch {
    return null;
  }
}

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_TOKEN);
  } catch {
    return null;
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY_SERVER_URL, url);
  } catch {
    // 忽略
  }
}

export async function saveToken(token: string | null): Promise<void> {
  try {
    if (token) {
      await SecureStore.setItemAsync(KEY_TOKEN, token);
    } else {
      await SecureStore.deleteItemAsync(KEY_TOKEN);
    }
  } catch {
    // 忽略
  }
}
