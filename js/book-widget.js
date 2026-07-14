(function () {
  "use strict";

  var overlay = null;

  function closeModal() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.body.classList.remove("book-modal-open");
  }

  function openModal(packageId) {
    closeModal();
    overlay = document.createElement("div");
    overlay.className = "book-modal-overlay";
    var src = "/book/?embed=modal" + (packageId ? "&package=" + encodeURIComponent(packageId) : "");
    overlay.innerHTML =
      '<div class="book-modal-card">' +
        '<button type="button" class="book-modal-close" aria-label="Close">&times;</button>' +
        '<iframe class="book-modal-iframe" src="' + src + '"></iframe>' +
      "</div>";
    document.body.appendChild(overlay);
    document.body.classList.add("book-modal-open");
    overlay.querySelector(".book-modal-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  // Any element with data-fitstrong-book opens the popup on click. The
  // attribute's value (if any) is a package id to preselect, skipping the
  // package-picker step — e.g. data-fitstrong-book="6" for one specific offer.
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-fitstrong-book]");
    if (!trigger) return;
    e.preventDefault();
    var packageId = trigger.getAttribute("data-fitstrong-book");
    openModal(packageId || null);
  });

  window.FitStrongBook = { open: openModal, close: closeModal };
})();
