(() => {
  "use strict";

  const playerSelector = "#movie_player";
  const skipSelector = "button.ytp-skip-ad-button, button.ytp-ad-skip-button, button.ytp-ad-skip-button-modern, " +
    ".ytp-ad-skip-button-container button, .ytp-ad-skip-button-slot button, button[aria-label='Skip ad'], button[aria-label='Skip Ads']";
  const overlaySelector = ".ytp-ad-player-overlay, .ytp-ad-preview-container";
  function visible(element) {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  let player = null;
  let frame = 0;
  let notice = null;
  let coverTimer = 0;
  let timedOut = false;
  let watchId = "";
  const mutedByFilter = new Set();
  let skipAttempts = new WeakSet();

  function stopCoveringAd() {
    clearTimeout(coverTimer);
    coverTimer = 0;
    player?.removeAttribute("data-focus-player-ad");
    notice?.remove();
    notice = null;
    for (const media of mutedByFilter) media.muted = false;
    mutedByFilter.clear();
    skipAttempts = new WeakSet();
  }

  function update() {
    frame = 0;
    const current = location.pathname === "/watch" ? document.querySelector(playerSelector) : null;
    const currentId = new URLSearchParams(location.search).get("v") || "";
    if (current !== player || currentId !== watchId) {
      stopCoveringAd();
      player = current;
      watchId = currentId;
      timedOut = false;
    }
    const showingAd = player && (player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting") ||
      [...player.querySelectorAll(overlaySelector)].some(visible) ||
      [...player.querySelectorAll(skipSelector)].some(button => !button.disabled && visible(button)));
    if (!showingAd) {
      if (notice) stopCoveringAd();
      timedOut = false;
      return;
    }
    if (timedOut) return;
    player.setAttribute("data-focus-player-ad", "");
    for (const media of player.querySelectorAll("video")) {
      if (media.muted) continue;
      media.muted = true;
      mutedByFilter.add(media);
    }
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "focus-player-ad-notice";
      notice.setAttribute("role", "status");
      notice.textContent = "Focus Feed is hiding a playback ad.";
      player.append(notice);
      coverTimer = setTimeout(() => {
        timedOut = true;
        stopCoveringAd();
      }, 120_000);
    }
    for (const button of player.querySelectorAll(skipSelector)) {
      if (button.disabled || button.getAttribute("aria-disabled") === "true" || skipAttempts.has(button)) continue;
      if (!visible(button)) continue;
      skipAttempts.add(button);
      button.click();
      break;
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  const mutations = new MutationObserver(records => {
    if (records.some(record => {
      if (record.type === "attributes")
        return record.target === player || player?.contains(record.target);
      return !player?.isConnected || player?.contains(record.target);
    })) schedule();
  });
  mutations.observe(document, { subtree: true, childList: true, attributes: true,
    attributeFilter: ["class", "disabled", "aria-disabled", "hidden", "style"] });
  for (const type of ["yt-navigate-finish", "popstate", "pageshow"]) window.addEventListener(type, schedule);
  document.addEventListener("volumechange", event => {
    if (notice && player?.contains(event.target) && !event.target.muted) schedule();
  }, true);
  schedule();
})();
