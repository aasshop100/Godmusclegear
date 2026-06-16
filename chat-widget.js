(function () {
  var WEBHOOK_URL = 'https://ai.godmusclegears.com/webhook/godmuscle-trt-chatbot/chat';
  var SESSION_ID = localStorage.getItem('gmg-session-id');
  if (!SESSION_ID) {
    SESSION_ID = 'gmg-' + Math.random().toString(36).substr(2, 12);
    localStorage.setItem('gmg-session-id', SESSION_ID);
  }

  var isOpen = false;
  var isTyping = false;

  var STORAGE_KEY = 'gmg-chat-history';

  var SESSION_EXPIRY = 60 * 60 * 1000; // 1 hour

  function saveMessages() {
    var msgs = document.getElementById('gmg-messages');
    if (!msgs) return;
    var items = [];
    msgs.querySelectorAll('.gmg-msg-bot, .gmg-msg-user').forEach(function (el) {
      items.push({ type: el.className, text: el.textContent });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now(), items: items }));
  }

  function loadMessages() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    try {
      var data = JSON.parse(saved);
      if (!data.items || !data.items.length) return false;
      if (Date.now() - data.ts > SESSION_EXPIRY) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('gmg-session-id');
        SESSION_ID = 'gmg-' + Math.random().toString(36).substr(2, 12);
        localStorage.setItem('gmg-session-id', SESSION_ID);
        return false;
      }
      data.items.forEach(function (item) {
        var el = document.createElement('div');
        el.className = item.type;
        el.textContent = item.text;
        document.getElementById('gmg-messages').appendChild(el);
      });
      scrollToBottom();
      return true;
    } catch (e) { return false; }
  }

  function injectStyles() {
    var css = `
      #gmg-chat-btn {
        position: fixed;
        bottom: 214px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #FF4500;
        border: none;
        cursor: pointer;
        z-index: 10000;
        box-shadow: 0 4px 16px rgba(255,69,0,0.55);
        padding: 0;
        overflow: hidden;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #gmg-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(255,69,0,0.7); }
      #gmg-chat-btn img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
      #gmg-chat-pulse {
        position: fixed;
        bottom: 258px;
        right: 24px;
        width: 12px;
        height: 12px;
        background: #22c55e;
        border-radius: 50%;
        border: 2px solid #fff;
        z-index: 10001;
        pointer-events: none;
      }
      #gmg-chat-window {
        position: fixed;
        bottom: 280px;
        right: 24px;
        width: 340px;
        max-height: 480px;
        background: #111;
        border-radius: 16px;
        border: 1px solid #2a2a2a;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: scale(0.92) translateY(20px);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s ease;
        transform-origin: bottom right;
      }
      #gmg-chat-window.gmg-open {
        transform: scale(1) translateY(0);
        opacity: 1;
        pointer-events: all;
      }
      #gmg-chat-header {
        background: #FF4500;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
      #gmg-chat-avatar {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: #fff;
        overflow: hidden;
        flex-shrink: 0;
        border: 2px solid rgba(255,255,255,0.35);
      }
      #gmg-chat-avatar img { width: 100%; height: 100%; object-fit: cover; }
      #gmg-chat-header-text { flex: 1; }
      #gmg-chat-header-text strong { display: block; color: #fff; font-size: 14px; font-weight: 700; font-family: inherit; }
      #gmg-chat-header-text span { color: rgba(255,255,255,0.8); font-size: 11px; display: flex; align-items: center; gap: 4px; margin-top: 1px; }
      #gmg-status-dot { width: 6px; height: 6px; background: #4ade80; border-radius: 50%; display: inline-block; flex-shrink: 0; }
      #gmg-close-btn {
        background: none;
        border: none;
        color: rgba(255,255,255,0.8);
        font-size: 20px;
        cursor: pointer;
        padding: 0 0 2px 0;
        line-height: 1;
        flex-shrink: 0;
      }
      #gmg-close-btn:hover { color: #fff; }
      #gmg-messages {
        flex: 1;
        overflow-y: auto;
        padding: 14px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 220px;
        max-height: 320px;
        scroll-behavior: smooth;
      }
      #gmg-messages::-webkit-scrollbar { width: 4px; }
      #gmg-messages::-webkit-scrollbar-track { background: transparent; }
      #gmg-messages::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      .gmg-msg-bot, .gmg-msg-user {
        max-width: 85%;
        padding: 8px 12px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
      }
      .gmg-msg-bot {
        background: #222;
        border: 1px solid #2e2e2e;
        border-radius: 4px 12px 12px 12px;
        color: #e5e5e5;
        align-self: flex-start;
      }
      .gmg-msg-user {
        background: #FF4500;
        border-radius: 12px 4px 12px 12px;
        color: #fff;
        align-self: flex-end;
      }
      .gmg-typing {
        background: #222;
        border: 1px solid #2e2e2e;
        border-radius: 4px 12px 12px 12px;
        padding: 10px 14px;
        align-self: flex-start;
        display: flex;
        gap: 5px;
        align-items: center;
      }
      .gmg-dot {
        width: 7px; height: 7px;
        background: #666;
        border-radius: 50%;
        animation: gmgBounce 1.2s infinite ease-in-out;
      }
      .gmg-dot:nth-child(2) { animation-delay: 0.2s; }
      .gmg-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes gmgBounce {
        0%, 80%, 100% { transform: translateY(0); background: #555; }
        40% { transform: translateY(-5px); background: #FF4500; }
      }
      #gmg-input-row {
        background: #0d0d0d;
        border-top: 1px solid #222;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      #gmg-input {
        flex: 1;
        background: #1e1e1e;
        border: 1px solid #2e2e2e;
        border-radius: 20px;
        padding: 8px 14px;
        font-size: 13px;
        color: #e5e5e5;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s;
      }
      #gmg-input::placeholder { color: #555; }
      #gmg-input:focus { border-color: #FF4500; }
      #gmg-send-btn {
        width: 34px; height: 34px;
        background: #FF4500;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background 0.15s, transform 0.15s;
      }
      #gmg-send-btn:hover { background: #e03d00; transform: scale(1.08); }
      #gmg-send-btn svg { width: 16px; height: 16px; fill: #fff; }
      @media (max-width: 575px) {
        #gmg-chat-btn { bottom: 182px; right: 16px; width: 50px; height: 50px; }
        #gmg-chat-pulse { bottom: 224px; right: 16px; }
        #gmg-chat-window { bottom: 244px; right: 10px; left: 10px; width: auto; }
      }
    `;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildHTML() {
    var img = 'images/trtspecialist.png';

    var btn = document.createElement('button');
    btn.id = 'gmg-chat-btn';
    btn.title = 'Chat with our TRT Specialist';
    btn.innerHTML = '<img src="' + img + '" alt="TRT Specialist">';

    var pulse = document.createElement('div');
    pulse.id = 'gmg-chat-pulse';

    var win = document.createElement('div');
    win.id = 'gmg-chat-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', 'TRT Specialist Chat');
    win.innerHTML = `
      <div id="gmg-chat-header">
        <div id="gmg-chat-avatar"><img src="${img}" alt="TRT Specialist"></div>
        <div id="gmg-chat-header-text">
          <strong>TRT Specialist</strong>
          <span><span id="gmg-status-dot"></span> Online now &mdash; God Muscle Gears</span>
        </div>
        <button id="gmg-close-btn" aria-label="Close chat">&times;</button>
      </div>
      <div id="gmg-messages"></div>
      <div id="gmg-input-row">
        <input id="gmg-input" type="text" placeholder="Ask about cycles, pricing..." autocomplete="off" maxlength="500">
        <button id="gmg-send-btn" aria-label="Send message">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(pulse);
    document.body.appendChild(win);

    if (!loadMessages()) {
      addBotMessage("Hey! I'm your TRT Specialist at God Muscle Gears. Ask me about cycles, compounds, peptides, or pricing.");
    }

    btn.addEventListener('click', toggleChat);
    document.getElementById('gmg-close-btn').addEventListener('click', closeChat);
    document.getElementById('gmg-send-btn').addEventListener('click', sendMessage);
    document.getElementById('gmg-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendMessage();
    });
  }

  function toggleChat() {
    isOpen ? closeChat() : openChat();
  }

  function openChat() {
    isOpen = true;
    document.getElementById('gmg-chat-window').classList.add('gmg-open');
    setTimeout(function () {
      document.getElementById('gmg-input').focus();
    }, 250);
    scrollToBottom();
  }

  function closeChat() {
    isOpen = false;
    document.getElementById('gmg-chat-window').classList.remove('gmg-open');
  }

  function formatBotText(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/(\d+)\.\s+/g, '<br><strong>$1.</strong> ')
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>')
      .replace(/^<br>/, '');
  }

  function addBotMessage(text) {
    var el = document.createElement('div');
    el.className = 'gmg-msg-bot';
    el.innerHTML = formatBotText(text);
    document.getElementById('gmg-messages').appendChild(el);
    scrollToBottom();
    saveMessages();
  }

  function addUserMessage(text) {
    var el = document.createElement('div');
    el.className = 'gmg-msg-user';
    el.textContent = text;
    document.getElementById('gmg-messages').appendChild(el);
    scrollToBottom();
    saveMessages();
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'gmg-typing';
    el.id = 'gmg-typing';
    el.innerHTML = '<div class="gmg-dot"></div><div class="gmg-dot"></div><div class="gmg-dot"></div>';
    document.getElementById('gmg-messages').appendChild(el);
    scrollToBottom();
  }

  function removeTyping() {
    var el = document.getElementById('gmg-typing');
    if (el) el.remove();
  }

  function scrollToBottom() {
    var msgs = document.getElementById('gmg-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function sendMessage() {
    if (isTyping) return;
    var input = document.getElementById('gmg-input');
    var text = input.value.trim();
    if (!text) return;

    input.value = '';
    addUserMessage(text);
    isTyping = true;
    showTyping();

    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendMessage',
        sessionId: SESSION_ID,
        chatInput: text
      })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      removeTyping();
      isTyping = false;
      var reply = (data && data.output) ? data.output
                : (data && data.text) ? data.text
                : (data && data.message) ? data.message
                : 'Sorry, I had trouble connecting. Try again.';
      addBotMessage(reply);
    })
    .catch(function () {
      removeTyping();
      isTyping = false;
      addBotMessage('Connection issue. Please try again in a moment.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { injectStyles(); buildHTML(); });
  } else {
    injectStyles();
    buildHTML();
  }
})();
