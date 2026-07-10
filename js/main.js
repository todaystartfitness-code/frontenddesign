(function () {
  "use strict";

  document.documentElement.classList.add("js-ready");
  document.getElementById("year").textContent = new Date().getFullYear();

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Header scroll state ---------------- */
  var header = document.getElementById("site-header");
  var onScroll = function () {
    header.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------------- Mobile nav ---------------- */
  var navToggle = document.getElementById("nav-toggle");
  var mainNav = document.getElementById("main-nav");
  var navBackdrop = document.getElementById("nav-backdrop");
  function closeNav() {
    mainNav.classList.remove("is-open");
    navBackdrop.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }
  navToggle.addEventListener("click", function () {
    var open = mainNav.classList.toggle("is-open");
    navBackdrop.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  navBackdrop.addEventListener("click", closeNav);
  mainNav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", closeNav);
  });

  /* ---------------- Magnetic buttons (primary CTAs, fine-pointer only) ---------------- */
  if (!prefersReducedMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    var MAGNET_STRENGTH = 0.25;
    var MAGNET_MAX = 10;
    document.querySelectorAll(".btn-primary:not(.btn-sm)").forEach(function (btn) {
      btn.classList.add("is-magnetic");
      btn.addEventListener("mousemove", function (e) {
        var rect = btn.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        var tx = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, x * MAGNET_STRENGTH));
        var ty = Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, y * MAGNET_STRENGTH));
        btn.classList.remove("is-settling");
        btn.style.transform = "translate(" + tx + "px, " + ty + "px)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.classList.add("is-settling");
        btn.style.transform = "";
      });
    });
  }

  /* ---------------- Ambient videos (studio, lift, bodywork) ---------------- */
  function setupAmbientVideo(video, toggle) {
    var userPaused = false;

    function play() {
      video.play().catch(function () {});
      toggle.setAttribute("aria-pressed", "false");
      toggle.setAttribute("aria-label", "Pause video");
    }
    function pause() {
      video.pause();
      toggle.setAttribute("aria-pressed", "true");
      toggle.setAttribute("aria-label", "Play video");
    }

    toggle.addEventListener("click", function () {
      if (video.paused) {
        userPaused = false;
        play();
      } else {
        userPaused = true;
        pause();
      }
    });

    if (prefersReducedMotion) {
      pause();
    } else if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (userPaused) return;
            if (entry.isIntersecting) play();
            else video.pause();
          });
        },
        { threshold: 0.4 }
      );
      observer.observe(video);
    } else {
      play();
    }
  }

  document.querySelectorAll(".video-toggle[data-video]").forEach(function (toggle) {
    var video = document.getElementById(toggle.getAttribute("data-video"));
    if (video) setupAmbientVideo(video, toggle);
  });

  /* ---------------- Shared count-up helper ---------------- */
  function countUpNumber(numEl, target, opts) {
    opts = opts || {};
    var prefix = opts.prefix || "";
    var suffix = opts.suffix || "";
    if (prefersReducedMotion || !window.gsap) {
      numEl.textContent = prefix + target.toLocaleString() + suffix;
      return;
    }
    var counter = { val: 0 };
    gsap.to(counter, {
      val: target,
      duration: opts.duration || 1.6,
      ease: "power1.out",
      onUpdate: function () {
        numEl.textContent = prefix + Math.round(counter.val).toLocaleString() + suffix;
      }
    });
  }

  /* ---------------- Scroll reveal (IntersectionObserver-based) ----------------
     Deliberately independent of GSAP/ScrollTrigger: ScrollTrigger positions are
     computed once and go stale if fonts/images/video shift the layout after
     that calculation, which can leave content stuck invisible until a refresh.
     IntersectionObserver re-checks against the live layout on every scroll, so
     it can't go stale the same way. */
  (function setupReveal() {
    var elements = document.querySelectorAll(
      ".reveal, .reveal-up, .service-card, .testimonial-card"
    );

    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      elements.forEach(function (el) { el.classList.add("is-visible"); });
      document.querySelectorAll(".result-bar-fill[data-width]").forEach(function (bar) {
        bar.style.width = bar.getAttribute("data-width") + "%";
      });
      return;
    }

    /* Zero out prices now (while their card is still invisible) so the
       count-up has somewhere to animate from; safe because the card's
       opacity is 0 until "is-visible" lands, so this is never seen. */
    document.querySelectorAll(".price-now[data-value]").forEach(function (el) {
      el.textContent = "$0";
    });

    var observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            var priceEl = entry.target.querySelector(".price-now[data-value]");
            if (priceEl) countUpNumber(priceEl, parseInt(priceEl.getAttribute("data-value"), 10), { prefix: "$", duration: 1.1 });
            var barFills = entry.target.querySelectorAll(".result-bar-fill[data-width]");
            if (barFills.length) {
              setTimeout(function () {
                barFills.forEach(function (bar) {
                  bar.style.width = bar.getAttribute("data-width") + "%";
                });
              }, 250);
            }
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0, rootMargin: "0px 0px 300px 0px" }
    );
    elements.forEach(function (el) { observer.observe(el); });
  })();

  /* ---------------- Results section: scroll-driven "backlit" cards on touch devices ----------------
     Hover-capable devices get the glow/expand via CSS :hover. On touch devices
     (no persistent hover), the same glow is applied to whichever result card
     or before/after card is centered in the viewport as the user scrolls. */
  (function setupResultsBacklight() {
    var hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (prefersReducedMotion || hoverCapable || !("IntersectionObserver" in window)) return;

    var targets = document.querySelectorAll("#results .result-card, #results .compare-card");
    if (!targets.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          entry.target.classList.toggle("is-backlit", entry.isIntersecting);
        });
      },
      { threshold: 0, rootMargin: "-42% 0px -42% 0px" }
    );
    targets.forEach(function (el) { observer.observe(el); });
  })();

  /* ---------------- Stat counters (IntersectionObserver-based) ---------------- */
  (function setupStatCounters() {
    var stats = document.querySelectorAll(".stat");

    function runCounter(stat) {
      var numEl = stat.querySelector(".stat-num");
      var target = parseInt(stat.getAttribute("data-count"), 10);
      var suffix = stat.getAttribute("data-suffix") || "";
      countUpNumber(numEl, target, { suffix: suffix });
    }

    if (!("IntersectionObserver" in window)) {
      stats.forEach(runCounter);
      return;
    }
    var observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            runCounter(entry.target);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    stats.forEach(function (stat) { observer.observe(stat); });
  })();

  /* ---------------- GSAP decorative motion (load-time + continuous, no one-time
     scroll triggers here — those live in setupReveal/setupStatCounters above) ---------------- */
  if (window.gsap && !prefersReducedMotion) {
    try {
      if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

      /* Hero headline: line-by-line reveal on load */
      gsap.from("[data-line]", {
        yPercent: 110,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.12,
        delay: 0.2
      });

      if (window.ScrollTrigger) {
        window.addEventListener("load", function () {
          document.fonts && document.fonts.ready
            ? document.fonts.ready.then(function () { ScrollTrigger.refresh(); })
            : ScrollTrigger.refresh();
        });
      }

      /* Slow "breathing" pulse on the bodywork icon — evokes calm/recovery */
      gsap.to(".service-card--bodywork .service-icon", {
        scale: 1.06,
        duration: 2.2,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true
      });

      /* Gentle float on the About portrait */
      gsap.to(".about-portrait", {
        y: -10,
        duration: 3,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true
      });
    } catch (e) {
      /* Decorative motion failed (e.g. ScrollTrigger blocked) — core content
         visibility never depends on this block, so nothing else to do. */
    }
  }
})();
