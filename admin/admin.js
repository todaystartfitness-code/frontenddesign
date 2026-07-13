(function () {
  "use strict";

  var script = document.currentScript;
  var page = script && script.getAttribute("data-page");

  function setMessage(el, text, kind) {
    el.className = "portal-message" + (kind ? " " + kind : "");
    el.textContent = text;
  }

  if (page === "login") {
    var form = document.getElementById("request-link-form");
    var messageEl = document.getElementById("form-message");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("email").value;
      setMessage(messageEl, "Sending…");

      fetch("/api/auth/admin/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          setMessage(messageEl, data.message || "Check your email for a login link.", "success");
        })
        .catch(function () {
          setMessage(messageEl, "Something went wrong. Please try again.", "error");
        });
    });
    return;
  }

  if (page !== "dashboard") return;

  var packages = [];

  function requireAuth() {
    return fetch("/api/admin/packages").then(function (res) {
      if (res.status === 401) {
        window.location.href = "/admin/";
        return Promise.reject(new Error("unauthenticated"));
      }
      return res;
    });
  }

  function money(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function renderPackages() {
    var tbody = document.querySelector("#packages-table tbody");
    tbody.innerHTML = "";
    packages.forEach(function (p) {
      var tr = document.createElement("tr");
      if (p.archived) tr.className = "archived-row";
      tr.innerHTML =
        "<td>" + p.name + "</td>" +
        "<td>" + p.session_count + "</td>" +
        "<td>" + p.session_duration_minutes + " min</td>" +
        "<td>" + money(p.price_cents) + "</td>" +
        "<td>" + p.expiration_days + "d</td>" +
        "<td>" + (p.is_drop_in ? "Yes" : "") + "</td>" +
        "<td>" + p.active_grants + "</td>" +
        "<td></td>";
      var actionCell = tr.lastElementChild;

      var editBtn = document.createElement("button");
      editBtn.className = "link-button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () { enterEditMode(p); });
      actionCell.appendChild(editBtn);

      actionCell.appendChild(document.createTextNode(" "));

      var toggleBtn = document.createElement("button");
      toggleBtn.className = "link-button";
      toggleBtn.textContent = p.archived ? "Unarchive" : "Archive";
      toggleBtn.addEventListener("click", function () {
        fetch("/api/admin/packages/" + p.id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: !p.archived }),
        }).then(loadPackages);
      });
      actionCell.appendChild(toggleBtn);

      tbody.appendChild(tr);
    });
  }

  var editingPackageId = null;

  function enterEditMode(p) {
    editingPackageId = p.id;
    document.getElementById("pkg-name").value = p.name;
    document.getElementById("pkg-sessions").value = p.session_count;
    document.getElementById("pkg-price").value = (p.price_cents / 100).toFixed(2);
    document.getElementById("pkg-expiration").value = p.expiration_days;
    document.getElementById("pkg-duration").value = p.session_duration_minutes;
    document.getElementById("pkg-dropin").checked = !!p.is_drop_in;

    document.getElementById("package-form-title").textContent = "Edit package — " + p.name;
    document.getElementById("package-form-submit").textContent = "Save changes";
    document.getElementById("package-form-cancel").hidden = false;

    var note = document.getElementById("package-form-note");
    note.hidden = false;
    note.textContent = p.active_grants > 0
      ? p.active_grants + " client(s) currently hold active credits granted from this package. " +
        "Their session count, expiration, and price already agreed to are locked in and won't change " +
        "— this only affects future grants from this package."
      : "No clients currently hold active credits from this package.";

    document.getElementById("pkg-name").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitEditMode() {
    editingPackageId = null;
    document.getElementById("package-form").reset();
    document.getElementById("package-form-title").textContent = "Add a package";
    document.getElementById("package-form-submit").textContent = "Add package";
    document.getElementById("package-form-cancel").hidden = true;
    document.getElementById("package-form-note").hidden = true;
  }

  document.getElementById("package-form-cancel").addEventListener("click", exitEditMode);

  function loadPackages() {
    return requireAuth()
      .then(function (res) { return res.json(); })
      .then(function (data) {
        packages = data.packages;
        renderPackages();
        renderGrantPackageOptions();
      });
  }

  function renderGrantPackageOptions() {
    var select = document.getElementById("grant-package");
    var current = select.value;
    select.innerHTML = "";
    packages.filter(function (p) { return !p.archived; }).forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    if (current) select.value = current;
  }

  document.getElementById("package-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var messageEl = document.getElementById("package-message");
    var priceDollars = parseFloat(document.getElementById("pkg-price").value);
    var body = {
      name: document.getElementById("pkg-name").value,
      session_count: parseInt(document.getElementById("pkg-sessions").value, 10),
      price_cents: Math.round(priceDollars * 100),
      expiration_days: parseInt(document.getElementById("pkg-expiration").value, 10),
      session_duration_minutes: parseInt(document.getElementById("pkg-duration").value, 10),
      is_drop_in: document.getElementById("pkg-dropin").checked,
    };

    var isEditing = editingPackageId !== null;
    var url = isEditing ? "/api/admin/packages/" + editingPackageId : "/api/admin/packages";
    var method = isEditing ? "PATCH" : "POST";

    fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) throw new Error();
        setMessage(messageEl, isEditing ? "Package updated." : "Package added.", "success");
        exitEditMode();
        return loadPackages();
      })
      .catch(function () {
        setMessage(messageEl, isEditing ? "Could not update package." : "Could not add package.", "error");
      });
  });

  var clients = [];

  function renderClients() {
    var tbody = document.querySelector("#clients-table tbody");
    tbody.innerHTML = "";
    clients.forEach(function (c) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + c.email + "</td>" +
        "<td>" + (c.name || "") + "</td>" +
        "<td>" + c.balance + "</td>" +
        "<td></td>";

      var cell = tr.lastElementChild;
      var manageBtn = document.createElement("button");
      manageBtn.className = "link-button";
      manageBtn.textContent = "Manage";
      manageBtn.addEventListener("click", function () { openManagePanel(c); });
      cell.appendChild(manageBtn);

      tbody.appendChild(tr);
    });

    var select = document.getElementById("book-client");
    if (select) {
      var current = select.value;
      select.innerHTML = "";
      clients.forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.email + (c.name ? " (" + c.name + ")" : "");
        select.appendChild(opt);
      });
      if (current) select.value = current;
    }
  }

  function loadClients() {
    return fetch("/api/admin/clients")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        clients = data.clients;
        renderClients();
      });
  }

  // --- Manage-credits panel: view a client's grants, void one, grant a new one.

  var managePanel = document.getElementById("manage-panel");
  var currentManagedClientId = null;

  function openManagePanel(client) {
    currentManagedClientId = client.id;
    document.getElementById("manage-client-title").textContent =
      "Manage client — " + client.email;
    renderGrantPackageOptions();
    loadManageClient();
    managePanel.hidden = false;
    managePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function loadManageClient() {
    return fetch("/api/admin/clients/" + currentManagedClientId)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        document.getElementById("manage-client-email").value = data.client.email;
        document.getElementById("manage-client-name").value = data.client.name || "";
        document.getElementById("manage-client-phone").value = data.client.phone || "";
        renderManageLedger(data.ledger);
      });
  }

  function renderManageLedger(ledger) {
    var tbody = document.querySelector("#manage-ledger-table tbody");
    var table = document.getElementById("manage-ledger-table");
    var empty = document.getElementById("manage-ledger-empty");
    tbody.innerHTML = "";

    if (ledger.length === 0) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    ledger.forEach(function (row) {
      var tr = document.createElement("tr");
      var voided = row.sessions_remaining === 0;
      if (voided) tr.className = "archived-row";
      var expires = new Date(row.expires_at * 1000).toLocaleDateString();
      tr.innerHTML =
        "<td>" + row.package_name + "</td>" +
        "<td>" + row.sessions_remaining + " / " + row.sessions_granted + "</td>" +
        "<td>" + expires + "</td>" +
        "<td></td>";

      if (!voided) {
        var cell = tr.lastElementChild;
        var voidBtn = document.createElement("button");
        voidBtn.className = "link-button";
        voidBtn.textContent = "Void";
        voidBtn.addEventListener("click", function () {
          fetch(
            "/api/admin/clients/" + currentManagedClientId + "/credits/" + row.id + "/void",
            { method: "POST" },
          ).then(function () {
            return Promise.all([loadManageClient(), loadClients()]);
          });
        });
        cell.appendChild(voidBtn);
      }

      tbody.appendChild(tr);
    });
  }

  document.getElementById("client-info-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var messageEl = document.getElementById("client-info-message");
    var body = {
      email: document.getElementById("manage-client-email").value,
      name: document.getElementById("manage-client-name").value,
      phone: document.getElementById("manage-client-phone").value,
    };

    fetch("/api/admin/clients/" + currentManagedClientId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
        setMessage(messageEl, "Client info updated.", "success");
        return Promise.all([loadManageClient(), loadClients()]);
      })
      .catch(function (err) {
        setMessage(messageEl, err.message || "Could not update client info.", "error");
      });
  });

  document.getElementById("grant-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var messageEl = document.getElementById("grant-message");
    var sessionsInput = document.getElementById("grant-sessions").value;
    var expiresInput = document.getElementById("grant-expires").value;

    var body = {
      package_id: parseInt(document.getElementById("grant-package").value, 10),
      note: document.getElementById("grant-note").value || undefined,
    };
    if (sessionsInput !== "") body.sessions = parseInt(sessionsInput, 10);
    if (expiresInput !== "") body.expires_on = expiresInput;

    fetch("/api/admin/clients/" + currentManagedClientId + "/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
        setMessage(messageEl, "Credits granted.", "success");
        document.getElementById("grant-sessions").value = "";
        document.getElementById("grant-expires").value = "";
        document.getElementById("grant-note").value = "";
        return Promise.all([loadManageClient(), loadClients()]);
      })
      .catch(function (err) {
        setMessage(messageEl, err.message || "Could not grant credits.", "error");
      });
  });

  document.getElementById("manage-close").addEventListener("click", function () {
    managePanel.hidden = true;
    currentManagedClientId = null;
  });

  document.getElementById("client-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var messageEl = document.getElementById("client-message");
    var body = {
      email: document.getElementById("client-email").value,
      name: document.getElementById("client-name").value || undefined,
      phone: document.getElementById("client-phone").value || undefined,
    };

    fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
        setMessage(messageEl, "Client added.", "success");
        e.target.reset();
        return loadClients();
      })
      .catch(function (err) {
        setMessage(messageEl, err.message || "Could not add client.", "error");
      });
  });

  document.getElementById("logout-link").addEventListener("click", function (e) {
    e.preventDefault();
    fetch("/api/auth/admin/logout", { method: "POST" }).then(function () {
      window.location.href = "/admin/";
    });
  });

  // --- Scheduling: business hours, settings, special dates, sessions -----

  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function phoenixParts(unixSeconds) {
    var shifted = new Date((unixSeconds - 7 * 3600) * 1000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth(),
      day: shifted.getUTCDate(),
      hours: shifted.getUTCHours(),
      minutes: shifted.getUTCMinutes(),
    };
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function formatPhoenixTime(unixSeconds) {
    var p = phoenixParts(unixSeconds);
    var h = p.hours % 12;
    if (h === 0) h = 12;
    var ampm = p.hours < 12 ? "AM" : "PM";
    var mm = p.minutes < 10 ? "0" + p.minutes : p.minutes;
    return h + ":" + mm + " " + ampm;
  }

  function formatPhoenixDate(unixSeconds) {
    var p = phoenixParts(unixSeconds);
    return MONTHS[p.month] + " " + p.day + ", " + p.year;
  }

  function minutesToTimeInput(min) {
    if (min === null || min === undefined) return "";
    var h = Math.floor(min / 60);
    var m = min % 60;
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m);
  }

  function timeInputToMinutes(value) {
    if (!value) return null;
    var parts = value.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  // --- Business hours ------------------------------------------------

  function loadHours() {
    return fetch("/api/admin/business-hours")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderHours(data.hours); });
  }

  function renderHours(hours) {
    var tbody = document.querySelector("#hours-table tbody");
    tbody.innerHTML = "";
    hours.forEach(function (h) {
      var tr = document.createElement("tr");
      tr.dataset.day = h.day_of_week;
      tr.innerHTML =
        "<td>" + DAY_NAMES[h.day_of_week] + "</td>" +
        "<td><input type=\"checkbox\" class=\"hours-closed\"" + (h.is_closed ? " checked" : "") + "></td>" +
        "<td><input type=\"time\" class=\"hours-open\" value=\"" + minutesToTimeInput(h.open_minute) + "\"></td>" +
        "<td><input type=\"time\" class=\"hours-close\" value=\"" + minutesToTimeInput(h.close_minute) + "\"></td>";
      tbody.appendChild(tr);
    });
  }

  document.getElementById("save-hours-btn").addEventListener("click", function () {
    var messageEl = document.getElementById("hours-message");
    var days = [];
    document.querySelectorAll("#hours-table tbody tr").forEach(function (tr) {
      var isClosed = tr.querySelector(".hours-closed").checked;
      days.push({
        day_of_week: parseInt(tr.dataset.day, 10),
        is_closed: isClosed,
        open_minute: isClosed ? null : timeInputToMinutes(tr.querySelector(".hours-open").value),
        close_minute: isClosed ? null : timeInputToMinutes(tr.querySelector(".hours-close").value),
      });
    });

    fetch("/api/admin/business-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: days }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error();
        setMessage(messageEl, "Business hours saved.", "success");
      })
      .catch(function () {
        setMessage(messageEl, "Could not save business hours.", "error");
      });
  });

  // --- Booking settings ------------------------------------------------

  function loadSettings() {
    return fetch("/api/admin/settings")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        document.getElementById("setting-buffer-before").value = data.bufferBeforeMinutes;
        document.getElementById("setting-buffer-after").value = data.bufferAfterMinutes;
        document.getElementById("setting-reschedule-window").value = data.rescheduleWindowHours;
      });
  }

  document.getElementById("save-settings-btn").addEventListener("click", function () {
    var messageEl = document.getElementById("settings-message");
    var body = {
      buffer_before_minutes: parseInt(document.getElementById("setting-buffer-before").value, 10),
      buffer_after_minutes: parseInt(document.getElementById("setting-buffer-after").value, 10),
      reschedule_window_hours: parseInt(document.getElementById("setting-reschedule-window").value, 10),
    };

    fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) throw new Error();
        setMessage(messageEl, "Settings saved.", "success");
      })
      .catch(function () {
        setMessage(messageEl, "Could not save settings.", "error");
      });
  });

  // --- Special dates (business hours overrides) -------------------------

  function loadOverrides() {
    return fetch("/api/admin/business-hours/overrides")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderOverrides(data.overrides); });
  }

  function renderOverrides(overrides) {
    var tbody = document.querySelector("#overrides-table tbody");
    tbody.innerHTML = "";
    overrides.forEach(function (o) {
      var tr = document.createElement("tr");
      var hoursText = o.is_closed
        ? "Closed"
        : minutesToTimeInput(o.open_minute) + " – " + minutesToTimeInput(o.close_minute);
      tr.innerHTML =
        "<td>" + o.date + "</td>" +
        "<td>" + hoursText + "</td>" +
        "<td>" + (o.note || "") + "</td>" +
        "<td></td>";

      var cell = tr.lastElementChild;
      var deleteBtn = document.createElement("button");
      deleteBtn.className = "link-button";
      deleteBtn.textContent = "Remove";
      deleteBtn.addEventListener("click", function () {
        fetch("/api/admin/business-hours/overrides/" + o.date, { method: "DELETE" }).then(loadOverrides);
      });
      cell.appendChild(deleteBtn);

      tbody.appendChild(tr);
    });
  }

  document.getElementById("override-closed").addEventListener("change", function () {
    var disabled = this.checked;
    document.getElementById("override-open").disabled = disabled;
    document.getElementById("override-close").disabled = disabled;
  });

  document.getElementById("override-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var messageEl = document.getElementById("override-message");
    var isClosed = document.getElementById("override-closed").checked;
    var body = {
      date: document.getElementById("override-date").value,
      is_closed: isClosed,
      open_minute: isClosed ? null : timeInputToMinutes(document.getElementById("override-open").value),
      close_minute: isClosed ? null : timeInputToMinutes(document.getElementById("override-close").value),
      note: document.getElementById("override-note").value || undefined,
    };

    fetch("/api/admin/business-hours/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) throw new Error();
        setMessage(messageEl, "Saved.", "success");
        e.target.reset();
        document.getElementById("override-closed").checked = true;
        return loadOverrides();
      })
      .catch(function () {
        setMessage(messageEl, "Could not save that date.", "error");
      });
  });

  // --- Admin override booking --------------------------------------------

  document.getElementById("admin-book-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var messageEl = document.getElementById("admin-book-message");
    var date = document.getElementById("book-date").value;
    var time = document.getElementById("book-time").value;
    var durationInput = document.getElementById("book-duration").value;

    if (!date || !time) {
      setMessage(messageEl, "Date and time are required.", "error");
      return;
    }

    var minutes = timeInputToMinutes(time);
    var startsAt = Math.floor(Date.parse(date + "T00:00:00Z") / 1000) + 7 * 3600 + minutes * 60;

    var body = {
      client_id: parseInt(document.getElementById("book-client").value, 10),
      starts_at: startsAt,
      deduct: document.getElementById("book-deduct").checked,
    };
    if (durationInput !== "") body.duration_minutes = parseInt(durationInput, 10);

    fetch("/api/admin/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
        setMessage(messageEl, "Session booked.", "success");
        e.target.reset();
        document.getElementById("book-deduct").checked = true;
        return Promise.all([loadUpcomingSessions(), loadClients()]);
      })
      .catch(function (err) {
        setMessage(messageEl, err.message || "Could not book that session.", "error");
      });
  });

  // --- Upcoming sessions ---------------------------------------------

  function loadUpcomingSessions() {
    var now = Math.floor(Date.now() / 1000);
    return fetch("/api/admin/sessions?status=booked&from=" + now)
      .then(function (res) { return res.json(); })
      .then(function (data) { renderUpcomingSessions(data.sessions); });
  }

  function renderUpcomingSessions(sessions) {
    var tbody = document.querySelector("#upcoming-sessions-table tbody");
    var table = document.getElementById("upcoming-sessions-table");
    var empty = document.getElementById("upcoming-sessions-empty");
    tbody.innerHTML = "";

    if (sessions.length === 0) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    sessions.forEach(function (s) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + s.client_email + "</td>" +
        "<td>" + formatPhoenixDate(s.starts_at) + "</td>" +
        "<td>" + formatPhoenixTime(s.starts_at) + "</td>" +
        "<td></td>";

      var cell = tr.lastElementChild;

      var rescheduleBtn = document.createElement("button");
      rescheduleBtn.className = "link-button";
      rescheduleBtn.textContent = "Reschedule";
      rescheduleBtn.addEventListener("click", function () { toggleRescheduleRow(tr, s); });
      cell.appendChild(rescheduleBtn);

      cell.appendChild(document.createTextNode(" "));

      var cancelBtn = document.createElement("button");
      cancelBtn.className = "link-button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", function () {
        var restore = window.confirm(
          "Cancel this session. Click OK to also restore the credit, Cancel to burn it (default).",
        );
        fetch("/api/admin/sessions/" + s.id + "/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restore_credit: restore }),
        }).then(function () {
          return Promise.all([loadUpcomingSessions(), loadCancellations(), loadClients()]);
        });
      });
      cell.appendChild(cancelBtn);

      tbody.appendChild(tr);
    });
  }

  function toggleRescheduleRow(tr, session) {
    var existing = tr.nextElementSibling;
    if (existing && existing.classList.contains("reschedule-row")) {
      existing.remove();
      return;
    }

    var editRow = document.createElement("tr");
    editRow.className = "reschedule-row";
    var td = document.createElement("td");
    td.colSpan = 4;
    var dateInput = document.createElement("input");
    dateInput.type = "date";
    var p = phoenixParts(session.starts_at);
    var mm = (p.month + 1) < 10 ? "0" + (p.month + 1) : (p.month + 1);
    var dd = p.day < 10 ? "0" + p.day : p.day;
    dateInput.value = p.year + "-" + mm + "-" + dd;

    var timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.style.marginLeft = "0.5rem";
    timeInput.value = minutesToTimeInput(p.hours * 60 + p.minutes);

    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "portal-button";
    saveBtn.style.marginLeft = "0.5rem";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", function () {
      var minutes = timeInputToMinutes(timeInput.value);
      var startsAt = Math.floor(Date.parse(dateInput.value + "T00:00:00Z") / 1000) + 7 * 3600 + minutes * 60;
      fetch("/api/admin/sessions/" + session.id + "/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starts_at: startsAt }),
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
          return loadUpcomingSessions();
        })
        .catch(function (err) { window.alert(err.message || "Could not reschedule."); });
    });

    td.appendChild(dateInput);
    td.appendChild(timeInput);
    td.appendChild(saveBtn);
    editRow.appendChild(td);
    tr.parentNode.insertBefore(editRow, tr.nextSibling);
  }

  // --- Cancellations ---------------------------------------------------

  function loadCancellations() {
    return fetch("/api/admin/sessions?status=cancelled")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderCancellations(data.sessions); });
  }

  function renderCancellations(sessions) {
    var tbody = document.querySelector("#cancellations-table tbody");
    var table = document.getElementById("cancellations-table");
    var empty = document.getElementById("cancellations-empty");
    tbody.innerHTML = "";

    if (sessions.length === 0) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    sessions
      .sort(function (a, b) { return b.cancelled_at - a.cancelled_at; })
      .forEach(function (s) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + s.client_email + "</td>" +
          "<td>" + formatPhoenixDate(s.starts_at) + " " + formatPhoenixTime(s.starts_at) + "</td>" +
          "<td>" + s.cancelled_reason + "</td>" +
          "<td>" + (s.credit_restored ? "Restored" : "Burned") + "</td>" +
          "<td></td>";

        if (!s.credit_restored) {
          var cell = tr.lastElementChild;
          var restoreBtn = document.createElement("button");
          restoreBtn.className = "link-button";
          restoreBtn.textContent = "Restore credit";
          restoreBtn.addEventListener("click", function () {
            fetch("/api/admin/sessions/" + s.id + "/restore-credit", { method: "POST" }).then(function () {
              return Promise.all([loadCancellations(), loadClients()]);
            });
          });
          cell.appendChild(restoreBtn);
        }

        tbody.appendChild(tr);
      });
  }

  // --- Google Calendar connection ----------------------------------------

  function loadGoogleStatus() {
    var statusEl = document.getElementById("google-status");
    var connectBtn = document.getElementById("google-connect-btn");
    var disconnectBtn = document.getElementById("google-disconnect-btn");

    return fetch("/api/admin/google/status")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.connected) {
          statusEl.className = "portal-message success";
          statusEl.textContent = "Connected — availability checks your calendar, and bookings sync to it.";
          connectBtn.hidden = true;
          disconnectBtn.hidden = false;
        } else if (!data.configured) {
          statusEl.className = "portal-message error";
          statusEl.textContent = "Not configured yet — the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets need to be added first.";
          connectBtn.hidden = true;
          disconnectBtn.hidden = true;
        } else {
          statusEl.className = "portal-message";
          statusEl.textContent = "Not connected.";
          connectBtn.hidden = false;
          disconnectBtn.hidden = true;
        }
      });
  }

  document.getElementById("google-disconnect-btn").addEventListener("click", function () {
    if (!window.confirm("Disconnect Google Calendar? Availability will stop checking your calendar and bookings will no longer sync to it.")) return;
    fetch("/api/admin/google/disconnect", { method: "POST" }).then(loadGoogleStatus);
  });

  var googleParam = new URLSearchParams(window.location.search).get("google");
  if (googleParam === "connected") {
    window.history.replaceState({}, "", "/admin/dashboard.html");
  } else if (googleParam === "denied") {
    window.setTimeout(function () {
      var statusEl = document.getElementById("google-status");
      statusEl.className = "portal-message error";
      statusEl.textContent = "Google connection was denied or cancelled. Try again.";
    }, 500);
    window.history.replaceState({}, "", "/admin/dashboard.html");
  }

  loadPackages().then(loadClients);
  loadHours();
  loadSettings();
  loadOverrides();
  loadUpcomingSessions();
  loadCancellations();
  loadGoogleStatus();
})();
