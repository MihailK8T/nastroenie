(function () {
  "use strict";

  var LS_ACCOUNTS = "nastroenie.accounts.v1";
  var LS_THROTTLE = "nastroenie.throttle.v1";
  var SS_SESSION = "nastroenie.session.v1";
  var ITERATIONS = 600000;
  var SESSION_MS = 12 * 60 * 60 * 1000;
  var DUMMY_SALT = "MDEyMzQ1Njc4OWFiY2RlZg==";
  var NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
  var TERMS_VERSION = "26.11.2026";

  // Тот же аккаунт, что и в игре: вход проверяется в Supabase RPC.
  var SUPABASE_URL = "https://oyagzodrjvzncniwuxvc.supabase.co";
  var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YWd6b2RyanZ6bmNuaXd1eHZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NDI4NzcsImV4cCI6MjExMTExODg3N30.71KSdnKSNs-YWXMVR-apD7haHhq0-HLCfvYsYcKoubk";

  async function rpc(fn, body) {
    var resp = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      var text = "";
      try { text = await resp.text(); } catch (e) { /* ignore */ }
      throw new Error(fn + ": HTTP " + resp.status + " " + text);
    }
    var raw = await resp.text();
    try { return JSON.parse(raw); } catch (e) { return raw.replace(/^"|"$/g, ""); }
  }

  var PLANS = {
    normal:    { name: "Базовый",  price: 0,   days: 0 },
    pebble:    { name: "Камешек",  price: 5,   days: 7 },
    wood:      { name: "Дерево",   price: 10,  days: 7 },
    stone:     { name: "Камень",   price: 25,  days: 14 },
    iron:      { name: "Железо",   price: 50,  days: 14 },
    gold:      { name: "Золото",   price: 75,  days: 30 },
    diamond:   { name: "Алмаз",    price: 100, days: 30 },
    emerald:   { name: "Изумруд",  price: 125, days: 30 },
    netherite: { name: "Незерит",  price: 150, days: 30 },
    ender:     { name: "Эндер",    price: 175, days: 30 },
    creative:  { name: "Креатив",  price: 200, days: 30 }
  };

  var COIN_PACKS = {
    "500":  { coins: 500,  price: 99 },
    "1500": { coins: 1500, price: 249 },
    "4000": { coins: 4000, price: 599 }
  };

  var CART_KEY = "nastroenie.cart.v1";

  var page = document.body.getAttribute("data-page") || "";
  var params = new URLSearchParams(window.location.search);
  var nextPage = /^(plans|coins|cart)\.html$/.test(params.get("next") || "") ? params.get("next") : "";
  var activeTab = params.get("mode") === "register" ? "register" : "login";

  var $ = function (id) { return document.getElementById(id); };
  var accounts = loadAccounts();
  var busy = false;

  function loadAccounts() {
    var out = Object.create(null);
    try {
      var raw = JSON.parse(localStorage.getItem(LS_ACCOUNTS) || "{}");
      if (raw && typeof raw === "object") {
        Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
      }
    } catch (e) { /* повреждённое хранилище игнорируем */ }
    return out;
  }

  function saveAccounts() {
    try {
      localStorage.setItem(LS_ACCOUNTS, JSON.stringify(accounts));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadThrottle() {
    var out = Object.create(null);
    try {
      var raw = JSON.parse(localStorage.getItem(LS_THROTTLE) || "{}");
      if (raw && typeof raw === "object") {
        Object.keys(raw).forEach(function (k) { out[k] = raw[k]; });
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function saveThrottle(data) {
    try { localStorage.setItem(LS_THROTTLE, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }

  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
    return btoa(s);
  }

  function b64ToBytes(text) {
    var bin = atob(text);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
    return out;
  }

  function randomB64(length) {
    var bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytesToB64(bytes);
  }

  async function hashPassword(password, saltB64, iterations) {
    var enc = new TextEncoder();
    var key = await crypto.subtle.importKey(
      "raw",
      enc.encode(password.normalize("NFKC")),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    var bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations: iterations, hash: "SHA-256" },
      key,
      256
    );
    return bytesToB64(new Uint8Array(bits));
  }

  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) { return false; }
    var diff = 0;
    for (var i = 0; i < a.length; i++) { diff |= a.charCodeAt(i) ^ b.charCodeAt(i); }
    return diff === 0;
  }

  function getSession() {
    try {
      var raw = sessionStorage.getItem(SS_SESSION);
      if (!raw) { return null; }
      var s = JSON.parse(raw);
      if (!s || !s.nickLower || !s.exp || Date.now() > s.exp) {
        sessionStorage.removeItem(SS_SESSION);
        return null;
      }
      return s;
    } catch (e) {
      return null;
    }
  }

  function setSession(nickLower) {
    var data = {
      nickLower: nickLower,
      token: randomB64(32),
      exp: Date.now() + SESSION_MS
    };
    try {
      sessionStorage.setItem(SS_SESSION, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SS_SESSION); } catch (e) { /* ignore */ }
  }

  function currentAccount() {
    var s = getSession();
    if (!s) { return null; }
    var acc = accounts[s.nickLower];
    if (!acc) { clearSession(); return null; }
    var changed = false;
    if (!PLANS[acc.plan]) {
      acc.plan = "normal";
      acc.planUntil = 0;
      changed = true;
    }
    if (acc.plan !== "normal" && (!acc.planUntil || acc.planUntil <= Date.now())) {
      acc.plan = "normal";
      acc.planUntil = 0;
      changed = true;
    }
    if (changed) { saveAccounts(); }
    return acc;
  }

  function lockSeconds(key) {
    var t = loadThrottle()[key];
    if (t && t.until > Date.now()) { return Math.ceil((t.until - Date.now()) / 1000); }
    return 0;
  }

  function noteFail(key) {
    var t = loadThrottle();
    var rec = t[key] || { fails: 0, until: 0 };
    if (rec.until && Date.now() > rec.until) { rec.fails = 0; rec.until = 0; }
    rec.fails = (rec.fails || 0) + 1;
    var locked = false;
    if (rec.fails >= 5) {
      rec.until = Date.now() + 120000;
      rec.fails = 0;
      locked = true;
    }
    t[key] = rec;
    saveThrottle(t);
    return { fails: rec.fails, locked: locked };
  }

  function clearFails(key) {
    var t = loadThrottle();
    if (t[key]) { delete t[key]; saveThrottle(t); }
  }

  function fmtNum(n) {
    return new Intl.NumberFormat("ru-RU").format(n || 0);
  }

  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function fmtDateTime(ms) {
    return new Date(ms).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function nickError(value) {
    if (!NICK_RE.test(value)) { return "Ник: 3–16 символов, латиница, цифры и «_»."; }
    return "";
  }

  function passwordError(value) {
    // Те же правила, что у плагина в игре: 6–64 символа, без требований к составу.
    if (value.length < 6) { return "Пароль: минимум 6 символов."; }
    if (value.length > 64) { return "Пароль: не больше 64 символов."; }
    return "";
  }

  function emailError(value) {
    if (!value) { return ""; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) { return "Проверьте email."; }
    return "";
  }

  function showMsg(id, text, kind) {
    var el = $(id);
    if (!el) { return; }
    el.className = "form-msg" + (kind ? " " + kind : "");
    el.textContent = text;
    el.hidden = !text;
  }

  function showAuthMsg(text, kind) { showMsg("authMsg", text, kind); }
  function showPlanMsg(text, kind) { showMsg("planMsg", text, kind); }
  function showCoinMsg(text, kind) { showMsg("coinMsg", text, kind); }
  function showProfileMsg(text, kind) { showMsg("profileMsg", text, kind); }

  function setBusy(form, on) {
    if (!form) { return; }
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) { return; }
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = "Проверка…";
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
    }
  }

  function switchTab(tab) {
    activeTab = tab === "register" ? "register" : "login";
    var tabLogin = $("tabLogin");
    var tabRegister = $("tabRegister");
    if (!tabLogin || !tabRegister) { return; }
    tabLogin.setAttribute("aria-selected", String(activeTab === "login"));
    tabRegister.setAttribute("aria-selected", String(activeTab === "register"));
    $("loginForm").hidden = activeTab !== "login";
    $("registerForm").hidden = activeTab !== "register";
    showAuthMsg("", "");
  }

  function gate(next, plan, mode) {
    var url = "account.html?next=" + encodeURIComponent(next);
    if (plan) { url += "&plan=" + encodeURIComponent(plan); }
    if (mode === "register") { url += "&mode=register"; }
    window.location.href = url;
  }

  function renderHeader() {
    var slot = $("headerSlot");
    if (!slot) { return; }
    slot.replaceChildren();
    var acc = currentAccount();

    if (acc) {
      var wrap = document.createElement("div");
      wrap.className = "user-wrap";

      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "user-chip";
      chip.setAttribute("aria-haspopup", "true");
      chip.setAttribute("aria-expanded", "false");
      chip.title = "Меню аккаунта";

      var name = document.createElement("span");
      name.textContent = acc.nick;

      var badge = document.createElement("span");
      badge.className = "cart-badge";
      badge.setAttribute("data-cart-count", "");
      badge.textContent = cartCount() ? String(cartCount()) : "";
      badge.hidden = !cartCount();

      var caret = document.createElement("span");
      caret.className = "caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "▾";

      if (window.MTAvatar) {
        var mini = document.createElement("span");
        mini.className = "mini-avatar";
        mini.setAttribute("aria-hidden", "true");
        mini.innerHTML = window.MTAvatar.svg(acc.nick, { size: 22 });
        chip.appendChild(mini);
      }

      chip.appendChild(name);
      chip.appendChild(badge);
      chip.appendChild(caret);
      var menu = document.createElement("div");
      menu.className = "user-menu";

      function addLink(href, text, withCount) {
        var link = document.createElement("a");
        link.href = href;
        link.textContent = text;
        if (withCount) {
          var count = document.createElement("span");
          count.className = "menu-count";
          count.setAttribute("data-cart-count", "");
          count.textContent = cartCount() ? String(cartCount()) : "";
          count.hidden = !cartCount();
          link.appendChild(count);
        }
        menu.appendChild(link);
      }

      addLink("cart.html", "Корзина", true);
      addLink("account.html#purchases", "Мои покупки", false);
      addLink("account.html#settings", "Настройки аккаунта", false);

      var sep = document.createElement("div");
      sep.className = "menu-sep";
      menu.appendChild(sep);

      addLink("plans.html", "Тарифы", false);
      addLink("coins.html", "Монеты", false);

      var out = document.createElement("button");
      out.type = "button";
      out.className = "menu-logout";
      out.textContent = "Выйти";
      out.addEventListener("click", logout);
      menu.appendChild(out);

      wrap.appendChild(chip);
      wrap.appendChild(menu);

      chip.addEventListener("click", function (event) {
        event.stopPropagation();
        var open = wrap.classList.toggle("open");
        chip.setAttribute("aria-expanded", String(open));
      });

      slot.appendChild(wrap);
    } else {
      var login = document.createElement("a");
      login.className = "btn btn-sm";
      login.href = "account.html";
      login.textContent = "Войти";
      slot.appendChild(login);
    }
  }

  function updateCartBadge() {
    var count = cartCount();
    document.querySelectorAll("[data-cart-count]").forEach(function (el) {
      el.textContent = count ? String(count) : "";
      el.hidden = !count;
    });
  }

  function renderPlanButtons() {
    var acc = currentAccount();
    document.querySelectorAll("[data-plan]").forEach(function (btn) {
      var key = btn.getAttribute("data-plan");
      var active = !!acc && acc.plan === key;
      if (active) {
        btn.textContent = "Подключён";
        btn.disabled = true;
      } else {
        btn.textContent = "В корзину";
        btn.disabled = false;
      }
    });
  }

  function renderAccount() {
    var profile = $("profile");
    if (!profile) { return; }

    var acc = currentAccount();
    var sess = getSession();

    $("authTabs").hidden = !!acc;
    $("tabLogin").setAttribute("aria-selected", String(activeTab === "login"));
    $("tabRegister").setAttribute("aria-selected", String(activeTab === "register"));
    $("loginForm").hidden = !!acc || activeTab !== "login";
    $("registerForm").hidden = !!acc || activeTab !== "register";
    profile.hidden = !acc;

    if (!acc) { return; }

    var plan = PLANS[acc.plan] || PLANS.normal;
    var avatarBox = $("profileAvatar");
    if (avatarBox) {
      if (window.MTAvatar) {
        avatarBox.textContent = "";
        avatarBox.classList.add("px-avatar");
        avatarBox.innerHTML = window.MTAvatar.svg(acc.nick, { size: 48 });
      } else {
        avatarBox.textContent = acc.nick.slice(0, 2).toUpperCase();
      }
    }
    $("profileNick").textContent = acc.nick;
    $("profileEmail").textContent = acc.email || "Email не указан";
    $("profilePlan").textContent = plan.name;
    $("profilePlan").classList.toggle("paid", acc.plan !== "normal");
    $("profileCoins").textContent = fmtNum(acc.coins);
    $("profileUntil").textContent = acc.plan === "normal" ? "бессрочно" : fmtDate(acc.planUntil);
    $("profileCreated").textContent = fmtDate(acc.createdAt);
    $("sessionUntil").textContent = sess ? fmtDateTime(sess.exp) : "—";
    if ($("profileTerms")) {
      $("profileTerms").textContent = acc.termsAt ? "приняты " + fmtDate(acc.termsAt) : "не приняты";
    }
    if ($("settingsNick")) { $("settingsNick").textContent = acc.nick; }
    if ($("settingsEmail")) { $("settingsEmail").textContent = acc.email || "не указан"; }
    if ($("settingsTerms")) { $("settingsTerms").textContent = acc.termsAt ? "приняты " + fmtDate(acc.termsAt) : "не приняты"; }
    if ($("acceptTermsBtn")) {
      $("acceptTermsBtn").hidden = !!acc.termsAt;
    }
  }

  function showCartMsg(text, kind) { showMsg("cartMsg", text, kind); }

  function purchaseTitle(p) {
    if (p.type === "plan" && PLANS[p.id]) { return "Тариф «" + PLANS[p.id].name + "»"; }
    if (p.type === "coins" && COIN_PACKS[String(p.id)]) {
      return "Монеты " + fmtNum(COIN_PACKS[String(p.id)].coins);
    }
    return "Покупка";
  }

  function renderCart() {
    var list = $("cartList");
    if (!list) { return; }

    var cart = loadCart();
    var total = cartTotal(cart);
    list.replaceChildren();

    cart.forEach(function (item, index) {
      var info = cartItemInfo(item);
      if (!info) { return; }
      var qty = Number(item.qty) || 1;

      var row = document.createElement("article");
      row.className = "cart-item";

      var main = document.createElement("div");
      var title = document.createElement("h3");
      title.textContent = info.title;
      var meta = document.createElement("p");
      meta.className = "cart-meta";
      meta.textContent = info.meta + (qty > 1 ? " · " + qty + " шт." : "");
      main.appendChild(title);
      main.appendChild(meta);

      var price = document.createElement("div");
      price.className = "cart-price";
      price.textContent = fmtNum(info.price * qty) + " ₽";

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cart-remove";
      remove.textContent = "Убрать";
      remove.addEventListener("click", function () {
        removeFromCart(index);
        renderCart();
        showCartMsg("Удалено из корзины.", "ok");
      });

      row.appendChild(main);
      row.appendChild(price);
      row.appendChild(remove);
      list.appendChild(row);
    });

    if ($("cartEmpty")) { $("cartEmpty").hidden = cart.length > 0; }
    if ($("cartTotal")) { $("cartTotal").textContent = fmtNum(total) + " ₽"; }
    if ($("checkoutBtn")) { $("checkoutBtn").disabled = !cart.length; }
    updateCartBadge();
  }

  function renderPurchases() {
    var list = $("purchaseList");
    if (!list) { return; }

    var acc = currentAccount();
    var items = acc && Array.isArray(acc.purchases) ? acc.purchases : [];
    list.replaceChildren();

    items.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "purchase-item";

      var main = document.createElement("div");
      var title = document.createElement("b");
      title.textContent = purchaseTitle(p);
      var meta = document.createElement("span");
      meta.className = "purchase-meta";
      meta.textContent = fmtDateTime(p.at) + (p.qty > 1 ? " · " + p.qty + " шт." : "");
      main.appendChild(title);
      main.appendChild(meta);

      var sum = document.createElement("b");
      sum.textContent = fmtNum(p.total || 0) + " ₽";

      row.appendChild(main);
      row.appendChild(sum);
      list.appendChild(row);
    });

    if ($("purchasesEmpty")) { $("purchasesEmpty").hidden = items.length > 0; }
  }

  function checkoutCart() {
    var acc = currentAccount();
    if (!acc) {
      gate("cart.html", "", "login");
      return;
    }

    var cart = loadCart();
    if (!cart.length) {
      showCartMsg("Корзина пуста.", "error");
      return;
    }
    if (!consentChecked("cartConsent")) {
      showCartMsg("Отметьте согласие с Пользовательским соглашением и Политикой конфиденциальности.", "error");
      if ($("cartConsent")) { $("cartConsent").focus(); }
      return;
    }

    markTerms(acc);

    var total = 0;
    var count = 0;
    cart.forEach(function (item) {
      var info = cartItemInfo(item);
      if (!info) { return; }
      var qty = Number(item.qty) || 1;
      if (item.type === "plan") { applyPlan(acc, item.id, qty); }
      else { applyCoins(acc, item.id, qty); }
      total += info.price * qty;
      count += qty;
    });

    if (!count) {
      showCartMsg("В корзине нет доступных товаров.", "error");
      return;
    }

    saveAccounts();
    saveCart([]);
    render();
    renderCart();
    showCartMsg("Заказ оформлен: " + count + " поз. на " + fmtNum(total) + " ₽.", "ok");
  }

  function render() {
    renderHeader();
    renderPlanButtons();
    renderAccount();

    var hero = $("heroPrimary");
    if (hero) {
      hero.textContent = currentAccount() ? "Личный кабинет" : "Создать аккаунт";
    }

    renderCart();
    renderPurchases();
    updateCartBadge();
  }

  function logout() {
    clearSession();
    if (page === "account") { switchTab("login"); }
    render();
    if (page === "account") { showAuthMsg("Вы вышли из аккаунта.", "ok"); }
  }

  function consentChecked(boxId) {
    var box = $(boxId);
    return !box || box.checked;
  }

  function markTerms(acc) {
    if (acc && !acc.termsAt) {
      acc.termsAt = Date.now();
      acc.termsVersion = TERMS_VERSION;
      saveAccounts();
    }
  }

  function loadCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(raw)) { return []; }
      return raw.filter(function (item) {
        return item && (item.type === "plan" || item.type === "coins") && item.id;
      });
    } catch (e) {
      return [];
    }
  }

  function saveCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
    updateCartBadge();
  }

  function cartCount() {
    return loadCart().reduce(function (sum, item) {
      return sum + (Number(item.qty) || 1);
    }, 0);
  }

  function cartItemInfo(item) {
    if (!item) { return null; }
    if (item.type === "plan") {
      var plan = PLANS[item.id];
      if (!plan) { return null; }
      return {
        title: "Тариф «" + plan.name + "»",
        meta: plan.days ? "доступ на " + plan.days + " дней" : "бессрочно",
        price: plan.price
      };
    }
    var pack = COIN_PACKS[String(item.id)];
    if (!pack) { return null; }
    return {
      title: "Монеты " + fmtNum(pack.coins),
      meta: pack.price + " ₽ за пак",
      price: pack.price
    };
  }

  function addToCart(type, id) {
    var cart = loadCart();
    var found = null;
    cart.forEach(function (item) {
      if (item.type === type && String(item.id) === String(id)) { found = item; }
    });
    if (found) {
      found.qty = (Number(found.qty) || 1) + 1;
    } else {
      cart.push({ type: type, id: String(id), qty: 1 });
    }
    saveCart(cart);
    return cart;
  }

  function removeFromCart(index) {
    var cart = loadCart();
    cart.splice(index, 1);
    saveCart(cart);
    return cart;
  }

  function cartTotal(cart) {
    return cart.reduce(function (sum, item) {
      var info = cartItemInfo(item);
      return info ? sum + info.price * (Number(item.qty) || 1) : sum;
    }, 0);
  }

  function recordPurchase(acc, type, id, qty, price) {
    acc.purchases = Array.isArray(acc.purchases) ? acc.purchases : [];
    acc.purchases.unshift({
      type: type,
      id: String(id),
      qty: qty,
      price: price,
      total: price * qty,
      at: Date.now()
    });
    if (acc.purchases.length > 50) { acc.purchases.length = 50; }
  }

  function applyPlan(acc, key, qty) {
    var plan = PLANS[key];
    if (!plan) { return false; }
    var count = Math.max(1, Number(qty) || 1);
    for (var i = 0; i < count; i++) {
      if (key === "normal") {
        acc.plan = "normal";
        acc.planUntil = 0;
      } else {
        var base = (acc.plan === key && acc.planUntil > Date.now()) ? acc.planUntil : Date.now();
        acc.plan = key;
        acc.planUntil = base + plan.days * 24 * 60 * 60 * 1000;
      }
    }
    recordPurchase(acc, "plan", key, count, plan.price);
    return true;
  }

  function applyCoins(acc, id, qty) {
    var pack = COIN_PACKS[String(id)];
    if (!pack) { return false; }
    var count = Math.max(1, Number(qty) || 1);
    acc.coins = (acc.coins || 0) + pack.coins * count;
    recordPurchase(acc, "coins", String(id), count, pack.price);
    return true;
  }

  function activatePlan(key) {
    if (!consentChecked("planConsent")) {
      showPlanMsg("Отметьте согласие с Пользовательским соглашением и Политикой конфиденциальности.", "error");
      if ($("planConsent")) { $("planConsent").focus(); }
      return;
    }

    var acc = currentAccount();
    if (!acc) {
      gate("plans.html", key, key === "normal" ? "register" : "login");
      return;
    }

    var plan = PLANS[key];
    if (!plan) { return; }

    markTerms(acc);

    if (!applyPlan(acc, key, 1)) { return; }
    saveAccounts();
    render();
    showPlanMsg(
      "Тариф «" + plan.name + "» активен до " + fmtDate(acc.planUntil) + ".",
      "ok"
    );
  }

  function addCoins(amount) {
    if (!consentChecked("coinConsent")) {
      showCoinMsg("Отметьте согласие с Пользовательским соглашением и Политикой конфиденциальности.", "error");
      if ($("coinConsent")) { $("coinConsent").focus(); }
      return;
    }

    var acc = currentAccount();
    if (!acc) {
      gate("coins.html", "", "login");
      return;
    }
    markTerms(acc);
    if (!applyCoins(acc, String(amount), 1)) { return; }
    saveAccounts();
    render();
    showCoinMsg("Начислено " + fmtNum(amount) + " монет. Баланс: " + fmtNum(acc.coins) + ".", "ok");
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (busy) { return; }

    var nick = $("loginNick").value.trim();
    var pass = $("loginPass").value;
    var error = nickError(nick) || (pass ? "" : "Введите пароль.");
    if (error) {
      showAuthMsg(error, "error");
      (nickError(nick) ? $("loginNick") : $("loginPass")).focus();
      return;
    }

    var key = nick.toLowerCase();
    var lock = lockSeconds(key);
    if (lock > 0) {
      showAuthMsg("Слишком много попыток. Подождите " + lock + " с.", "error");
      return;
    }

    busy = true;
    setBusy($("loginForm"), true);
    try {
      if (!window.crypto || !crypto.subtle) {
        showAuthMsg("Браузер не поддерживает WebCrypto. Откройте страницу в современном браузере.", "error");
        return;
      }
      var ok = false;
      try {
        ok = (await rpc("mc_verify", { p_name: key, p_password: pass })) === true;
      } catch (e) {
        showAuthMsg("Сервис входа недоступен. Попробуйте позже.", "error");
        return;
      }

      if (!ok) {
        var state = noteFail(key);
        if (state.locked) {
          showAuthMsg("Неверный ник или пароль. Вход заблокирован на 2 минуты.", "error");
        } else {
          showAuthMsg("Неверный ник или пароль. Осталось попыток: " + (5 - state.fails) + ".", "error");
        }
        return;
      }

      clearFails(key);

      // Локальная карточка профиля (тариф, монеты).
      var acc = accounts[key];
      if (!acc) {
        var mail = "";
        try {
          mail = (await rpc("mc_email", { p_name: key })) || "";
        } catch (e) { /* ignore */ }
        acc = accounts[key] = {
          nick: nick,
          email: typeof mail === "string" ? mail : "",
          createdAt: Date.now(),
          plan: "normal",
          planUntil: 0,
          coins: 0
        };
        saveAccounts();
      }

      if (!setSession(key)) {
        showAuthMsg("Вход выполнен, но сессию сохранить не удалось. Разрешите cookies/хранилище.", "error");
        render();
        return;
      }
      $("loginForm").reset();
      if (nextPage) { window.location.href = nextPage; return; }
      render();
      showAuthMsg("Вы вошли как " + acc.nick + ".", "ok");
    } catch (e) {
      showAuthMsg("Не удалось выполнить вход. Обновите страницу и попробуйте снова.", "error");
    } finally {
      busy = false;
      setBusy($("loginForm"), false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (busy) { return; }

    var nick = $("regNick").value.trim();
    var email = $("regEmail").value.trim();
    var pass = $("regPass").value;
    var pass2 = $("regPass2").value;
    var consentBox = $("regConsent");
    var accepted = !consentBox || consentBox.checked;
    var error = nickError(nick) || emailError(email) || passwordError(pass) || (pass === pass2 ? "" : "Пароли не совпадают.") || (accepted ? "" : "Подтвердите согласие с Пользовательским соглашением и Политикой конфиденциальности.");

    if (error) {
      showAuthMsg(error, "error");
      if (nickError(nick)) { $("regNick").focus(); }
      else if (passwordError(pass)) { $("regPass").focus(); }
      else if (pass !== pass2) { $("regPass2").focus(); }
      else if (!accepted) { consentBox.focus(); }
      else { $("regEmail").focus(); }
      return;
    }

    var key = nick.toLowerCase();
    if (accounts[key]) {
      showAuthMsg("Этот ник уже зарегистрирован. Войдите в аккаунт.", "error");
      return;
    }

    busy = true;
    setBusy($("registerForm"), true);
    try {
      if (!window.crypto || !crypto.subtle) {
        showAuthMsg("Браузер не поддерживает WebCrypto. Откройте страницу в современном браузере.", "error");
        return;
      }
      var result;
      try {
        result = await rpc("mc_register", {
          p_name: nick,
          p_password: pass,
          p_email: email
        });
      } catch (e) {
        showAuthMsg("Сервис регистрации недоступен. Попробуйте позже.", "error");
        return;
      }
      if (result === "exists") {
        showAuthMsg("Этот ник уже зарегистрирован. Войдите в аккаунт.", "error");
        return;
      }
      if (result !== "ok") {
        showAuthMsg("Не удалось создать аккаунт. Проверьте пароль и попробуйте снова.", "error");
        return;
      }

      accounts[key] = {
        nick: nick,
        email: email,
        createdAt: Date.now(),
        plan: "normal",
        planUntil: 0,
        coins: 0,
        termsAt: Date.now(),
        termsVersion: TERMS_VERSION
      };
      if (!saveAccounts()) {
        delete accounts[key];
        showAuthMsg("Аккаунт создан, но браузер запретил локальное хранилище — войдите заново.", "error");
        render();
        return;
      }
      if (!setSession(key)) {
        showAuthMsg("Аккаунт создан, но сессия не сохранилась. Войдите вручную.", "error");
        render();
        return;
      }
      $("registerForm").reset();
      if (nextPage) { window.location.href = nextPage; return; }
      render();
      showAuthMsg("Аккаунт создан. Пароль тот же, что и в игре.", "ok");
    } catch (e) {
      showAuthMsg("Не удалось создать аккаунт. Обновите страницу и попробуйте снова.", "error");
    } finally {
      busy = false;
      setBusy($("registerForm"), false);
    }
  }

  function renewPlan() {
    var acc = currentAccount();
    if (!acc) { return; }
    if (acc.plan === "normal") {
      showProfileMsg("Сначала выберите тариф в разделе «Тарифы».", "error");
      return;
    }
    var plan = PLANS[acc.plan] || PLANS.normal;
    acc.planUntil = Math.max(Date.now(), acc.planUntil || 0) + plan.days * 24 * 60 * 60 * 1000;
    saveAccounts();
    render();
    showProfileMsg("Тариф продлён до " + fmtDate(acc.planUntil) + ".", "ok");
  }

  function copyAddress(btn, text) {
    var label = btn.textContent;

    function done() {
      btn.textContent = "Скопировано";
      window.setTimeout(function () { btn.textContent = label; }, 1600);
    }

    function fallback() {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
      document.body.removeChild(area);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function init() {
    render();

    if ($("tabLogin") && $("tabRegister")) {
      $("tabLogin").addEventListener("click", function () { switchTab("login"); });
      $("tabRegister").addEventListener("click", function () { switchTab("register"); });
    }
    if ($("loginForm")) { $("loginForm").addEventListener("submit", handleLogin); }
    if ($("registerForm")) { $("registerForm").addEventListener("submit", handleRegister); }
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        copyAddress(btn, btn.getAttribute("data-copy"));
      });
    });
    if ($("renewBtn")) { $("renewBtn").addEventListener("click", renewPlan); }
    if ($("logoutBtn")) { $("logoutBtn").addEventListener("click", logout); }
    if ($("acceptTermsBtn")) {
      $("acceptTermsBtn").addEventListener("click", function () {
        var acc = currentAccount();
        if (!acc) { return; }
        acc.termsAt = Date.now();
        acc.termsVersion = TERMS_VERSION;
        saveAccounts();
        render();
        showProfileMsg("Условия приняты " + fmtDate(acc.termsAt) + ".", "ok");
      });
    }

    document.querySelectorAll("[data-plan]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-plan");
        addToCart("plan", key);
        renderCart();
        showPlanMsg("Добавлено в корзину. Оформить можно на странице «Корзина».", "ok");
      });
    });

    document.querySelectorAll("[data-coins]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        addToCart("coins", btn.getAttribute("data-coins"));
        renderCart();
        showCoinMsg("Добавлено в корзину. Оформить можно на странице «Корзина».", "ok");
      });
    });

    document.querySelectorAll("[data-add-plan]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        addToCart("plan", btn.getAttribute("data-add-plan"));
        renderCart();
        showPlanMsg("Добавлено в корзину. Оформить можно на странице «Корзина».", "ok");
      });
    });

    document.querySelectorAll("[data-add-coins]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        addToCart("coins", btn.getAttribute("data-add-coins"));
        renderCart();
        showCoinMsg("Добавлено в корзину. Оформить можно на странице «Корзина».", "ok");
      });
    });

    if ($("checkoutBtn")) {
      $("checkoutBtn").addEventListener("click", checkoutCart);
    }

    function closeMenus() {
      document.querySelectorAll(".user-wrap.open").forEach(function (wrap) {
        wrap.classList.remove("open");
        var chip = wrap.querySelector(".user-chip");
        if (chip) { chip.setAttribute("aria-expanded", "false"); }
      });
    }
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { closeMenus(); }
    });

    if (page === "account" && !currentAccount() && nextPage) {
      showAuthMsg(
        nextPage === "cart.html"
          ? "Войдите или создайте аккаунт, чтобы оформить заказ из корзины."
          : nextPage === "plans.html"
          ? "Войдите или создайте аккаунт, чтобы подключить тариф."
          : "Войдите или создайте аккаунт, чтобы купить монеты.",
        "error"
      );
      window.setTimeout(function () {
        var field = activeTab === "login" ? $("loginNick") : $("regNick");
        if (field) { field.focus({ preventScroll: true }); }
      }, 320);
    }

    window.addEventListener("storage", function (event) {
      if (event.key === LS_ACCOUNTS) {
        accounts = loadAccounts();
        render();
      } else if (event.key === CART_KEY) {
        renderCart();
        updateCartBadge();
      }
    });

    window.setInterval(function () {
      var profile = $("profile");
      var had = profile && !profile.hidden;
      var acc = currentAccount();
      if (had && !acc) {
        render();
        showAuthMsg("Сессия истекла. Войдите снова.", "error");
      } else if (!profile) {
        renderHeader();
        renderPlanButtons();
      }
    }, 60000);
  }

  init();
})();
