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
  navToggle.addEventListener("click", function () {
    var open = mainNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  mainNav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      mainNav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

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

  /* ---------------- Dust particle canvas (hero ambiance) ---------------- */
  (function dustField() {
    var canvas = document.getElementById("dust-canvas");
    if (!canvas || prefersReducedMotion) return;
    var ctx = canvas.getContext("2d");
    var particles = [];
    var count = window.innerWidth < 640 ? 26 : 50;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w, h;

    function resize() {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function makeParticle() {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4,
        vy: -(Math.random() * 0.18 + 0.04),
        vx: (Math.random() - 0.5) * 0.08,
        a: Math.random() * 0.5 + 0.15
      };
    }

    function init() {
      resize();
      particles = [];
      for (var i = 0; i < count; i++) particles.push(makeParticle());
    }

    var rafId;
    function tick() {
      ctx.clearRect(0, 0, w, h);
      particles.forEach(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(219, 165, 76, " + p.a + ")";
        ctx.fill();
      });
      rafId = requestAnimationFrame(tick);
    }

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(init, 200);
    });

    init();
    tick();

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) cancelAnimationFrame(rafId);
      else tick();
    });
  })();

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
      return;
    }

    var observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -8% 0px" }
    );
    elements.forEach(function (el) { observer.observe(el); });
  })();

  /* ---------------- Stat counters (IntersectionObserver-based) ---------------- */
  (function setupStatCounters() {
    var stats = document.querySelectorAll(".stat");

    function runCounter(stat) {
      var numEl = stat.querySelector(".stat-num");
      var target = parseInt(stat.getAttribute("data-count"), 10);
      var suffix = stat.getAttribute("data-suffix") || "";

      if (prefersReducedMotion || !window.gsap) {
        numEl.textContent = target.toLocaleString() + suffix;
        return;
      }
      var counter = { val: 0 };
      gsap.to(counter, {
        val: target,
        duration: 1.6,
        ease: "power1.out",
        onUpdate: function () {
          numEl.textContent = Math.round(counter.val).toLocaleString() + suffix;
        }
      });
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

      /* Subtle hero background parallax */
      if (window.ScrollTrigger) {
        gsap.to(".hero-plates", {
          yPercent: 12,
          ease: "none",
          scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6 }
        });
        gsap.to(".hero-glow", {
          yPercent: 20,
          ease: "none",
          scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6 }
        });
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
