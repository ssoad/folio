// Folio admin panel: a small single-page app over /admin/api.
// Builds the page with DOM calls (no HTML strings), so user-supplied text
// can't inject markup.
"use strict";

// ── Helpers ─────────────────────────────────────────────────────────────────

const $app = document.getElementById("app");

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "style") el.setAttribute("style", value);
    // A textarea's text is its value property, not an attribute
    else if (key === "value") el.value = String(value);
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

async function api(method, path, body) {
  const res = await fetch("/admin/api/" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Folio-Admin": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") {
    state.user = null;
    render();
  }
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

function toast(message, isError) {
  const el = h("div", { class: "toast" + (isError ? " error" : "") }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), isError ? 5000 : 2500);
}

// Runs an action, reporting its error
async function run(action, success) {
  try {
    const result = await action();
    if (success) toast(success);
    return result;
  } catch (error) {
    toast(error.message, true);
    throw error;
  }
}

const fmtDate = (ts) =>
  ts ? new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
const fmtDateTime = (ts) =>
  ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const fmtNumber = (n) => Number(n || 0).toLocaleString();

function fmtAgo(ts) {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts;
  if (s < 90) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  if (s < 86400 * 30) return Math.round(s / 86400) + " days ago";
  return fmtDate(ts);
}

function fmtEnds(ts) {
  if (!ts) return "No end";
  const days = Math.ceil((ts - Date.now() / 1000) / 86400);
  if (days < 0) return "Ended " + fmtDate(ts);
  return fmtDate(ts) + " (" + days + " days)";
}

const FEATURE_NAMES = {
  ai: "AI (assistant, translation, dictionary)",
  tts: "AI voices",
  ocr: "AI OCR",
  metadata: "Book metadata",
  vault: "Sync to own storage",
  assets: "Font & dictionary downloads",
  drives: "Cloud drives",
  sync: "Folio Cloud sync",
};
const LIMIT_NAMES = {
  ai_requests: "AI requests / month",
  tts_chars: "Voice characters / month",
  ocr_pages: "OCR pages / month",
};

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", null, label, hint ? h("span", { class: "hint" }, " · " + hint) : null), input);
}

function formValues(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") values[el.name] = el.checked;
    else values[el.name] = el.value;
  }
  return values;
}

// A modal with a form; resolves with its values, or null when cancelled
function dialog(title, body, submitLabel = "Save", danger = false) {
  return new Promise((resolve) => {
    const form = h("form", { class: "form" }, body);
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      close(formValues(form));
    });
    const overlay = h(
      "div",
      { class: "overlay", onmousedown: (e) => e.target === overlay && close(null) },
      h(
        "div",
        { class: "dialog", role: "dialog", "aria-modal": "true" },
        h("h2", null, title),
        form,
        h(
          "div",
          { class: "dialog-actions" },
          h("button", { type: "button", onclick: () => close(null) }, "Cancel"),
          h("button", { class: danger ? "primary danger" : "primary", type: "button", onclick: () => form.requestSubmit() }, submitLabel)
        )
      )
    );
    document.body.append(overlay);
    const first = form.querySelector("input, select, textarea");
    if (first) first.focus();
    overlay.addEventListener("keydown", (e) => e.key === "Escape" && close(null));
  });
}

const confirmDialog = (title, text, label = "Confirm") =>
  dialog(title, h("p", { class: "muted", style: "margin:0" }, text), label, true);

function packageSelect(name, packages, selected, withNone) {
  return h(
    "select",
    { name, required: !withNone },
    withNone ? h("option", { value: "0" }, withNone) : null,
    packages.map((p) =>
      h("option", { value: String(p.id), selected: Number(selected) === p.id }, p.name + (p.is_active ? "" : " (archived)"))
    )
  );
}

function meter(used, limit) {
  if (limit === undefined || limit === null) {
    return h("div", null, h("span", null, fmtNumber(used)), h("span", { class: "muted" }, " · unlimited"));
  }
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  return h(
    "div",
    null,
    h("span", null, fmtNumber(used) + " / " + fmtNumber(limit)),
    h("div", { class: "meter" + (used >= limit ? " full" : "") }, h("span", { style: "width:" + pct + "%" }))
  );
}

function statusBadge(status) {
  const kind = { active: "ok", approved: "ok", pending: "warn", disabled: "danger", rejected: "danger", cancelled: "", replaced: "" }[status];
  return h("span", { class: "badge " + (kind || "") }, status);
}

// ── State and routing ───────────────────────────────────────────────────────

const state = { user: null, setupRequired: false, pending: 0, server: null };

const routes = [
  ["dashboard", "Dashboard", viewDashboard],
  ["users", "Users", viewUsers],
  ["requests", "Access requests", viewRequests],
  ["packages", "Packages", viewPackages],
  ["promos", "Promo codes", viewPromos],
  ["settings", "Settings", viewSettings],
];

function currentRoute() {
  const [name, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "dashboard", id };
}

window.addEventListener("hashchange", render);

async function boot() {
  try {
    const session = await api("GET", "session");
    state.user = session.user;
    state.setupRequired = session.setup_required;
  } catch (error) {
    toast(error.message, true);
  }
  render();
}

async function render() {
  $app.replaceChildren();
  if (!state.user) {
    $app.append(state.setupRequired ? viewSetup() : viewLogin());
    return;
  }
  const route = currentRoute();
  const main = h("main", { class: "main" });
  const nav = h(
    "nav",
    { class: "nav" },
    h("div", { class: "brand" }, h("span", null, "Folio", h("span", { class: "brand-dot" }, ".")), h("span", { class: "brand-tag" }, "Admin")),
    routes.map(([name, label]) =>
      h(
        "a",
        { href: "#/" + name, class: route.name === name ? "active" : "", onclick: () => nav.classList.remove("open") },
        label,
        name === "requests" && state.pending > 0 ? h("span", { class: "count" }, state.pending) : null
      )
    ),
    h("div", { class: "nav-spacer" }),
    h(
      "div",
      { class: "nav-user" },
      h("div", { class: "small" }, state.user.email),
      h(
        "button",
        {
          class: "link small",
          onclick: async () => {
            await api("POST", "logout").catch(() => {});
            state.user = null;
            render();
          },
        },
        "Sign out"
      )
    )
  );
  $app.append(h("div", { class: "shell" }, nav, main));
  main.append(h("button", { class: "menu-button", onclick: () => nav.classList.toggle("open") }, "☰ Menu"));
  const view = (routes.find(([name]) => name === route.name) || routes[0])[2];
  try {
    await view(main, route.id);
  } catch (error) {
    main.append(h("div", { class: "card empty" }, error.message));
  }
  refreshPending();
}

async function refreshPending() {
  try {
    const stats = await api("GET", "stats");
    if (stats.pending_requests !== state.pending) {
      state.pending = stats.pending_requests;
      const link = document.querySelector('.nav a[href="#/requests"]');
      if (link) {
        link.querySelector(".count")?.remove();
        if (state.pending > 0) link.append(h("span", { class: "count" }, state.pending));
      }
    }
  } catch (_) {}
}

function pageHead(title, subtitle, ...actions) {
  return h(
    "div",
    { class: "page-head" },
    h("div", null, h("h1", null, title), subtitle ? h("p", { class: "muted" }, subtitle) : null),
    h("div", { class: "row" }, actions)
  );
}

// ── Sign-in and setup ───────────────────────────────────────────────────────

function authCard(subtitle, fields, submitLabel, onSubmit) {
  const form = h("form", { class: "form" }, fields, h("button", { class: "primary", type: "submit" }, submitLabel));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await onSubmit(formValues(form));
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return h(
    "div",
    { class: "auth" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "brand" }, h("span", null, "Folio", h("span", { class: "brand-dot" }, ".")), h("span", { class: "brand-tag" }, "Admin")),
      h("p", { class: "muted" }, subtitle),
      form
    )
  );
}

function viewLogin() {
  return authCard(
    "Sign in to manage your Folio server.",
    [
      field("Email", h("input", { name: "email", type: "email", autocomplete: "username", required: true })),
      field("Password", h("input", { name: "password", type: "password", autocomplete: "current-password", required: true })),
    ],
    "Sign in",
    async (values) => {
      const result = await api("POST", "login", values);
      state.user = result.user;
      render();
    }
  );
}

function viewSetup() {
  return authCard(
    "Create the first admin account. The setup code is printed in the server log.",
    [
      field("Setup code", h("input", { name: "code", required: true, autocomplete: "off" })),
      field("Name", h("input", { name: "name", autocomplete: "name" })),
      field("Email", h("input", { name: "email", type: "email", autocomplete: "username", required: true })),
      field("Password", h("input", { name: "password", type: "password", minlength: 10, autocomplete: "new-password", required: true }), "10+ characters"),
    ],
    "Create admin",
    async (values) => {
      const result = await api("POST", "setup", values);
      state.user = result.user;
      state.setupRequired = false;
      render();
    }
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────

async function viewDashboard(main) {
  const [stats, server] = await Promise.all([api("GET", "stats"), api("GET", "server")]);
  state.server = server;
  const stat = (value, label, href) =>
    h(href ? "a" : "div", { class: "card stat", href }, h("div", { class: "value" }, fmtNumber(value)), h("div", { class: "label" }, label));
  main.append(
    pageHead("Dashboard", "Everything on your Folio server at a glance."),
    h(
      "div",
      { class: "grid stats" },
      stat(stats.users, "Users", "#/users"),
      stat(stats.active_users_7d, "Active this week"),
      stat(stats.new_users_30d, "New in 30 days"),
      stat(stats.active_subscriptions, "Active subscriptions"),
      stat(stats.expiring_7d, "Ending within 7 days"),
      stat(stats.pending_requests, "Pending requests", "#/requests")
    ),
    h(
      "div",
      { class: "grid two", style: "margin-top:16px" },
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-head" }, h("h2", null, "Subscribers by package")),
        stats.subscriptions_by_package.length
          ? stats.subscriptions_by_package.map((p) =>
              h("div", { class: "row between list-item" }, h("span", null, p.name), h("span", { class: "badge accent" }, fmtNumber(p.count)))
            )
          : h("p", { class: "muted" }, "No active subscriptions yet.")
      ),
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-head" }, h("h2", null, "Usage this month"), h("span", { class: "muted small" }, stats.period)),
        Object.keys(LIMIT_NAMES).map((k) =>
          h("div", { class: "row between list-item" }, h("span", null, LIMIT_NAMES[k].replace(" / month", "")), h("strong", null, fmtNumber(stats.usage[k])))
        )
      )
    ),
    h(
      "div",
      { class: "card", style: "margin-top:16px" },
      h("div", { class: "card-head" }, h("h2", null, "Server features"), h("span", { class: "muted small" }, "Set by the server's environment")),
      h(
        "div",
        { class: "checks" },
        Object.keys(FEATURE_NAMES).map((f) =>
          h("div", { class: "row" }, h("span", { class: "badge " + (server.features[f] ? "ok" : "") }, server.features[f] ? "on" : "off"), FEATURE_NAMES[f])
        )
      ),
      h(
        "p",
        { class: "muted small", style: "margin:14px 0 0" },
        "AI model: " + (server.ai_model || "not set") + " · Email: " + (server.mail ? "set up" : "not set up") + " · Google sign-in: " +
          (server.google_login ? "on" : "off") + " · Public URL: " + (server.public_url || "not set")
      )
    )
  );
}

// ── Users ───────────────────────────────────────────────────────────────────

async function viewUsers(main, id) {
  if (id) return viewUser(main, id);
  const search = h("input", { type: "search", placeholder: "Search email or name", style: "max-width:320px" });
  const tbody = h("tbody");
  const total = h("span", { class: "muted small" });
  let packages = [];
  const load = async () => {
    const data = await api("GET", "users?q=" + encodeURIComponent(search.value));
    total.textContent = fmtNumber(data.total) + " users";
    tbody.replaceChildren(
      ...data.users.map((u) =>
        h(
          "tr",
          { class: "clickable", onclick: () => (location.hash = "#/users/" + u.id) },
          h("td", null, h("div", null, u.email), u.name ? h("div", { class: "muted small" }, u.name) : null),
          h("td", null, u.package_name ? h("span", { class: "badge accent" }, u.package_name) : h("span", { class: "muted" }, "None")),
          h("td", { class: "small" }, u.package_name ? (u.ends_at ? fmtEnds(u.ends_at) : "No end") : ""),
          h("td", null, u.role === "admin" ? h("span", { class: "badge warn" }, "admin") : null, " ", u.status !== "active" ? statusBadge(u.status) : null),
          h("td", { class: "muted small" }, fmtAgo(u.last_seen_at))
        )
      )
    );
    if (!data.users.length) tbody.append(h("tr", null, h("td", { colspan: 5, class: "empty" }, "No users found.")));
  };
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  const addUser = async () => {
    packages = packages.length ? packages : await api("GET", "packages");
    const values = await dialog(
      "Add user",
      h(
        "div",
        { class: "form" },
        field("Email", h("input", { name: "email", type: "email", required: true })),
        field("Name", h("input", { name: "name" })),
        field("Password", h("input", { name: "password", type: "password", minlength: 8, required: true }), "they can change it later"),
        field("Package", packageSelect("package_id", packages.filter((p) => p.is_active), 0, "No package")),
        h("label", { class: "check" }, h("input", { type: "checkbox", name: "admin" }), "Admin")
      ),
      "Add user"
    );
    if (!values) return;
    const user = await run(
      () => api("POST", "users", { ...values, package_id: Number(values.package_id), role: values.admin ? "admin" : "user" }),
      "User added"
    );
    location.hash = "#/users/" + user.id;
  };
  main.append(
    pageHead("Users", "Accounts created in the app or added here.", h("button", { class: "primary", onclick: addUser }, "Add user")),
    h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, search, total),
      h(
        "div",
        { class: "table-wrap" },
        h("table", null, h("thead", null, h("tr", null, ["User", "Package", "Ends", "Role", "Last seen"].map((t) => h("th", null, t)))), tbody)
      )
    )
  );
  await load();
}

async function viewUser(main, id) {
  const [data, packages] = await Promise.all([api("GET", "users/" + id), api("GET", "packages")]);
  const u = data.user;
  const reload = () => render();
  const patch = (body, success) => run(() => api("PATCH", "users/" + id, body), success).then(reload);

  const grant = async () => {
    const values = await dialog(
      "Give a package",
      h(
        "div",
        { class: "form" },
        field("Package", packageSelect("package_id", packages.filter((p) => p.is_active), data.package?.id)),
        field("Days", h("input", { name: "days", type: "number", min: -1, placeholder: "Package default" }), "blank: package default, -1: no end"),
        field("Note", h("input", { name: "note", placeholder: "e.g. paid by bank transfer #1234" })),
        h("p", { class: "muted small", style: "margin:0" }, "The same package extends the current subscription; another package replaces it.")
      ),
      "Give package"
    );
    if (!values) return;
    await run(() => api("POST", "users/" + id + "/subscriptions", { package_id: Number(values.package_id), days: Number(values.days || 0), note: values.note }), "Package given");
    reload();
  };

  const profile = h(
    "form",
    { class: "form cols" },
    field("Name", h("input", { name: "name", value: u.name })),
    field("Role", h("select", { name: "role" }, ["user", "admin"].map((r) => h("option", { value: r, selected: u.role === r }, r)))),
    field("Status", h("select", { name: "status" }, ["active", "disabled"].map((s) => h("option", { value: s, selected: u.status === s }, s)))),
    h("label", { class: "check", style: "align-self:end;padding-bottom:9px" }, h("input", { type: "checkbox", name: "email_verified", checked: u.email_verified }), "Email verified")
  );
  profile.addEventListener("submit", (e) => e.preventDefault());

  const limits = data.limits || {};
  main.append(
    h("a", { href: "#/users", class: "small" }, "← Users"),
    pageHead(
      u.email,
      "Joined " + fmtDate(u.created_at) + " · last seen " + fmtAgo(u.last_seen_at) + (u.has_google ? " · Google" : "") + (u.has_password ? " · password" : ""),
      h("button", { class: "primary", onclick: grant }, "Give package")
    ),
    h(
      "div",
      { class: "grid two" },
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-head" }, h("h2", null, "Current plan")),
        data.package
          ? h(
              "div",
              null,
              h("div", { class: "row" }, h("h3", null, data.package.name),
                data.subscription ? h("span", { class: "badge ok" }, "active") : h("span", { class: "badge" }, "default")),
              h("p", { class: "muted", style: "margin:6px 0 0" }, data.subscription
                ? "Ends: " + fmtEnds(data.subscription.ends_at) + " · via " + data.subscription.source
                : "No subscription; everyone without one gets the default package (Settings).")
            )
          : h("p", { class: "muted" }, "No package. Signed-in features are off until they get one."),
        h("div", { class: "card-head", style: "margin:18px 0 10px" }, h("h3", null, "Usage this month"),
          h("button", { class: "link small", onclick: async () => {
            if (await confirmDialog("Reset usage", "Set this month's usage back to zero?", "Reset")) {
              await run(() => api("DELETE", "users/" + id + "/usage"), "Usage reset");
              reload();
            }
          } }, "Reset")),
        Object.keys(LIMIT_NAMES).map((k) => h("div", { class: "list-item" }, h("div", { class: "small muted" }, LIMIT_NAMES[k]), meter(data.usage[k], limits[k])))
      ),
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-head" }, h("h2", null, "Profile")),
        profile,
        h(
          "div",
          { class: "row", style: "margin-top:14px" },
          h("button", { class: "primary", onclick: () => {
            const v = formValues(profile);
            patch({ name: v.name, role: v.role, status: v.status, email_verified: v.email_verified }, "Saved");
          } }, "Save"),
          h("button", { onclick: async () => {
            const values = await dialog("Set password", field("New password", h("input", { name: "password", type: "password", minlength: 8, required: true })), "Set password");
            if (values) patch({ password: values.password }, "Password set");
          } }, "Set password"),
          h("button", { class: "danger", onclick: async () => {
            if (await confirmDialog("Delete user", "Delete " + u.email + " with their subscriptions and devices? This can't be undone.", "Delete")) {
              await run(() => api("DELETE", "users/" + id), "User deleted");
              location.hash = "#/users";
            }
          } }, "Delete")
        )
      )
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Signed-in devices"),
        data.devices.length ? h("button", { class: "small", onclick: async () => {
          if (await confirmDialog("Sign out everywhere", "Sign " + u.email + " out of every device?", "Sign out")) {
            await run(() => api("POST", "users/" + id + "/signout"), "Signed out");
            reload();
          }
        } }, "Sign out everywhere") : null),
      data.devices.length
        ? data.devices.map((d) =>
            h("div", { class: "row between list-item" },
              h("div", null, h("div", null, d.name || "Device"), h("div", { class: "muted small" }, "Signed in " + fmtDate(d.created_at) + " · used " + fmtAgo(d.last_used_at))),
              h("button", { class: "danger small", onclick: async () => {
                await run(() => api("DELETE", "users/" + id + "/devices/" + d.id), "Device signed out");
                reload();
              } }, "Sign out"))
          )
        : h("p", { class: "muted" }, "Not signed in anywhere.")
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Subscription history")),
      data.subscriptions.length
        ? h("div", { class: "table-wrap" }, h("table", null,
            h("thead", null, h("tr", null, ["Package", "Source", "Started", "Ends", "Status", ""].map((t) => h("th", null, t)))),
            h("tbody", null, data.subscriptions.map((s) =>
              h("tr", null,
                h("td", null, s.package_name, s.note ? h("div", { class: "muted small" }, s.note) : null),
                h("td", { class: "small" }, s.source),
                h("td", { class: "small" }, fmtDate(s.starts_at)),
                h("td", { class: "small" }, s.ends_at ? fmtDate(s.ends_at) : "No end"),
                h("td", null, statusBadge(s.active ? "active" : s.status === "active" ? "ended" : s.status)),
                h("td", null, s.active ? h("button", { class: "danger small", onclick: async () => {
                  if (await confirmDialog("Cancel subscription", "End " + s.package_name + " for " + u.email + " now?", "Cancel it")) {
                    await run(() => api("DELETE", "users/" + id + "/subscriptions/" + s.id), "Cancelled");
                    reload();
                  }
                } }, "Cancel") : null)
              )))))
        : h("p", { class: "muted" }, "No subscriptions yet.")
    ),
    data.requests.length
      ? h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", null, "Requests")), data.requests.map(requestItem))
      : null
  );
}

// ── Access requests ─────────────────────────────────────────────────────────

let requestFilter = "pending";

function requestItem(r, onDecided) {
  const decide = async (action) => {
    let body = { note: "" };
    if (action === "approve") {
      const packages = await api("GET", "packages");
      const values = await dialog(
        "Approve request",
        h(
          "div",
          { class: "form" },
          field("Package", packageSelect("package_id", packages.filter((p) => p.is_active), r.package_id)),
          field("Days", h("input", { name: "days", type: "number", min: -1, placeholder: "Package default" }), "blank: package default, -1: no end"),
          field("Note to keep", h("input", { name: "note", value: r.payment_reference ? "Payment " + r.payment_reference : "" }))
        ),
        "Approve"
      );
      if (!values) return;
      body = { package_id: Number(values.package_id), days: Number(values.days || 0), note: values.note };
    } else {
      const values = await dialog("Reject request", field("Reason", h("input", { name: "note", placeholder: "Optional; the user sees it" })), "Reject", true);
      if (!values) return;
      body = { note: values.note };
    }
    await run(() => api("POST", "requests/" + r.id + "/" + action, body), action === "approve" ? "Approved" : "Rejected");
    onDecided ? onDecided() : render();
  };
  return h(
    "div",
    { class: "list-item" },
    h(
      "div",
      { class: "row between" },
      h("div", { class: "row" },
        h("a", { href: "#/users/" + r.user_id }, r.user_email),
        h("span", { class: "badge " + (r.kind === "special" ? "warn" : "accent") }, r.kind === "special" ? "special access" : r.package_name || "subscription"),
        statusBadge(r.status)),
      h("span", { class: "muted small" }, fmtDateTime(r.created_at))
    ),
    r.message ? h("div", { class: "quote" }, r.message) : null,
    r.payment_reference ? h("div", { class: "small" }, "Payment reference: ", h("strong", { class: "mono" }, r.payment_reference)) : null,
    r.admin_note ? h("div", { class: "small muted" }, "Note: " + r.admin_note) : null,
    r.status === "pending"
      ? h("div", { class: "row", style: "margin-top:10px" },
          h("button", { class: "primary", onclick: () => decide("approve") }, "Approve"),
          h("button", { onclick: () => decide("reject") }, "Reject"))
      : null
  );
}

async function viewRequests(main) {
  const list = h("div", { class: "card" });
  const tabs = h("div", { class: "tabs" });
  const load = async () => {
    const requests = await api("GET", "requests" + (requestFilter === "all" ? "" : "?status=" + requestFilter));
    tabs.replaceChildren(
      ...["pending", "approved", "rejected", "all"].map((s) =>
        h("button", { class: requestFilter === s ? "active" : "", onclick: () => { requestFilter = s; load(); } }, s[0].toUpperCase() + s.slice(1))
      )
    );
    list.replaceChildren(...(requests.length ? requests.map((r) => requestItem(r, () => { load(); refreshPending(); })) : [h("div", { class: "empty" }, "No " + (requestFilter === "all" ? "" : requestFilter + " ") + "requests.")]));
  };
  main.append(pageHead("Access requests", "Plan purchases paid outside the app and special access asks.", tabs), list);
  await load();
}

// ── Packages ────────────────────────────────────────────────────────────────

async function editPackage(pkg) {
  const p = pkg || { name: "", description: "", price_label: "", duration_days: 30, features: [], limits: {}, is_public: true, is_active: true, sort_order: 0 };
  const values = await dialog(
    pkg ? "Edit " + pkg.name : "New package",
    h(
      "div",
      { class: "form" },
      h("div", { class: "form cols" },
        field("Name", h("input", { name: "name", value: p.name, required: true })),
        field("Price label", h("input", { name: "price_label", value: p.price_label, placeholder: "e.g. $4.99 / month" }))),
      field("Description", h("textarea", { name: "description", value: p.description, rows: 3 })),
      h("div", { class: "form cols" },
        field("Duration (days)", h("input", { name: "duration_days", type: "number", min: 0, value: p.duration_days }), "0: no end"),
        field("Sort order", h("input", { name: "sort_order", type: "number", value: p.sort_order }))),
      h("div", null, h("div", { class: "small muted", style: "font-weight:600;margin-bottom:6px" }, "Features"),
        h("div", { class: "checks" }, Object.keys(FEATURE_NAMES).map((f) =>
          h("label", { class: "check" }, h("input", { type: "checkbox", name: "feature_" + f, checked: p.features.includes(f) }), FEATURE_NAMES[f])))),
      h("div", null, h("div", { class: "small muted", style: "font-weight:600;margin-bottom:6px" }, "Monthly limits (blank: unlimited)"),
        h("div", { class: "form cols" }, Object.keys(LIMIT_NAMES).map((k) =>
          field(LIMIT_NAMES[k], h("input", { name: "limit_" + k, type: "number", min: 0, value: p.limits[k] ?? "" }))))),
      h("div", { class: "row" },
        h("label", { class: "check" }, h("input", { type: "checkbox", name: "is_public", checked: p.is_public }), "Shown in the app"),
        h("label", { class: "check" }, h("input", { type: "checkbox", name: "is_active", checked: p.is_active }), "Active"))
    ),
    pkg ? "Save" : "Create package"
  );
  if (!values) return false;
  const body = {
    name: values.name,
    description: values.description,
    price_label: values.price_label,
    duration_days: Number(values.duration_days || 0),
    sort_order: Number(values.sort_order || 0),
    is_public: values.is_public,
    is_active: values.is_active,
    features: Object.keys(FEATURE_NAMES).filter((f) => values["feature_" + f]),
    limits: Object.fromEntries(Object.keys(LIMIT_NAMES).filter((k) => values["limit_" + k] !== "").map((k) => [k, Number(values["limit_" + k])])),
  };
  await run(() => (pkg ? api("PATCH", "packages/" + pkg.id, body) : api("POST", "packages", body)), pkg ? "Saved" : "Package created");
  return true;
}

async function viewPackages(main) {
  const packages = await api("GET", "packages");
  main.append(
    pageHead("Packages", "What each plan includes and how much of it per month.",
      h("button", { class: "primary", onclick: async () => (await editPackage()) && render() }, "New package")),
    packages.length
      ? h("div", { class: "grid cards" }, packages.map((p) =>
          h("div", { class: "card" },
            h("div", { class: "row between" }, h("h2", null, p.name), h("div", { class: "row" },
              p.is_active ? null : h("span", { class: "badge" }, "archived"),
              p.is_active && !p.is_public ? h("span", { class: "badge warn" }, "hidden") : null)),
            p.price_label ? h("div", { class: "muted", style: "margin-top:2px" }, p.price_label) : null,
            p.description ? h("p", { class: "small", style: "margin:8px 0" }, p.description) : null,
            h("div", { class: "small muted", style: "margin:10px 0 6px" }, p.duration_days ? p.duration_days + " days" : "No end"),
            h("div", { class: "row" }, p.features.length ? p.features.map((f) => h("span", { class: "badge accent" }, FEATURE_NAMES[f] || f)) : h("span", { class: "muted small" }, "No features")),
            Object.keys(p.limits).length
              ? h("div", { class: "small muted", style: "margin-top:8px" }, Object.entries(p.limits).map(([k, v]) => LIMIT_NAMES[k] + ": " + fmtNumber(v)).join(" · "))
              : null,
            h("div", { class: "row", style: "margin-top:14px" },
              h("button", { onclick: async () => (await editPackage(p)) && render() }, "Edit"),
              h("button", { class: "danger", onclick: async () => {
                if (await confirmDialog("Delete package", "Packages people have used are archived instead, so their history stays.", "Delete")) {
                  const result = await run(() => api("DELETE", "packages/" + p.id));
                  toast(result.archived ? "Archived" : "Deleted");
                  render();
                }
              } }, "Delete"))
          )))
      : h("div", { class: "card empty" }, "No packages yet. Create one, e.g. Free, Pro and Family.")
  );
}

// ── Promo codes ─────────────────────────────────────────────────────────────

async function viewPromos(main) {
  const [codes, packages] = await Promise.all([api("GET", "promos"), api("GET", "packages")]);
  const create = async () => {
    const values = await dialog(
      "Create promo codes",
      h(
        "div",
        { class: "form" },
        field("Package", packageSelect("package_id", packages.filter((p) => p.is_active), 0)),
        h("div", { class: "form cols" },
          field("How many codes", h("input", { name: "count", type: "number", min: 1, max: 500, value: 1 })),
          field("Uses per code", h("input", { name: "max_uses", type: "number", min: 0, value: 1 }), "0: unlimited")),
        h("div", { class: "form cols" },
          field("Days of access", h("input", { name: "duration_days", type: "number", min: -1, placeholder: "Package default" }), "-1: no end"),
          field("Code expires", h("input", { name: "expires", type: "date" }))),
        field("Custom code", h("input", { name: "code", placeholder: "e.g. LAUNCH2026 (single code only)" })),
        field("Note", h("input", { name: "note", placeholder: "Who it's for" }))
      ),
      "Create"
    );
    if (!values) return;
    const result = await run(() =>
      api("POST", "promos", {
        package_id: Number(values.package_id),
        count: Number(values.count || 1),
        max_uses: Number(values.max_uses || 0),
        duration_days: Number(values.duration_days || 0),
        expires_at: values.expires ? Math.floor(new Date(values.expires + "T23:59:59").getTime() / 1000) : 0,
        code: values.code,
        note: values.note,
      })
    );
    const text = result.codes.join("\n");
    await dialog(
      result.codes.length + (result.codes.length === 1 ? " code created" : " codes created"),
      h("div", { class: "form" }, h("textarea", { class: "mono", readOnly: true, rows: Math.min(12, result.codes.length + 1), value: text }),
        h("button", { type: "button", onclick: () => navigator.clipboard.writeText(text).then(() => toast("Copied")) }, "Copy all")),
      "Done"
    );
    render();
  };
  main.append(
    pageHead("Promo codes", "Codes people enter in the app to get a package.", h("button", { class: "primary", onclick: create }, "Create codes")),
    h("div", { class: "card" }, codes.length
      ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, ["Code", "Package", "Uses", "Access", "Expires", "", ""].map((t) => h("th", null, t)))),
          h("tbody", null, codes.map((c) => {
            const expired = c.expires_at && c.expires_at < Date.now() / 1000;
            const usedUp = c.max_uses && c.used_count >= c.max_uses;
            return h("tr", null,
              h("td", null, h("button", { class: "link mono", title: "Copy", onclick: () => navigator.clipboard.writeText(c.code).then(() => toast("Copied")) }, c.code),
                c.note ? h("div", { class: "muted small" }, c.note) : null),
              h("td", null, c.package_name),
              h("td", { class: "small" }, fmtNumber(c.used_count) + " / " + (c.max_uses ? fmtNumber(c.max_uses) : "∞")),
              h("td", { class: "small" }, c.duration_days > 0 ? c.duration_days + " days" : c.duration_days < 0 ? "No end" : "Package default"),
              h("td", { class: "small" }, c.expires_at ? fmtDate(c.expires_at) : "Never"),
              h("td", null, !c.is_active ? h("span", { class: "badge" }, "off") : expired ? h("span", { class: "badge danger" }, "expired") : usedUp ? h("span", { class: "badge" }, "used up") : h("span", { class: "badge ok" }, "active")),
              h("td", null, h("div", { class: "row" },
                h("button", { class: "small", onclick: async () => {
                  await run(() => api("PATCH", "promos/" + c.id, { is_active: !c.is_active }), c.is_active ? "Turned off" : "Turned on");
                  render();
                } }, c.is_active ? "Turn off" : "Turn on"),
                h("button", { class: "danger small", onclick: async () => {
                  if (await confirmDialog("Delete code", "Delete " + c.code + "? People who used it keep their access.", "Delete")) {
                    await run(() => api("DELETE", "promos/" + c.id), "Deleted");
                    render();
                  }
                } }, "Delete"))));
          }))))
      : h("div", { class: "empty" }, "No promo codes yet."))
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

async function viewSettings(main) {
  const [s, packages, server] = await Promise.all([api("GET", "settings"), api("GET", "packages"), api("GET", "server")]);
  const form = h("form", { class: "stack" });
  const redirect = (s.public_url || server.public_url || "https://your-server") + "/pro/v1/auth/google/callback";
  form.append(
    h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Sign-up")),
      h("div", { class: "form" },
        h("label", { class: "check" }, h("input", { type: "checkbox", name: "registration_open", checked: s.registration_open === "true" }), "Anyone can create an account in the app"),
        h("label", { class: "check" }, h("input", { type: "checkbox", name: "require_email_verification", checked: s.require_email_verification === "true" }), "New accounts must confirm their email (needs email set up)"),
        field("Default package", packageSelect("default_package_id", packages.filter((p) => p.is_active), s.default_package_id, "None"), "for everyone without an active subscription, e.g. Free; ended plans fall back to it"))),
    h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Payments")),
      field("Payment instructions", h("textarea", { name: "payment_instructions", value: s.payment_instructions, rows: 4,
        placeholder: "Shown in the app when someone picks a plan, e.g. how to pay by bank transfer and what reference to use." }),
        "people pay outside the app, then send a request with their payment reference")),
    h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Server address")),
      field("Public URL", h("input", { name: "public_url", value: s.public_url, placeholder: server.public_url || "https://folio.example.com" }),
        "used in emails and for Google sign-in; defaults to PRO_PUBLIC_URL")),
    h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Email"), h("span", { class: "badge " + (server.mail ? "ok" : "") }, server.mail ? "set up" : "off")),
      h("div", { class: "form cols" },
        field("SMTP host", h("input", { name: "smtp_host", value: s.smtp_host, placeholder: "smtp.example.com" })),
        field("Port", h("input", { name: "smtp_port", value: s.smtp_port, placeholder: "587" }), "465 for TLS"),
        field("Username", h("input", { name: "smtp_username", value: s.smtp_username, autocomplete: "off" })),
        field("Password", h("input", { name: "smtp_password", type: "password", autocomplete: "new-password", placeholder: s.smtp_password_set ? "Saved; type to change" : "" })),
        field("From", h("input", { name: "smtp_from", value: s.smtp_from, placeholder: "Folio <no-reply@example.com>" }))),
      h("div", { class: "row", style: "margin-top:12px" }, h("button", { type: "button", onclick: async () => {
        const values = await dialog("Send a test email", field("To", h("input", { name: "to", type: "email", required: true, value: state.user.email })), "Send");
        if (values) run(() => api("POST", "settings/test-email", values), "Test email sent");
      } }, "Send test email"), h("span", { class: "muted small" }, "Save first"))),
    h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h2", null, "Google sign-in"), h("span", { class: "badge " + (server.google_login ? "ok" : "") }, server.google_login ? "on" : "off")),
      h("p", { class: "muted small", style: "margin-top:0" }, "Create an OAuth client (web application) in Google Cloud Console and add this redirect URI: ", h("strong", { class: "mono" }, redirect),
        ". Leave blank to use the Google Drive app (PRO_OAUTH_GOOGLE_*)."),
      h("div", { class: "form cols" },
        field("Client ID", h("input", { name: "google_client_id", value: s.google_client_id, autocomplete: "off" })),
        field("Client secret", h("input", { name: "google_client_secret", type: "password", autocomplete: "new-password", placeholder: s.google_client_secret_set ? "Saved; type to change" : "" })))),
    h("div", { class: "row" }, h("button", { class: "primary", type: "submit" }, "Save settings"))
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = formValues(form);
    const body = {};
    for (const [key, value] of Object.entries(values)) body[key] = typeof value === "boolean" ? String(value) : value;
    await run(() => api("PUT", "settings", body), "Settings saved");
    render();
  });
  main.append(pageHead("Settings", "How people join and pay, and how the server reaches them."), form);
}

boot();
