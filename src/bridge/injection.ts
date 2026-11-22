// 注入到 WebView 页面的桥脚本（injectedJavaScriptBeforeContentLoaded，页面内联脚本之前运行）：
//  1. token 自动登录 —— 关键：服务器认证靠 HttpOnly `session` cookie（仅 POST /api/login 创建），
//     仅写 localStorage.ccb_token 不生效。需同源 fetch /api/login 建 cookie 后调 window.start() 重连。
//     时间戳节流避免循环，服务端重启（cookie 全失效）后 reload 会自动重试。
//  2. 状态轮询 —— 页面顶层 `let state` 是全局词法绑定，注入脚本可按名读取；
//     MutationObserver 监听 #dot/#chat 作为 DOM 兜底。
//  3. 仅在状态变化时 postMessage 到原生层（window.ReactNativeWebView）。
export function buildBridgeInjection(token: string | null): string {
  const tokenLiteral = token ? JSON.stringify(token) : 'null';
  return `(function(){
  'use strict';
  try { if (window.__ccbBridgeInstalled) return; window.__ccbBridgeInstalled = true; } catch(e){}

  var token = ${tokenLiteral};
  /* 语音输入需要口令走 X-Auth-Token 调 /api/transcribe; 没有口令就不显示麦克风 */
  try { window.__tdVoiceSupported = ${token ? 'true' : 'false'}; } catch(e){}
  var post = function(obj){
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    } catch(e){}
  };

  /* ---- auto-login: 建 HttpOnly session cookie，然后调页面自己的 start() ---- */
  if (token) {
    var now = Date.now();
    var lastLogin = 0;
    try { lastLogin = parseInt(sessionStorage.getItem('ccb_autologin_last') || '0', 10) || 0; } catch(e){}
    if (now - lastLogin > 5000) {
      try {
        fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        })
          .then(function(r){
            if (r.ok) {
              try { sessionStorage.setItem('ccb_autologin_last', String(Date.now())); } catch(e){}
              try {
                if (typeof window.start === 'function') { window.start(); }
                else { window.location.reload(); }
              } catch(e){ try { window.location.reload(); } catch(e2){} }
            }
          })
          .catch(function(){});
      } catch(e){}
    }
  }

  /* ---- state bridge ---- */
  var last = null;
  var compute = function(){
    var out = {
      status:null, messageCount:0, assistantCount:0, hasApproval:false,
      lastError:null, lastAssistantText:null, approvalText:null, approvalRequestId:null,
      sessionId:null, src:'state'
    };
    var ok = false;
    try { ok = (typeof state !== 'undefined' && state !== null); } catch(e){}

    if (ok) {
      var s = state;
      out.status = s.status || null;
      out.sessionId = s.sessionId || null;
      out.lastError = s.lastError || null;
      var msgs = s.messages || [];
      out.messageCount = msgs.length;
      for (var i = msgs.length - 1; i >= 0; i--) {
        var m = msgs[i];
        if (!m) continue;
        if (m.role === 'assistant') {
          out.assistantCount++;
          if (out.lastAssistantText === null) {
            out.lastAssistantText = String(m.text || '').slice(0, 80) || null;
          }
        } else if (m.role === 'approval') {
          out.hasApproval = true;
          if (out.approvalText === null) {
            var card = m.card || {};
            out.approvalText = card.isQuestion ? 'Claude 向你提问' : ('请求权限: ' + (card.toolName || '未知工具'));
            out.approvalRequestId = card.requestId || null;
          }
        }
      }
    } else {
      /* DOM 兜底：即使页面不再暴露 state 变量也能派生通知数据 */
      out.src = 'dom';
      var dot = document.getElementById('dot');
      if (dot) {
        var cls = dot.className || '';
        var m2 = cls.match(/(^|\\s)dot\\s+([\\w-]+)/);
        if (m2) out.status = m2[2];
      }
      var chat = document.getElementById('chat');
      if (chat) {
        var nodes = chat.querySelectorAll('.msg');
        out.messageCount = nodes.length;
        for (var j = nodes.length - 1; j >= 0; j--) {
          var n = nodes[j];
          if (n.classList.contains('assistant')) {
            out.assistantCount++;
            if (out.lastAssistantText === null) out.lastAssistantText = (n.textContent || '').slice(0, 80) || null;
          }
          if (n.classList.contains('approval')) {
            out.hasApproval = true;
            if (out.approvalText === null) out.approvalText = 'Claude 等待审批';
          }
        }
      }
    }

    var key = JSON.stringify(out);
    if (key !== last) { last = key; post(out); }   /* 仅变化时发 */
  };

  try { setTimeout(compute, 300); } catch(e){}
  try { setInterval(compute, 1000); } catch(e){}
  try {
    if (window.MutationObserver) {
      var watch = function(el, opts){ if (!el) return; try { new MutationObserver(function(){ try { compute(); } catch(e){} }).observe(el, opts); } catch(e){} };
      watch(document.getElementById('dot'), { attributes:true, attributeFilter:['class'] });
      watch(document.getElementById('chat'), { childList:true, subtree:true });
      if (!document.getElementById('chat')) watch(document.body, { childList:true, subtree:true });
    }
  } catch(e){}

  try { window.__ccbBridgeReady = true; } catch(e){}
})();`;
}
