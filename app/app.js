(function () {
  "use strict";

  var form = document.getElementById("request-link-form");
  if (form) {
    var messageEl = document.getElementById("form-message");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("email").value;
      messageEl.className = "portal-message";
      messageEl.textContent = "Sending…";

      fetch("/api/auth/app/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          messageEl.className = "portal-message success";
          messageEl.textContent = data.message || "Check your email for a login link.";
        })
        .catch(function () {
          messageEl.className = "portal-message error";
          messageEl.textContent = "Something went wrong. Please try again.";
        });
    });
  }

  var balanceEl = document.getElementById("balance");
  if (balanceEl) {
    fetch("/api/me")
      .then(function (res) {
        if (res.status === 401) {
          window.location.href = "/app/";
          return null;
        }
        return res.json();
      })
      .then(function () { return fetch("/api/me/credits"); })
      .then(function (res) { return res && res.json(); })
      .then(function (data) {
        if (!data) return;
        balanceEl.textContent = data.balance;

        var table = document.getElementById("credits-table");
        var empty = document.getElementById("credits-empty");
        var tbody = table.querySelector("tbody");

        if (data.ledger.length === 0) {
          empty.hidden = false;
          table.hidden = true;
          return;
        }

        empty.hidden = true;
        table.hidden = false;
        data.ledger.forEach(function (row) {
          var tr = document.createElement("tr");
          var expires = new Date(row.expires_at * 1000).toLocaleDateString();
          tr.innerHTML =
            "<td>" + row.package_name + "</td>" +
            "<td>" + row.sessions_remaining + "</td>" +
            "<td>" + expires + "</td>";
          tbody.appendChild(tr);
        });
      });

    var logoutLink = document.getElementById("logout-link");
    if (logoutLink) {
      logoutLink.addEventListener("click", function (e) {
        e.preventDefault();
        fetch("/api/auth/app/logout", { method: "POST" }).then(function () {
          window.location.href = "/app/";
        });
      });
    }
  }
})();
