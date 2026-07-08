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

  /* ---------------- GSAP-powered motion ---------------- */
  if (window.gsap) {
    gsap.registerPlugin(ScrollTrigger);

    if (prefersReducedMotion) {
      gsap.set(".reveal, .reveal-up, .line", { opacity: 1, y: 0 });
    } else {
      /* Hero headline: line-by-line reveal on load */
      gsap.from("[data-line]", {
        yPercent: 110,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.12,
        delay: 0.2
      });

      gsap.from(".hero-actions, .hero-sub, .hero-trust, .hero .eyebrow", {
        opacity: 0,
        y: 16,
        duration: 0.7,
        ease: "power2.out",
        stagger: 0.1,
        delay: 0.5
      });

      /* Generic scroll reveal for sections */
      gsap.utils.toArray(".reveal").forEach(function (el, i) {
        gsap.from(el, {
          opacity: 0,
          y: 28,
          duration: 0.6,
          ease: "power2.out",
          scrollTrigger: {
            trigger: el,
            start: "top 88%",
            toggleActions: "play none none reverse"
          }
        });
      });

      /* Service cards stagger together as a group */
      gsap.from(".service-card", {
        opacity: 0,
        y: 40,
        duration: 0.7,
        ease: "power2.out",
        stagger: 0.15,
        scrollTrigger: {
          trigger: ".service-grid",
          start: "top 82%"
        }
      });

      /* Testimonial cards stagger */
      gsap.from(".testimonial-card", {
        opacity: 0,
        y: 24,
        duration: 0.5,
        ease: "power2.out",
        stagger: 0.1,
        scrollTrigger: {
          trigger: ".testimonial-grid",
          start: "top 85%"
        }
      });

      /* Subtle hero background parallax */
      gsap.to(".hero-plates", {
        yPercent: 12,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: 0.6
        }
      });
      gsap.to(".hero-glow", {
        yPercent: 20,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: 0.6
        }
      });

      /* Slow "breathing" pulse on the bodywork icon — evokes calm/recovery */
      gsap.to(".service-card--bodywork .service-icon", {
        scale: 1.06,
        duration: 2.2,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true
      });

      /* Portrait ring slow rotation already handled via CSS; add gentle float */
      gsap.to(".about-portrait", {
        y: -10,
        duration: 3,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true
      });
    }

    /* Stat counters — count up once when scrolled into view */
    gsap.utils.toArray(".stat").forEach(function (stat) {
      var numEl = stat.querySelector(".stat-num");
      var target = parseInt(stat.getAttribute("data-count"), 10);
      var suffix = stat.getAttribute("data-suffix") || "";
      var counter = { val: 0 };

      ScrollTrigger.create({
        trigger: stat,
        start: "top 90%",
        once: true,
        onEnter: function () {
          gsap.to(counter, {
            val: target,
            duration: prefersReducedMotion ? 0.01 : 1.6,
            ease: "power1.out",
            onUpdate: function () {
              numEl.textContent = Math.round(counter.val).toLocaleString() + suffix;
            }
          });
        }
      });
    });
  } else {
    /* GSAP failed to load (offline/CDN blocked) — ensure content is visible */
    document.querySelectorAll(".reveal, .reveal-up, .line").forEach(function (el) {
      el.style.opacity = "1";
    });
    document.querySelectorAll(".stat-num").forEach(function (el) {
      var stat = el.closest(".stat");
      el.textContent = stat.getAttribute("data-count") + (stat.getAttribute("data-suffix") || "");
    });
  }

  /* ---------------- Safety net: never leave content permanently invisible ---------------- */
  window.addEventListener("load", function () {
    setTimeout(function () {
      document.querySelectorAll(".reveal, .reveal-up, .line").forEach(function (el) {
        if (parseFloat(getComputedStyle(el).opacity) === 0) {
          el.style.opacity = "1";
          el.style.transform = "none";
        }
      });
    }, 2500);
  });
})();
