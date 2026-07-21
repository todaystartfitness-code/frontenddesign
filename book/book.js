(function () {
  "use strict";

  // Phoenix (America/Phoenix) is a fixed UTC-7 offset year-round — same
  // manual arithmetic approach used throughout the app (see availability.ts).
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
  var MONTHS_FULL = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function formatPhoenixTime(unixSeconds) {
    var p = phoenixParts(unixSeconds);
    var h = p.hours % 12;
    if (h === 0) h = 12;
    var ampm = p.hours < 12 ? "AM" : "PM";
    var mm = p.minutes < 10 ? "0" + p.minutes : p.minutes;
    return h + ":" + mm + " " + ampm;
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function money(cents) { return "$" + (cents / 100).toFixed(2); }
  function setMessage(el, text, kind) {
    el.className = "portal-message" + (kind ? " " + kind : "");
    el.textContent = text;
  }

  // --- Step machine --------------------------------------------------

  var quizQuestions = [];
  var quizAnswers = {}; // question_id -> answer string
  var packages = [];
  var selectedPackage = null;
  var preselectedPackageId = null;
  var selectedDate = null;
  var selectedSlot = null;

  // Package first, then time, then (if this offer needs it) the
  // assessment, then contact/checkout — recomputed once a package is
  // known, since whether the quiz applies depends on which one.
  var stepOrder = [];

  function computeStepOrder() {
    stepOrder = [];
    if (!preselectedPackageId) stepOrder.push("package");
    stepOrder.push("calendar");
    if (selectedPackage && selectedPackage.requires_quiz && quizQuestions.length > 0) {
      stepOrder.push("quiz");
    }
    stepOrder.push("contact", "done");
  }

  var currentStepIndex = 0;

  function showStep(name) {
    document.querySelectorAll(".book-step").forEach(function (el) { el.classList.remove("active"); });
    document.getElementById("step-" + name).classList.add("active");
    currentStepIndex = stepOrder.indexOf(name);
    var progressEl = document.getElementById("book-progress");
    if (name === "done" || stepOrder.length <= 1) {
      progressEl.textContent = "";
    } else {
      progressEl.textContent = "Step " + (currentStepIndex + 1) + " of " + (stepOrder.length - 1);
    }
  }

  function goToStep(name) { showStep(name); }

  function nextStep() {
    var next = stepOrder[currentStepIndex + 1];
    if (next) showStep(next);
  }

  function prevStep() {
    var prev = stepOrder[currentStepIndex - 1];
    if (prev) showStep(prev);
  }

  // --- Quiz step -------------------------------------------------------

  function renderQuizQuestions() {
    var container = document.getElementById("quiz-questions");
    container.innerHTML = "";
    quizQuestions.forEach(function (q) {
      var wrap = document.createElement("div");
      wrap.className = "quiz-question";
      var label = document.createElement("label");
      label.className = "quiz-prompt";
      label.textContent = q.prompt;
      wrap.appendChild(label);

      if (q.question_type === "short_text") {
        var input = document.createElement("input");
        input.type = "text";
        input.addEventListener("input", function () { quizAnswers[q.id] = input.value; });
        wrap.appendChild(input);
      } else {
        var optionsWrap = document.createElement("div");
        optionsWrap.className = "quiz-options";
        var choices = q.question_type === "scale_1_10"
          ? ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
          : (q.options || []);
        choices.forEach(function (choice) {
          var optRow = document.createElement("label");
          optRow.className = "quiz-option";
          var radio = document.createElement("input");
          radio.type = "radio";
          radio.name = "quiz-q-" + q.id;
          radio.value = choice;
          radio.addEventListener("change", function () { quizAnswers[q.id] = choice; });
          optRow.appendChild(radio);
          optRow.appendChild(document.createTextNode(choice));
          optionsWrap.appendChild(optRow);
        });
        wrap.appendChild(optionsWrap);
      }
      container.appendChild(wrap);
    });
  }

  document.getElementById("quiz-continue").addEventListener("click", function () {
    nextStep();
  });

  // --- Package step ------------------------------------------------------

  function renderPackageList() {
    var container = document.getElementById("package-list");
    container.innerHTML = "";
    packages.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "package-option";
      var left = document.createElement("div");
      left.innerHTML =
        "<div class=\"package-name\">" + p.name + "</div>" +
        "<div>" + p.session_count + " session" + (p.session_count === 1 ? "" : "s") +
        " &middot; " + p.session_duration_minutes + " min</div>";
      var right = document.createElement("div");
      right.className = "package-price";
      right.textContent = p.requires_payment ? money(p.price_cents) : "Free";
      row.appendChild(left);
      row.appendChild(right);
      row.addEventListener("click", function () { selectPackage(p); });
      container.appendChild(row);
    });
  }

  function selectPackage(p) {
    selectedPackage = p;
    document.querySelectorAll(".package-option").forEach(function (el) { el.classList.remove("selected"); });
    updateOfferHeader();
    // Whether the quiz step applies depends on the package just chosen, so
    // the step order can only be finalized now. "package" (when present) is
    // always first, so the step right after it is always "calendar".
    computeStepOrder();
    showStep("calendar");
  }

  function updateOfferHeader() {
    var offerEl = document.getElementById("book-offer");
    if (!selectedPackage) { offerEl.hidden = true; return; }
    document.getElementById("book-offer-name").textContent = selectedPackage.name;
    var descEl = document.getElementById("book-offer-description");
    if (selectedPackage.description) {
      descEl.textContent = selectedPackage.description;
      descEl.hidden = false;
    } else {
      descEl.hidden = true;
    }
    offerEl.hidden = false;
  }

  // --- Calendar step -------------------------------------------------

  var calGrid = document.getElementById("cal-grid");
  var slotsGrid = document.getElementById("slots-grid");
  var daySlotsTitle = document.getElementById("day-slots-title");
  var nowParts = phoenixParts(Math.floor(Date.now() / 1000));
  var viewYear = nowParts.year;
  var viewMonth = nowParts.month;

  function monthStr() { return viewYear + "-" + pad2(viewMonth + 1); }

  function clearSlots(title) {
    daySlotsTitle.textContent = title || "Pick a date";
    slotsGrid.innerHTML = "";
  }

  function renderCalendar() {
    document.getElementById("cal-month-label").textContent = MONTHS_FULL[viewMonth] + " " + viewYear;
    document.getElementById("cal-prev").disabled = viewYear === nowParts.year && viewMonth === nowParts.month;

    calGrid.innerHTML = "";
    DOW_LABELS.forEach(function (label) {
      var el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = label;
      calGrid.appendChild(el);
    });

    fetch("/api/public/month?month=" + monthStr())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
        for (var i = 0; i < firstDow; i++) calGrid.appendChild(document.createElement("div"));

        data.days.forEach(function (day) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cal-day" + (day.open ? " open" : "");
          btn.textContent = String(parseInt(day.date.slice(8), 10));
          btn.disabled = !day.open;
          if (day.date === selectedDate) btn.className += " selected";
          if (day.open) btn.addEventListener("click", function () { selectDate(day.date, btn); });
          calGrid.appendChild(btn);
        });
      })
      .catch(function () {
        setMessage(
          document.getElementById("calendar-message"),
          "Could not load the calendar. Please refresh and try again.",
          "error",
        );
      });
  }

  function selectDate(dateStr, btn) {
    selectedDate = dateStr;
    calGrid.querySelectorAll(".cal-day.selected").forEach(function (el) { el.classList.remove("selected"); });
    btn.classList.add("selected");
    loadSlotsForSelectedDate();
  }

  function loadSlotsForSelectedDate() {
    if (!selectedDate || !selectedPackage) return;
    var d = new Date(selectedDate + "T00:00:00Z");
    var dayTitle = DOW_LABELS[d.getUTCDay()] + ", " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
    clearSlots("Loading…");

    fetch("/api/public/availability?package_id=" + selectedPackage.id + "&date=" + selectedDate)
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || "Could not load available times.");
        var data = r.data;
        if (!data.slots || data.slots.length === 0) {
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
          btn.addEventListener("click", function () {
            selectedSlot = slot.starts_at;
            nextStep();
          });
          slotsGrid.appendChild(btn);
        });
      })
      .catch(function (err) {
        clearSlots(dayTitle);
        setMessage(
          document.getElementById("calendar-message"),
          err.message || "Could not load available times. Please try again.",
          "error",
        );
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
  document.getElementById("calendar-back").addEventListener("click", prevStep);

  // --- Contact step ------------------------------------------------------

  document.getElementById("contact-back").addEventListener("click", prevStep);

  document.getElementById("contact-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var messageEl = document.getElementById("contact-message");
    setMessage(messageEl, "Submitting…");

    var answers = Object.keys(quizAnswers).map(function (qid) {
      return { question_id: Number(qid), answer: quizAnswers[qid] };
    });

    var body = {
      package_id: selectedPackage.id,
      starts_at: selectedSlot,
      name: document.getElementById("contact-name").value,
      email: document.getElementById("contact-email").value,
      phone: document.getElementById("contact-phone").value,
      quiz_answers: answers,
    };

    fetch("/api/public/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.error || "Could not complete booking.");
        if (r.data.url) {
          // Stripe Checkout refuses to render inside an iframe (it sends its
          // own frame-blocking headers) — when embedded via the popup modal,
          // this page IS an iframe, so hand the redirect to the top-level
          // window instead of navigating the iframe itself.
          var target = window.top !== window.self ? window.top : window;
          target.location.href = r.data.url;
          return;
        }
        setMessage(document.getElementById("done-message"), r.data.message || "You're booked!", "success");
        showStep("done");
      })
      .catch(function (err) {
        setMessage(messageEl, err.message || "Something went wrong. Please try again.", "error");
      });
  });

  // --- Boot ------------------------------------------------------------

  var params = new URLSearchParams(window.location.search);
  var bookedParam = params.get("booked");
  var cancelledParam = params.get("cancelled");
  // Accepts either a numeric package id or an exact (case-insensitive)
  // package name, e.g. ?package=6 or ?package=Thai%20Bodywork — the latter
  // lets a marketing-site button reference an offer without needing to know
  // its id, and keeps working if the id ever changes.
  preselectedPackageId = params.get("package") || null;

  if (params.get("embed") === "modal") {
    document.body.classList.add("embed-modal");
  }

  if (bookedParam === "1") {
    computeStepOrder();
    setMessage(
      document.getElementById("done-message"),
      "Payment received — you're booked! Check your email or phone for a link to manage your session.",
      "success",
    );
    showStep("done");
    window.history.replaceState({}, "", "/book/");
  } else {
    Promise.all([
      fetch("/api/public/quiz").then(function (res) { return res.json(); }),
      fetch("/api/public/packages").then(function (res) { return res.json(); }),
    ]).then(function (results) {
      quizQuestions = results[0].questions || [];
      packages = results[1].packages || [];

      if (preselectedPackageId) {
        var needle = String(preselectedPackageId).toLowerCase();
        selectedPackage = packages.filter(function (p) {
          return String(p.id) === needle || p.name.toLowerCase() === needle;
        })[0] || null;
        if (!selectedPackage) preselectedPackageId = null; // fall back to picker if invalid/not public
        else updateOfferHeader();
      }

      computeStepOrder();
      renderQuizQuestions();
      renderPackageList();
      renderCalendar();

      var firstStep = stepOrder[0];
      showStep(firstStep);

      if (cancelledParam === "1") {
        var msgEl = firstStep === "calendar"
          ? document.getElementById("calendar-message")
          : document.getElementById("package-step-message");
        setMessage(msgEl, "Checkout was cancelled — nothing was charged. Pick a time to try again.");
        var cancelledSessionId = params.get("session_id");
        window.history.replaceState({}, "", "/book/");
        if (cancelledSessionId) {
          // Releases the held slot right away instead of leaving it locked
          // for up to 35 minutes with no visible explanation.
          fetch("/api/public/checkout/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: cancelledSessionId }),
          });
        }
      }
    });
  }
})();
