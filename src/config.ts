export const APP_NAME = 'TetherDeck';

// 不预填任何地址：桥跑在用户自己的机器上，地址只有用户知道。
// 首次运行停在设置页，填局域网地址（同一 WiFi）或 Tailscale / 隧道地址（在外）。
export const DEFAULT_SERVER_URL = '';

export const CONNECT_TIMEOUT_MS = 8000;

// [2026-11-22] 单个地址等多久没等到真桥信号就换下一个。
// 不能靠 WebView 自己的 onError：黑洞地址要等 URLSession 的 60s 才报错。
export const PAGE_LOAD_TIMEOUT_MS = 15000;
