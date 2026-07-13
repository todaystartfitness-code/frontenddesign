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
        "<td></td>";
      var actionCell = tr.lastElementChild;
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

  function loadPackages() {
    return requireAuth()
      .then(function (res) { return res.json(); })
      .then(function (data) {
        packages = data.packages;
        renderPackages();
        renderClientGrantOptions();
      });
  }

  function renderClientGrantOptions() {
    document.querySelectorAll(".grant-package-select").forEach(function (select) {
      var current = select.value;
      select.innerHTML = "";
      packages.filter(function (p) { return !p.archived; }).forEach(function (p) {
        var opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      if (current) select.value = current;
    });
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

    fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (!res.ok) throw new Error();
        setMessage(messageEl, "Package added.", "success");
        e.target.reset();
        return loadPackages();
      })
      .catch(function () {
        setMessage(messageEl, "Could not add package.", "error");
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
      var select = document.createElement("select");
      select.className = "grant-package-select";
      cell.appendChild(select);

      var grantBtn = document.createElement("button");
      grantBtn.className = "link-button";
      grantBtn.style.marginLeft = "0.5rem";
      grantBtn.textContent = "Grant";
      grantBtn.addEventListener("click", function () {
        fetch("/api/admin/clients/" + c.id + "/credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package_id: parseInt(select.value, 10) }),
        }).then(loadClients);
      });
      cell.appendChild(grantBtn);

      tbody.appendChild(tr);
    });
    renderClientGrantOptions();
  }

  function loadClients() {
    return fetch("/api/admin/clients")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderClients(data.clients); });
  }

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
