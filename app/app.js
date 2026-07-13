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

  // --- Booking + My sessions (Phoenix is fixed UTC-7, no DST, so time
  // display is computed manually rather than relying on the browser's own
  // timezone, which could be anything). --------------------------------

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

  var bookingDateInput = document.getElementById("booking-date");
  if (bookingDateInput) {
    var slotsGrid = document.getElementById("slots-grid");
    var bookingMessage = document.getElementById("booking-message");
    var bookingTitle = document.getElementById("booking-title");
    var bookingCancelBtn = document.getElementById("booking-cancel");
    var reschedulingSessionId = null;

    function setBookingMessage(text, kind) {
      bookingMessage.className = "portal-message" + (kind ? " " + kind : "");
      bookingMessage.textContent = text;
    }

    function exitRescheduleMode() {
      reschedulingSessionId = null;
      bookingTitle.textContent = "Book a session";
      bookingCancelBtn.hidden = true;
      slotsGrid.hidden = true;
      slotsGrid.innerHTML = "";
      setBookingMessage("");
    }

    function enterRescheduleMode(session) {
      reschedulingSessionId = session.id;
      bookingTitle.textContent = "Reschedule session";
      bookingCancelBtn.hidden = false;
      var p = phoenixParts(session.starts_at);
      var mm = (p.month + 1) < 10 ? "0" + (p.month + 1) : (p.month + 1);
      var dd = p.day < 10 ? "0" + p.day : p.day;
      bookingDateInput.value = p.year + "-" + mm + "-" + dd;
      setBookingMessage("");
      document.getElementById("booking-title").scrollIntoView({ behavior: "smooth", block: "start" });
      findTimes();
    }

    bookingCancelBtn.addEventListener("click", exitRescheduleMode);

    function findTimes() {
      var date = bookingDateInput.value;
      if (!date) {
        setBookingMessage("Pick a date first.", "error");
        return;
      }
      setBookingMessage("Loading available times…");
      slotsGrid.hidden = true;
      slotsGrid.innerHTML = "";

      var url = "/api/app/availability?date=" + date;
      if (reschedulingSessionId) url += "&reschedule_session_id=" + reschedulingSessionId;

      fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.message) {
            setBookingMessage(data.message, "error");
            return;
          }
          if (data.slots.length === 0) {
            setBookingMessage("No available times that day. Try another date.");
            return;
          }
          setBookingMessage("");
          slotsGrid.hidden = false;
          data.slots.forEach(function (slot) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "slot-button";
            btn.textContent = formatPhoenixTime(slot.starts_at);
            btn.addEventListener("click", function () { confirmSlot(slot.starts_at); });
            slotsGrid.appendChild(btn);
          });
        });
    }

    function confirmSlot(startsAt) {
      var isReschedule = reschedulingSessionId !== null;
      var url = isReschedule
        ? "/api/app/sessions/" + reschedulingSessionId + "/reschedule"
        : "/api/app/sessions";

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starts_at: startsAt }),
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
          exitRescheduleMode();
          setBookingMessage(isReschedule ? "Session rescheduled." : "Session booked.", "success");
          return Promise.all([loadCreditsAndBalance(), loadSessions()]);
        })
        .catch(function (err) {
          setBookingMessage(err.message || "Could not book that time.", "error");
        });
    }

    document.getElementById("find-times-btn").addEventListener("click", findTimes);

    function loadCreditsAndBalance() {
      return fetch("/api/me/credits")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          balanceEl.textContent = data.balance;
          var table = document.getElementById("credits-table");
          var empty = document.getElementById("credits-empty");
          var tbody = table.querySelector("tbody");
          tbody.innerHTML = "";
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
    }

    function loadSessions() {
      return fetch("/api/app/sessions")
        .then(function (res) { return res.json(); })
        .then(function (data) { renderSessions(data.sessions); });
    }

    function renderSessions(sessions) {
      var tbody = document.querySelector("#sessions-table tbody");
      var table = document.getElementById("sessions-table");
      var empty = document.getElementById("sessions-empty");
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
          "<td>" + formatPhoenixDate(s.starts_at) + "</td>" +
          "<td>" + formatPhoenixTime(s.starts_at) + "</td>" +
          "<td><span class=\"status-badge " + s.status + "\">" + s.status + "</span></td>" +
          "<td></td>";

        var cell = tr.lastElementChild;
        if (s.status === "booked" && s.starts_at > Math.floor(Date.now() / 1000)) {
          var rescheduleBtn = document.createElement("button");
          rescheduleBtn.className = "link-button";
          rescheduleBtn.textContent = "Reschedule";
          rescheduleBtn.addEventListener("click", function () { enterRescheduleMode(s); });
          cell.appendChild(rescheduleBtn);

          cell.appendChild(document.createTextNode(" "));

          var cancelBtn = document.createElement("button");
          cancelBtn.className = "link-button";
          cancelBtn.textContent = "Cancel";
          cancelBtn.addEventListener("click", function () {
            fetch("/api/app/sessions/" + s.id + "/cancel", { method: "POST" })
              .then(function (res) {
                if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
                return Promise.all([loadCreditsAndBalance(), loadSessions()]);
              })
              .catch(function (err) {
                setBookingMessage(err.message || "Could not cancel that session.", "error");
              });
          });
          cell.appendChild(cancelBtn);
        }

        tbody.appendChild(tr);
      });
    }

    loadSessions();
  }
})();
