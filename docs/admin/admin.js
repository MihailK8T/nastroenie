(function () {
  "use strict";

  var SB_URL = "https://oyagzodrjvzncniwuxvc.supabase.co";
  var SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YWd6b2RyanZ6bmNuaXd1eHZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NDI4NzcsImV4cCI6MjExMTExODg3N30.71KSdnKSNs-YWXMVR-apD7haHhq0-HLCfvYsYcKoubk";
  var SS_KEY = "nastroenie.staff.v1";

  var $ = function (id) { return document.getElementById(id); };
  var staff = null;
  var token = null;
  var tab = "tickets";
  var filter = "";
  var threads = [];
  var activeId = null;
  var activeThread = null;
  var threadTimer = null;
  var listTimer = null;

  var ROLE = { owner: "владелец", admin: "админ", moderator: "модератор" };
  var STATUS = { open: "открыта", claimed: "в работе", closed: "закрыта" };

  var ERRORS = {
    "bad credentials": "Неверный логин или пароль.",
    "unauthorized": "Сессия истекла — войди заново.",
    "forbidden": "Недостаточно прав.",
    "already configured": "Владелец уже создан — войди по логину.",
    "bad login": "Логин: 3–24 символа, латиница, цифры, _ . -",
    "bad name": "Имя: от 2 до 40 символов.",
    "bad password": "Пароль: от 8 до 64 символов.",
    "bad role": "Неизвестная роль.",
    "login taken": "Такой логин уже занят.",
    "self": "Нельзя отключить самого себя.",
    "not found": "Заявка не найдена.",
    "closed": "Заявка закрыта.",
    "already claimed": "Заявку уже взял другой модератор.",
    "claimed by another": "Заявку ведёт другой модератор.",
    "empty message": "Сообщение пустое.",
    "PGRST202": "Не настроено: выполни SQL из github/supabase/support.sql в Supabase.",
    "PGRST301": "Не настроено: проверь ключ Supabase.",
    "42P01": "Не настроено: в базе нет таблиц поддержки."
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function readSession() {
    try {
      var raw = JSON.parse(sessionStorage.getItem(SS_KEY) || "null");
      return raw && raw.token ? raw : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(value) {
    try {
      if (value) { sessionStorage.setItem(SS_KEY, JSON.stringify(value)); }
      else { sessionStorage.removeItem(SS_KEY); }
    } catch (e) { /* ignore */ }
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
    return "Ошибка: " + err.message;
  }

  function showMsg(id, text, kind) {
    var node = $(id);
    if (!node) { return; }
    node.textContent = text;
    node.hidden = !text;
    node.classList.remove("ok", "error");
    if (kind) { node.classList.add(kind); }
  }

  var toastTimer = null;
  function toast(text, bad) {
    var node = $("toast");
    node.textContent = text;
    node.hidden = false;
    node.classList.toggle("bad", Boolean(bad));
    node.classList.toggle("good", !bad);
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { node.hidden = true; }, 3200);
  }

  function fmt(ts) {
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

  function initials(name) {
    var parts = String(name || "?").replace(/^@/, "").split(/[\s_.-]+/).filter(Boolean);
    if (!parts.length) { return "?"; }
    if (parts.length === 1) { return parts[0].slice(0, 2).toUpperCase(); }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function show(view) {
    ["bootView", "setupView", "loginView", "appView"].forEach(function (id) {
      var node = $(id);
      if (node) { node.hidden = id !== view; }
    });
  }

  function handleErr(err, msgId) {
    if (err.message === "unauthorized") {
      logout(true);
      return;
    }
    if (msgId) { showMsg(msgId, errText(err), "error"); }
    else { toast(errText(err), true); }
  }

  function enterApp() {
    show("appView");
    $("meName").textContent = staff.name;
    $("meRole").textContent = ROLE[staff.role] || staff.role;
    $("meAva").textContent = initials(staff.name);
    startListPoll();
    loadThreads();
    loadStats();
    if (tab === "staff") { loadStaff(); }
  }

  async function boot() {
    var saved = readSession();
    if (saved && saved.token) {
      token = saved.token;
      try {
        await rpc("staff_stats", { p_token: token });
        staff = saved;
        enterApp();
        return;
      } catch (err) {
        if (err.message === "unauthorized") { saveSession(null); token = null; }
      }
    }

    var need = false;
    try {
      need = await rpc("staff_setup_needed");
    } catch (err) {
      $("bootMsg").textContent = errText(err);
      show("bootView");
      return;
    }

    if (need) {
      $("setupMsg").hidden = true;
      show("setupView");
      $("setupName").focus();
    } else {
      show("loginView");
      $("loginLogin").focus();
    }
  }

  async function onSetup(event) {
    event.preventDefault();
    var name = $("setupName").value.trim();
    var login = $("setupLogin").value.trim();
    var pass = $("setupPass").value;

    if (name.length < 2) { showMsg("setupMsg", "Имя: от 2 символов.", "error"); return; }
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(login)) {
      showMsg("setupMsg", "Логин: 3–24 символа, латиница, цифры, _ . -", "error");
      return;
    }
    if (pass.length < 8) { showMsg("setupMsg", "Пароль: от 8 символов.", "error"); return; }

    try {
      var res = await rpc("staff_bootstrap", { p_login: login, p_name: name, p_password: pass });
      staff = res;
      token = res.token;
      saveSession({ token: res.token, login: res.login, name: res.name, role: res.role });
      $("setupPass").value = "";
      enterApp();
    } catch (err) {
      handleErr(err, "setupMsg");
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    var login = $("loginLogin").value.trim();
    var pass = $("loginPass").value;
    if (!login || !pass) { showMsg("loginMsg", "Введите логин и пароль.", "error"); return; }

    try {
      var res = await rpc("staff_login", { p_login: login, p_password: pass });
      staff = res;
      token = res.token;
      saveSession({ token: res.token, login: res.login, name: res.name, role: res.role });
      $("loginPass").value = "";
      showMsg("loginMsg", "", "");
      enterApp();
    } catch (err) {
      handleErr(err, "loginMsg");
    }
  }

  function logout(silent) {
    if (token) { rpc("staff_logout", { p_token: token }).catch(function () {}); }
    staff = null;
    token = null;
    activeId = null;
    activeThread = null;
    threads = [];
    saveSession(null);
    if (threadTimer) { clearInterval(threadTimer); threadTimer = null; }
    if (listTimer) { clearInterval(listTimer); listTimer = null; }
    $("ticketPane").dataset.ready = "";
    $("ticketPane").textContent = "";
    show("loginView");
    if (!silent) { showMsg("loginMsg", "Вы вышли.", "ok"); }
  }

  function setTab(name) {
    tab = name;
    document.querySelectorAll("#sideNav button").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === name);
    });
    document.querySelectorAll(".tab").forEach(function (sec) {
      sec.classList.toggle("active", sec.id === "tab-" + name);
    });
    if (name === "stats") { loadStats(); }
    if (name === "staff") { loadStaff(); }
    if (name === "tickets") { loadThreads(); }
  }

  function updateNavCount() {
    var n = threads.filter(function (t) { return t.status !== "closed"; }).length;
    var badge = $("navCount");
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  async function loadThreads() {
    if (!token) { return; }
    try {
      threads = await rpc("staff_threads", { p_token: token, p_status: filter || null });
      renderThreads();
    } catch (err) {
      handleErr(err);
    }
  }

  function renderThreads() {
    var list = $("ticketsList");
    list.textContent = "";

    if (!threads.length) {
      list.appendChild(el("div", "pane-empty", filter ? "В этом фильтре пусто" : "Заявок пока нет"));
      updateNavCount();
      return;
    }

    threads.forEach(function (t) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "ticket-row" + (t.id === activeId ? " active" : "");
      row.addEventListener("click", function () { selectThread(t.id); });

      var top = el("div", "row-top");
      top.appendChild(el("span", "row-nick", t.nick));
      top.appendChild(el("span", "chip chip-" + t.status, STATUS[t.status] || t.status));

      var preview = el("div", "row-preview", t.last ? String(t.last).replace(/\s+/g, " ").slice(0, 80) : "нет сообщений");

      var meta = el("div", "row-meta");
      meta.appendChild(el("span", "", fmt(t.last_at || t.updated_at || t.created_at)));
      if (t.claimed) { meta.appendChild(el("span", "", "· " + t.claimed)); }
      if (t.unread > 0) { meta.appendChild(el("span", "row-unread", String(t.unread))); }

      row.appendChild(top);
      row.appendChild(preview);
      row.appendChild(meta);
      list.appendChild(row);
    });

    updateNavCount();
  }

  async function selectThread(id) {
    activeId = id;
    renderThreads();
    await loadThread();
    startThreadPoll();
  }

  async function loadThread(silent) {
    if (!token || !activeId) { return; }
    try {
      activeThread = await rpc("staff_thread", { p_token: token, p_thread: activeId });
      renderThread();
    } catch (err) {
      if (err.message === "not found") {
        activeId = null;
        activeThread = null;
        $("ticketPane").dataset.ready = "";
        $("ticketPane").textContent = "";
        $("ticketPane").appendChild(el("div", "pane-empty", "Заявка удалена"));
        loadThreads();
        return;
      }
      if (!silent) { handleErr(err); }
    }
  }

  function ensurePane() {
    var pane = $("ticketPane");
    if (pane.dataset.ready === "1") { return; }
    pane.dataset.ready = "1";
    pane.textContent = "";

    var head = el("div", "pane-head");

    var who = el("div", "pane-who");
    var ava = el("div", "ava");
    ava.id = "pAva";
    var info = document.createElement("div");
    var nick = document.createElement("b");
    nick.id = "pNick";
    var meta = document.createElement("span");
    meta.id = "pMeta";
    info.appendChild(nick);
    info.appendChild(meta);
    who.appendChild(ava);
    who.appendChild(info);

    var actions = el("div", "pane-actions");
    var claim = document.createElement("button");
    claim.type = "button";
    claim.className = "btn btn-sm btn-ghost";
    claim.id = "pClaim";
    claim.textContent = "Взять в работу";
    claim.addEventListener("click", claimTicket);
    var close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn-sm";
    close.id = "pClose";
    close.textContent = "Закрыть";
    close.addEventListener("click", closeTicket);
    actions.appendChild(claim);
    actions.appendChild(close);

    head.appendChild(who);
    head.appendChild(actions);

    var log = el("div", "chat-log");
    log.id = "pLog";

    var form = document.createElement("form");
    form.className = "chat-form";
    form.id = "pForm";
    var area = document.createElement("textarea");
    area.id = "pText";
    area.rows = 2;
    area.maxLength = 2000;
    area.placeholder = "Ответ игроку… Enter — отправить";
    area.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    var send = document.createElement("button");
    send.type = "submit";
    send.className = "btn";
    send.id = "pSend";
    send.textContent = "Отправить";
    form.appendChild(area);
    form.appendChild(send);
    form.addEventListener("submit", sendReply);

    pane.appendChild(head);
    pane.appendChild(log);
    pane.appendChild(form);
  }

  function messageNode(m) {
    if (m.kind === "system") {
      var sys = el("div", "msg msg-system", m.body);
      sys.appendChild(el("span", "msg-time", fmt(m.at)));
      return sys;
    }

    var node = el("div", "msg " + (m.kind === "staff" ? "msg-staff" : "msg-player"));
    if (m.kind === "staff" && m.author) {
      node.appendChild(el("span", "msg-author", m.author));
    }
    node.appendChild(document.createTextNode(m.body));
    node.appendChild(el("span", "msg-time", fmt(m.at)));
    return node;
  }

  function renderThread() {
    ensurePane();
    var t = activeThread;
    if (!t) { return; }

    $("pAva").textContent = initials(t.nick);
    $("pNick").textContent = t.nick;

    var meta = [STATUS[t.status] || t.status];
    if (t.claimed) { meta.push("ведёт " + t.claimed); }
    meta.push("с " + fmt(t.created_at));
    $("pMeta").textContent = meta.join(" · ");

    var claim = $("pClaim");
    claim.hidden = t.status === "closed";
    claim.disabled = t.status === "claimed" && t.claimed === staff.name;
    claim.textContent = t.claimed === staff.name ? "Вы ведёте" : "Взять в работу";

    var close = $("pClose");
    close.hidden = t.status === "closed";

    var form = $("pForm");
    form.hidden = t.status === "closed";

    var log = $("pLog");
    var messages = t.messages || [];
    var signature = messages.length ? messages[messages.length - 1].id + ":" + messages.length + ":" + t.status : "0:" + t.status;

    if (log.dataset.sig !== String(signature)) {
      log.dataset.sig = String(signature);
      log.textContent = "";
      if (!messages.length) {
        log.appendChild(el("div", "msg msg-system", "Переписки пока нет"));
      } else {
        messages.forEach(function (m) { log.appendChild(messageNode(m)); });
      }
      log.scrollTop = log.scrollHeight;
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    if (!activeThread || !token) { return; }
    var area = $("pText");
    var body = area.value.trim();
    if (!body) { return; }

    $("pSend").disabled = true;
    try {
      await rpc("staff_reply", { p_token: token, p_thread: activeThread.id, p_body: body });
      area.value = "";
      await loadThread(true);
      await loadThreads();
    } catch (err) {
      handleErr(err);
    } finally {
      $("pSend").disabled = false;
    }
  }

  async function claimTicket() {
    if (!activeThread || !token) { return; }
    try {
      await rpc("staff_claim", { p_token: token, p_thread: activeThread.id });
      await loadThread(true);
      await loadThreads();
      toast("Заявка взята в работу");
    } catch (err) {
      handleErr(err);
    }
  }

  async function closeTicket() {
    if (!activeThread || !token) { return; }
    if (!window.confirm("Закрыть заявку? Игрок сможет написать снова — она откроется.")) { return; }
    try {
      await rpc("staff_close", { p_token: token, p_thread: activeThread.id });
      await loadThread(true);
      await loadThreads();
      toast("Заявка закрыта");
    } catch (err) {
      handleErr(err);
    }
  }

  function card(label, value) {
    var box = el("div", "card");
    box.appendChild(el("b", "", String(value)));
    box.appendChild(el("span", "", label));
    return box;
  }

  function renderStats(s) {
    var cards = $("statCards");
    cards.textContent = "";
    cards.appendChild(card("Всего заявок", s.threads_total));
    cards.appendChild(card("Открытых", s.threads_open));
    cards.appendChild(card("В работе", s.threads_claimed));
    cards.appendChild(card("Закрыто", s.threads_closed));
    cards.appendChild(card("Сообщений", s.messages));
    cards.appendChild(card("Сотрудников", s.staff_active + " / " + s.staff_total));
    cards.appendChild(card("Новых сегодня", s.today));

    var table = $("statTeam");
    table.textContent = "";
    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    ["Имя", "Роль", "Взял", "Закрыл", "Ответов", "Статус"].forEach(function (title, index) {
      var th = document.createElement("th");
      th.textContent = title;
      if (index >= 2 && index <= 4) { th.className = "num"; }
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    (s.team || []).forEach(function (m) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", "", m.name));
      tr.appendChild(el("td", "", ROLE[m.role] || m.role));
      tr.appendChild(el("td", "num", m.claimed));
      tr.appendChild(el("td", "num", m.closed));
      tr.appendChild(el("td", "num", m.replies));
      tr.appendChild(el("td", "", m.active ? "работает" : "отключён"));
      tbody.appendChild(tr);
    });
    if (!(s.team || []).length) {
      var empty = document.createElement("tr");
      var cell = document.createElement("td");
      cell.colSpan = 6;
      cell.textContent = "Сотрудников пока нет";
      empty.appendChild(cell);
      tbody.appendChild(empty);
    }
    table.appendChild(tbody);
  }

  async function loadStats() {
    if (!token) { return; }
    try {
      renderStats(await rpc("staff_stats", { p_token: token }));
    } catch (err) {
      handleErr(err);
    }
  }

  function configureRoleSelect() {
    var select = $("staffRole");
    var adminOption = select.querySelector('option[value="admin"]');
    if (!adminOption) { return; }
    var canAdmin = staff && staff.role === "owner";
    adminOption.hidden = !canAdmin;
    adminOption.disabled = !canAdmin;
    if (!canAdmin) { select.value = "moderator"; }
  }

  async function loadStaff() {
    if (!token) { return; }
    try {
      var rows = await rpc("staff_list", { p_token: token });
      renderStaff(rows || []);
      configureRoleSelect();
    } catch (err) {
      handleErr(err);
    }
  }

  function renderStaff(rows) {
    var table = $("staffList");
    table.textContent = "";

    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    ["Имя", "Логин", "Роль", "Взял", "Закрыл", "Статус", ""].forEach(function (title, index) {
      var th = document.createElement("th");
      th.textContent = title;
      if (index >= 3 && index <= 4) { th.className = "num"; }
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (m) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", "", m.name));
      tr.appendChild(el("td", "", m.login));
      tr.appendChild(el("td", "", ROLE[m.role] || m.role));
      tr.appendChild(el("td", "num", m.claimed));
      tr.appendChild(el("td", "num", m.closed));
      tr.appendChild(el("td", "", m.active ? "работает" : "отключён"));

      var cell = document.createElement("td");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-ghost";
      btn.textContent = m.active ? "Отключить" : "Включить";
      btn.disabled = staff && staff.login === m.login;
      btn.addEventListener("click", function () { toggleStaff(m); });
      cell.appendChild(btn);
      tr.appendChild(cell);

      tbody.appendChild(tr);
    });

    if (!rows.length) {
      var empty = document.createElement("tr");
      var cell = document.createElement("td");
      cell.colSpan = 7;
      cell.textContent = "Сотрудников пока нет";
      empty.appendChild(cell);
      tbody.appendChild(empty);
    }

    table.appendChild(tbody);
  }

  async function toggleStaff(member) {
    if (!token) { return; }
    try {
      await rpc("staff_set_active", {
        p_token: token,
        p_staff_id: member.id,
        p_active: !member.active
      });
      toast(member.active ? "Аккаунт " + member.name + " отключён" : "Аккаунт " + member.name + " включён");
      await loadStaff();
      await loadStats();
    } catch (err) {
      handleErr(err);
    }
  }

  async function createStaff(event) {
    event.preventDefault();
    if (!token) { return; }

    var name = $("staffName").value.trim();
    var login = $("staffLogin").value.trim();
    var pass = $("staffPass").value;
    var role = $("staffRole").value;

    if (name.length < 2) { showMsg("staffMsg", "Имя: от 2 символов.", "error"); return; }
    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(login)) {
      showMsg("staffMsg", "Логин: 3–24 символа, латиница, цифры, _ . -", "error");
      return;
    }
    if (pass.length < 8) { showMsg("staffMsg", "Пароль: от 8 символов.", "error"); return; }

    try {
      await rpc("staff_create", {
        p_token: token,
        p_login: login,
        p_name: name,
        p_password: pass,
        p_role: role
      });
      showMsg("staffMsg", "", "");
      $("staffForm").reset();
      configureRoleSelect();
      toast("Аккаунт «" + name + "» создан");
      await loadStaff();
      await loadStats();
    } catch (err) {
      handleErr(err, "staffMsg");
    }
  }

  function startThreadPoll() {
    if (threadTimer) { clearInterval(threadTimer); }
    threadTimer = setInterval(function () {
      if (!document.hidden && tab === "tickets" && activeId) { loadThread(true); }
    }, 4000);
  }

  function startListPoll() {
    if (listTimer) { clearInterval(listTimer); }
    listTimer = setInterval(function () {
      if (document.hidden) { return; }
      if (tab === "tickets") { loadThreads(); }
      if (tab === "stats") { loadStats(); }
    }, 12000);
  }

  function init() {
    $("setupForm").addEventListener("submit", onSetup);
    $("loginForm").addEventListener("submit", onLogin);
    $("staffForm").addEventListener("submit", createStaff);
    $("logoutBtn").addEventListener("click", function () { logout(false); });
    $("statsRefresh").addEventListener("click", loadStats);

    document.querySelectorAll("#sideNav button").forEach(function (btn) {
      btn.addEventListener("click", function () { setTab(btn.getAttribute("data-tab")); });
    });

    document.querySelectorAll("#filters button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        filter = btn.getAttribute("data-status") || "";
        document.querySelectorAll("#filters button").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        loadThreads();
      });
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        loadThreads();
        if (activeId) { loadThread(true); }
      }
    });

    boot();
  }

  init();
})();
