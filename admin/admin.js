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

  function renderClients(clients) {
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
  }

  function loadClients() {
    return fetch("/api/admin/clients")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderClients(data.clients); });
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

  loadPackages().then(loadClients);
})();
