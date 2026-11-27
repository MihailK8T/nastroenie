(function () {
  "use strict";

  var SB_URL = "https://oyagzodrjvzncniwuxvc.supabase.co";
  var SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YWd6b2RyanZ6bmNuaXd1eHZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NDI4NzcsImV4cCI6MjExMTExODg3N30.71KSdnKSNs-YWXMVR-apD7haHhq0-HLCfvYsYcKoubk";
  var LS_KEY = "nastroenie.support.v1";
  var POLL_MS = 4000;

  var $ = function (id) { return document.getElementById(id); };
  var busy = false;
  var state = null;
  var timer = null;

  var ERRORS = {
    "bad credentials": "Неверный ник или пароль.",
    "banned": "Аккаунт заблокирован на сервере.",
    "unauthorized": "Сессия истекла — войди заново.",
    "empty message": "Сообщение пустое.",
    "no thread": "Чат ещё не создан — отправь первое сообщение.",
    "PGRST202": "Поддержка не настроена: нужно выполнить SQL из github/supabase/support.sql.",
    "PGRST301": "Поддержка не настроена: проверь ключ Supabase.",
    "42P01": "Поддержка не настроена: нет таблиц в базе."
  };

  function session() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      return raw && raw.token ? raw : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(value) {
    try {
      if (value) { localStorage.setItem(LS_KEY, JSON.stringify(value)); }
      else { localStorage.removeItem(LS_KEY); }
    } catch (e) { /* хранилище недоступно */ }
  }

  async function rpc(fn, body) {
    var resp = await fetch(SB_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body || {})
    });

    var text = "";
    try { text = await resp.text(); } catch (e) { /* ignore */ }

    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }

    if (!resp.ok) {
      var err = new Error(data && data.message ? data.message : "HTTP " + resp.status);
      err.status = resp.status;
      err.code = data && data.code;
      throw err;
    }

    return data;
  }

  function errText(err) {
    if (err.code && ERRORS[err.code]) { return ERRORS[err.code]; }
    if (ERRORS[err.message]) { return ERRORS[err.message]; }
    return "Не получилось: " + err.message;
  }

  function showMsg(id, text, kind) {
    var el = $(id);
    if (!el) { return; }
    el.textContent = text;
    el.hidden = !text;
    el.classList.remove("ok", "error");
    if (kind) { el.classList.add(kind); }
  }

  function fmtTime(ts) {
    if (!ts) { return ""; }
    try {
      return new Date(ts).toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  function messageNode(m) {
    var el = document.createElement("div");
    if (m.kind === "system") {
      el.className = "msg msg-system";
      el.appendChild(document.createTextNode(m.body));
      var t = document.createElement("span");
      t.className = "msg-time";
      t.textContent = fmtTime(m.at);
      el.appendChild(t);
      return el;
    }

    el.className = "msg " + (m.kind === "staff" ? "msg-staff" : "msg-player");

    if (m.kind === "staff" && m.author) {
      var who = document.createElement("span");
      who.className = "msg-author";
      who.textContent = m.author;
      el.appendChild(who);
    }

    el.appendChild(document.createTextNode(m.body));

    var time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = fmtTime(m.at);
    el.appendChild(time);
    return el;
  }

  function statusView() {
    var dot = $("chatDot");
    var label = "";
    dot.className = "chat-dot";
    if (!state) {
      label = "Загрузка…";
    } else if (state.status === "closed") {
      dot.classList.add("closed");
      label = "Заявка закрыта — напиши, и она откроется заново";
    } else if (state.status === "claimed") {
      dot.classList.add("busy");
      label = state.claimed ? "В работе у " + state.claimed : "Заявка в работе";
    } else {
      label = "Открыта, ждёт ответа администрации";
    }
    $("chatStatus").textContent = label;
    $("closeTicketBtn").hidden = !state || state.status === "closed";
  }

  function render() {
    if (!state) { return; }
    $("chatNick").textContent = "Аккаунт " + state.nick;
    var chatAvatar = $("chatAva");
    if (chatAvatar && window.MTAvatar) {
      chatAvatar.innerHTML = window.MTAvatar.svg(state.nick, { size: 40 });
    }
    statusView();

    var log = $("chatLog");
    var messages = state.messages || [];
    var signature = messages.length ? String(messages[messages.length - 1].id) + ":" + messages.length : "0";

    if (log.dataset.sig !== signature) {
      log.dataset.sig = signature;
      log.textContent = "";
      if (!messages.length) {
        var empty = document.createElement("div");
        empty.className = "msg msg-system";
        empty.textContent = "Сообщений пока нет — напиши первым.";
        log.appendChild(empty);
      } else {
        messages.forEach(function (m) { log.appendChild(messageNode(m)); });
      }
      log.scrollTop = log.scrollHeight;
    }
  }

  function openChat() {
    $("loginPanel").hidden = true;
    $("chatPanel").hidden = false;
    $("chatLog").dataset.sig = "";
    $("supPass").value = "";
  }

  function showLogin() {
    $("chatPanel").hidden = true;
    $("loginPanel").hidden = false;
    $("chatLog").textContent = "";
  }

  async function refresh() {
    var s = session();
    if (!s) { return; }
    try {
      state = await rpc("support_state", { p_token: s.token });
      render();
    } catch (err) {
      if (err.message === "unauthorized") {
        setSession(null);
        showLogin();
        showMsg("supMsg", "Сессия истекла — войди заново.", "error");
        return;
      }
      showMsg("chatMsg", errText(err), "error");
    }
  }

  function startPolling() {
    if (timer) { clearInterval(timer); }
    timer = setInterval(function () {
      if (!document.hidden) { refresh(); }
    }, POLL_MS);
  }

  async function onLogin(event) {
    event.preventDefault();
    if (busy) { return; }

    var nick = $("supNick").value.trim();
    var pass = $("supPass").value;

    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
      showMsg("supMsg", "Ник: 3–16 символов, латиница, цифры и «_».", "error");
      return;
    }
    if (!pass) {
      showMsg("supMsg", "Введите пароль.", "error");
      return;
    }

    busy = true;
    $("supLoginBtn").disabled = true;
    showMsg("supMsg", "", "");

    try {
      var res = await rpc("support_login", { p_name: nick, p_password: pass });
      setSession({ token: res.token, nick: res.nick });
      openChat();
      await refresh();
      startPolling();
    } catch (err) {
      showMsg("supMsg", errText(err), "error");
    } finally {
      busy = false;
      $("supLoginBtn").disabled = false;
    }
  }

  async function onSend(event) {
    event.preventDefault();
    var s = session();
    if (!s || busy) { return; }

    var field = $("chatText");
    var body = field.value.trim();
    if (!body) { return; }

    busy = true;
    $("chatSendBtn").disabled = true;
    showMsg("chatMsg", "", "");

    try {
      await rpc("support_send", { p_token: s.token, p_body: body });
      field.value = "";
      await refresh();
    } catch (err) {
      showMsg("chatMsg", errText(err), "error");
    } finally {
      busy = false;
      $("chatSendBtn").disabled = false;
    }
  }

  async function onClose() {
    var s = session();
    if (!s || busy) { return; }
    if (!window.confirm("Закрыть заявку? Написать снова можно в любой момент.")) { return; }

    busy = true;
    try {
      await rpc("support_close", { p_token: s.token });
      await refresh();
    } catch (err) {
      showMsg("chatMsg", errText(err), "error");
    } finally {
      busy = false;
    }
  }

  function onLogout() {
    setSession(null);
    state = null;
    showLogin();
    showMsg("supMsg", "Вы вышли из чата поддержки.", "ok");
  }

  function init() {
    $("supportLoginForm").addEventListener("submit", onLogin);
    $("chatForm").addEventListener("submit", onSend);
    $("closeTicketBtn").addEventListener("click", onClose);
    $("logoutBtn").addEventListener("click", onLogout);

    $("chatText").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        $("chatForm").requestSubmit();
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { refresh(); }
    });

    if (session()) {
      openChat();
      refresh();
      startPolling();
    }
  }

  init();
})();
