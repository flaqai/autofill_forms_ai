(function () {
  "use strict";

  var namespace = "writer-copy-page:" + window.location.pathname;

  function storageKey(button) {
    return namespace + ":" + button.dataset.copyKey;
  }

  function getCopyButtons() {
    return Array.from(document.querySelectorAll("[data-copy-action]"));
  }

  function applyCopiedStyle(button) {
    if (!button) return;
    button.classList.add("copied");
    button.setAttribute("aria-pressed", "true");
    button.textContent = "✓ 已复制";
  }

  function markCopied(button) {
    if (!button) return;
    applyCopiedStyle(button);
    try {
      window.localStorage.setItem(storageKey(button), "1");
    } catch (error) {
      // The visible state still persists for the current page session.
    }
  }

  function restore() {
    getCopyButtons().forEach(function (button, index) {
      if (!button.dataset.copyKey) {
        button.dataset.copyKey = "copy-" + String(index + 1);
      }
      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent.trim();
      }
      try {
        if (window.localStorage.getItem(storageKey(button)) === "1") {
          applyCopiedStyle(button);
        }
      } catch (error) {
        // Local storage may be unavailable on some file:// browser policies.
      }
    });
  }

  function reset() {
    getCopyButtons().forEach(function (button) {
      try {
        window.localStorage.removeItem(storageKey(button));
      } catch (error) {
        // Continue resetting the visible state.
      }
      button.classList.remove("copied");
      button.setAttribute("aria-pressed", "false");
      button.textContent = button.dataset.originalText || "复制";
    });

    var status = document.getElementById("copy-state-reset-status");
    if (status) {
      status.textContent = "已清除，可以重新开始";
    }
  }

  window.copyPageState = {
    markCopied: markCopied,
    reset: reset,
    restore: restore
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restore);
  } else {
    restore();
  }
})();

