(function () {
  "use strict";

  var form = document.getElementById("request-link-form");
  if (form) {
    // Already logged in on this browser (valid 6-month session)? Skip
    // straight to the dashboard instead of showing the login form again.
    fetch("/api/me").then(function (res) {
      if (res.ok) window.location.href = "/app/dashboard.html";
    });

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
          messageEl.textContent = data.message || "Check your email or phone for a login link.";
        })
        .catch(function () {
          messageEl.className = "portal-message error";
          messageEl.textContent = "Something went wrong. Please try again.";
        });
    });
  }

  var balanceEl = document.getElementById("balance");
  if (balanceEl) {
    // Session check — also prefills the phone field below. Balance/credits
    // rendering itself is handled by loadCreditsAndBalance() further down.
    fetch("/api/me").then(function (res) {
      if (res.status === 401) { window.location.href = "/app/"; return null; }
      return res.json();
    }).then(function (data) {
      if (!data || !data.client) return;
      var phoneInput = document.getElementById("my-phone");
      if (phoneInput) phoneInput.value = data.client.phone || "";
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

    var savePhoneBtn = document.getElementById("save-phone-btn");
    if (savePhoneBtn) {
      savePhoneBtn.addEventListener("click", function () {
        var messageEl = document.getElementById("phone-message");
        messageEl.className = "portal-message";
        messageEl.textContent = "Saving…";
        fetch("/api/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: document.getElementById("my-phone").value }),
        })
          .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
          .then(function (r) {
            if (!r.ok) throw new Error(r.data.error);
            messageEl.className = "portal-message success";
            messageEl.textContent = "Phone number saved.";
          })
          .catch(function (err) {
            messageEl.className = "portal-message error";
            messageEl.textContent = err.message || "Could not save phone number.";
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

  var calGrid = document.getElementById("cal-grid");
  if (calGrid) {
    var slotsGrid = document.getElementById("slots-grid");
    var daySlotsTitle = document.getElementById("day-slots-title");
    var bookingMessage = document.getElementById("booking-message");
    var bookingTitle = document.getElementById("booking-title");
    var bookingCancelBtn = document.getElementById("booking-cancel");
    var reschedulingSessionId = null;
    var selectedDate = null;
    var currentBalance = 0;
    var dropInPkg = null;
    var paymentsEnabled = false;

    // Current Phoenix year/month drives the initial calendar view.
    var nowParts = phoenixParts(Math.floor(Date.now() / 1000));
    var viewYear = nowParts.year;
    var viewMonth = nowParts.month; // 0-based

    var DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTHS_FULL = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];

    function setBookingMessage(text, kind) {
      bookingMessage.className = "portal-message" + (kind ? " " + kind : "");
      bookingMessage.textContent = text;
    }

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function money(cents) { return "$" + (cents / 100).toFixed(2); }

    function payMethod() {
      var row = document.getElementById("pay-method-row");
      if (row.hidden) return "credit";
      return document.getElementById("pay-dropin").checked ? "drop_in" : "credit";
    }

    function updatePayMethodRow() {
      var row = document.getElementById("pay-method-row");
      var showDropIn = dropInPkg && paymentsEnabled && !reschedulingSessionId;
      if (!showDropIn) {
        row.hidden = true;
        return;
      }
      row.hidden = false;
      document.getElementById("pay-credit-label").textContent =
        "Use a session credit (" + currentBalance + " left)";
      document.getElementById("pay-dropin-label").textContent =
        "Pay for a single session (" + money(dropInPkg.price_cents) + ")";

      var creditRadio = document.getElementById("pay-credit");
      creditRadio.disabled = currentBalance === 0;
      if (currentBalance === 0) {
        document.getElementById("pay-dropin").checked = true;
      }
    }

    document.getElementById("pay-credit").addEventListener("change", loadSlotsForSelectedDate);
    document.getElementById("pay-dropin").addEventListener("change", loadSlotsForSelectedDate);

    function loadPackages() {
      return fetch("/api/app/packages")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          paymentsEnabled = data.payments_enabled;
          var buyable = [];
          data.packages.forEach(function (p) {
            if (p.is_drop_in) { dropInPkg = p; return; }
            if (p.price_cents > 0) buyable.push(p);
          });

          var card = document.getElementById("buy-card");
          if (!paymentsEnabled || buyable.length === 0) {
            card.hidden = true;
          } else {
            card.hidden = false;
            var tbody = document.querySelector("#buy-table tbody");
            tbody.innerHTML = "";
            buyable.forEach(function (p) {
              var tr = document.createElement("tr");
              tr.innerHTML =
                "<td>" + p.name + "</td>" +
                "<td>" + p.session_count + "</td>" +
                "<td>" + money(p.price_cents) + "</td>" +
                "<td></td>";
              var buyBtn = document.createElement("button");
              buyBtn.className = "portal-button";
              buyBtn.textContent = "Buy";
              buyBtn.addEventListener("click", function () {
                var messageEl = document.getElementById("buy-message");
                messageEl.className = "portal-message";
                messageEl.textContent = "Redirecting to secure checkout…";
                fetch("/api/app/checkout/package", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ package_id: p.id }),
                })
                  .then(function (res) {
                    if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
                    return res.json();
                  })
                  .then(function (data) { window.location.href = data.url; })
                  .catch(function (err) {
                    messageEl.className = "portal-message error";
                    messageEl.textContent = err.message || "Could not start checkout.";
                  });
              });
              tr.lastElementChild.appendChild(buyBtn);
              tbody.appendChild(tr);
            });
          }
          updatePayMethodRow();
        });
    }

    function monthStr() {
      return viewYear + "-" + pad2(viewMonth + 1);
    }

    function clearSlots(title) {
      daySlotsTitle.textContent = title || "Pick a date";
      slotsGrid.innerHTML = "";
    }

    function renderCalendar() {
      document.getElementById("cal-month-label").textContent =
        MONTHS_FULL[viewMonth] + " " + viewYear;

      // Don't navigate before the current month.
      document.getElementById("cal-prev").disabled =
        viewYear === nowParts.year && viewMonth === nowParts.month;

      calGrid.innerHTML = "";
      DOW_LABELS.forEach(function (label) {
        var el = document.createElement("div");
        el.className = "cal-dow";
        el.textContent = label;
        calGrid.appendChild(el);
      });

      fetch("/api/app/month?month=" + monthStr())
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
          for (var i = 0; i < firstDow; i++) {
            calGrid.appendChild(document.createElement("div"));
          }

          data.days.forEach(function (day) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cal-day" + (day.open ? " open" : "");
            btn.textContent = String(parseInt(day.date.slice(8), 10));
            btn.disabled = !day.open;
            if (day.date === selectedDate) btn.className += " selected";
            if (day.open) {
              btn.addEventListener("click", function () { selectDate(day.date, btn); });
            }
            calGrid.appendChild(btn);
          });
        });
    }

    function selectDate(dateStr, btn) {
      selectedDate = dateStr;
      calGrid.querySelectorAll(".cal-day.selected").forEach(function (el) {
        el.classList.remove("selected");
      });
      btn.classList.add("selected");
      loadSlotsForSelectedDate();
    }

    function loadSlotsForSelectedDate() {
      if (!selectedDate) return;
      setBookingMessage("");
      var d = new Date(selectedDate + "T00:00:00Z");
      var dayTitle = DOW_LABELS[d.getUTCDay()] + ", " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
      clearSlots("Loading…");

      var url = "/api/app/availability?date=" + selectedDate;
      if (reschedulingSessionId) url += "&reschedule_session_id=" + reschedulingSessionId;
      else if (payMethod() === "drop_in") url += "&mode=drop_in";

      fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.message) {
            clearSlots(dayTitle);
            setBookingMessage(data.message, "error");
            return;
          }
          if (data.slots.length === 0) {
            clearSlots(dayTitle);
            var none = document.createElement("p");
            none.className = "portal-empty";
            none.textContent = "No open times this day.";
            slotsGrid.appendChild(none);
            return;
          }
          clearSlots(dayTitle);
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

    document.getElementById("cal-prev").addEventListener("click", function () {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendar();
    });

    document.getElementById("cal-next").addEventListener("click", function () {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendar();
    });

    function exitRescheduleMode() {
      reschedulingSessionId = null;
      bookingTitle.textContent = "Book a session";
      bookingCancelBtn.hidden = true;
      selectedDate = null;
      clearSlots();
      renderCalendar();
      setBookingMessage("");
      updatePayMethodRow();
    }

    function enterRescheduleMode(session) {
      reschedulingSessionId = session.id;
      bookingTitle.textContent = "Reschedule session";
      bookingCancelBtn.hidden = false;
      updatePayMethodRow();
      var p = phoenixParts(session.starts_at);
      viewYear = p.year;
      viewMonth = p.month;
      selectedDate = p.year + "-" + pad2(p.month + 1) + "-" + pad2(p.day);
      setBookingMessage("Pick a new time for your session.");
      renderCalendar();
      loadSlotsForSelectedDate();
      bookingTitle.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    bookingCancelBtn.addEventListener("click", exitRescheduleMode);

    function confirmSlot(startsAt) {
      var isReschedule = reschedulingSessionId !== null;

      if (!isReschedule && payMethod() === "drop_in") {
        setBookingMessage("Redirecting to secure checkout — your slot is held for 30 minutes…");
        fetch("/api/app/checkout/drop-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starts_at: startsAt }),
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
            return res.json();
          })
          .then(function (data) { window.location.href = data.url; })
          .catch(function (err) {
            setBookingMessage(err.message || "Could not start checkout.", "error");
            loadSlotsForSelectedDate();
          });
        return;
      }

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
          loadSlotsForSelectedDate();
        });
    }

    function loadCreditsAndBalance() {
      return fetch("/api/me/credits")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          balanceEl.textContent = data.balance;
          currentBalance = data.balance;
          updatePayMethodRow();
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

    // Post-checkout redirect messaging. Fulfillment happens via Stripe's
    // webhook, which can lag the redirect by a few seconds — refresh shortly.
    var purchaseParam = new URLSearchParams(window.location.search).get("purchase");
    if (purchaseParam === "success") {
      setBookingMessage("Payment received! Your account will update in a few seconds…", "success");
      window.history.replaceState({}, "", "/app/dashboard.html");
      window.setTimeout(function () {
        Promise.all([loadCreditsAndBalance(), loadSessions()]).then(function () {
          setBookingMessage("Payment received — you're all set.", "success");
        });
      }, 4000);
    } else if (purchaseParam === "cancelled") {
      setBookingMessage("Checkout was cancelled — nothing was charged.");
      window.history.replaceState({}, "", "/app/dashboard.html");
    }

    loadSessions();
    renderCalendar();
    loadPackages();
    loadCreditsAndBalance();
  }
})();
