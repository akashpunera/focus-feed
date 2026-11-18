(() => {
  "use strict";

  const policy = globalThis.FocusPolicy;
  const api = globalThis.browser ?? globalThis.chrome;
  const youtube = location.hostname === "www.youtube.com";
  const adapter = youtube ? {
    home: () => location.pathname === "/",
    selector: "ytd-rich-item-renderer, ytm-shorts-lockup-view-model, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer",
    root: node => node.closest("ytd-rich-item-renderer") || node,
    extract(node) {
      const sponsored = node.matches("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer") ||
        !!node.querySelector("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, [class*='ad-badge']");
      const titleLink = node.querySelector("a#video-title-link, a#video-title, a.yt-lockup-metadata-view-model__title, h3 a[href^='/watch?v='], h3 a[href^='/shorts/']");
      const link = titleLink || node.querySelector("a[href^='/watch?v='], a[href^='/shorts/']");
      const target = link ? new URL(link.href, location.origin) : null;
      const href = target?.origin === location.origin ? target : null;
      const id = href?.searchParams.get("v") || href?.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
      const meta = node.querySelector("#video-title, .yt-lockup-metadata-view-model__title, h3");
      const title = titleLink?.textContent?.trim() || meta?.textContent?.trim() ||
        titleLink?.getAttribute("title") || link?.getAttribute("aria-label") || "";
      const image = [...node.querySelectorAll("img[alt]")].map(img => img.alt).join(" ");
      return {
        id: id ? "youtube:" + id : "", url: href?.href || "",
        text: [title, image].join(" ").trim(),
        sponsored: sponsored || [...node.querySelectorAll("badge-shape, .yt-badge-shape, ytd-badge-supported-renderer")]
          .some(badge => /^(?:sponsored|ad|paid promotion)$/i.test(badge.textContent.trim())),
        sensitive: /\bage.restricted\b/i.test(node.querySelector("#badges")?.textContent || "")
      };
    }
  } : {
    home: () => /^\/home\/?$/.test(location.pathname),
    selector: "article[data-testid='tweet'], [data-testid='placementTracking']",
    root: node => node.closest("[data-testid='cellInnerDiv']") || node,
    extract(node) {
      const article = node.matches("article") ? node : node.querySelector("article[data-testid='tweet']");
      const timestamp = article?.querySelector("time")?.closest("a[href*='/status/']");
      const link = timestamp || article?.querySelector("a[href^='/'][href*='/status/']");
      const url = link?.href ? new URL(link.href) : null;
      const id = url?.origin === location.origin ? url.pathname.match(/^\/[\w]+\/status\/(\d+)(?:\/|$)/)?.[1] : null;
      const text = [...node.querySelectorAll("[data-testid='tweetText'], [data-testid='card.wrapper'], img[alt]:not([data-testid='Tweet-User-Avatar'] img)")]
        .map(el => el.tagName === "IMG" ? el.alt : el.textContent).join(" ");
      return {
        id: id ? "x:" + id : "", url: id ? url.href : "", text,
        sponsored: node.matches("[data-testid='placementTracking']") || !!node.querySelector("[data-testid='placementTracking']") ||
          [...node.querySelectorAll("span")].some(span => span.childElementCount === 0 && !span.closest("[data-testid='tweetText'], [data-testid='User-Name'], [data-testid='card.wrapper']") && /^(?:Ad|Promoted|Sponsored)$/.test(span.textContent.trim())),
        sensitive: /content warning|potentially sensitive content|sensitive media/i.test(node.querySelector("[data-testid='tweetInterstitial'], [data-testid='app-text-transition-container']")?.textContent || "")
      };
    }
  };

  let votes = new Map();
  let settings = {};
  let ready = false;
  let frame = 0;
  let currentUrl = "";
  const pending = new Set();
  let fullScan = true;

  function button(label, action) {
    const element = document.createElement("button");
    element.type = "button";
    if (action) element.textContent = label;
    element.setAttribute("aria-label", label);
    if (action) element.addEventListener("click", action);
    return element;
  }

  function confirm(card, direction) {
    document.getElementById("focus-feed-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "focus-feed-dialog";
    const form = document.createElement("form");
    const title = document.createElement("h2");
    title.textContent = direction > 0 ? "What would you like to see more of?" : "Why would you like to hide this?";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Preference");
    const choices = policy.choices(direction);
    const saved = votes.get(card.id);
    const detected = policy.features(card.text).find(feature => choices.includes(feature));
    for (const reason of choices) select.add(new Option(policy.reasons[reason], reason));
    select.value = saved?.direction === direction ? saved.reason : detected || "example";
    const note = document.createElement("textarea");
    note.maxLength = 400;
    note.placeholder = 'Add or edit your reason. Put an exact phrase in "quotes" to match it.';
    note.setAttribute("aria-label", "Your reason");
    note.value = saved?.direction === direction ? saved.note : "";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const submit = button("Save preference");
    submit.type = "submit";
    submit.textContent = "Save preference";
    const cancel = button("Cancel", () => dialog.close());
    form.append(title, select, note, status, submit, cancel);
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove());
    form.addEventListener("submit", async event => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const record = policy.vote(card, direction, select.value, note.value);
        await api.storage.local.set({ [policy.keyPrefix + card.id]: record });
        dialog.close();
      } catch {
        status.textContent = "Couldn’t save your preference. Try again.";
        submit.disabled = false;
      }
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  function decorate(node) {
    const card = adapter.extract(node);
    const existing = node.querySelector(":scope > .focus-feed-votes");
    const result = policy.decide(card, votes, settings);
    const review = settings.review === true && result.kind === "preference";
    if (result.hide && !review) {
      node.setAttribute("data-focus-feed-hidden", "");
      existing?.remove();
      return;
    }
    node.removeAttribute("data-focus-feed-hidden");
    if (!card.id || !ready) { existing?.remove(); return; }
    const saved = votes.get(card.id);
    const signature = JSON.stringify([card.id, card.text, saved?.direction, review && result.reason, result.liked]);
    if (existing?.dataset.signature === signature) return;
    existing?.remove();
    const bar = document.createElement("div");
    bar.className = "focus-feed-votes";
    bar.dataset.signature = signature;
    const label = document.createElement("span");
    label.textContent = review ? "Hidden · " + result.reason : result.liked ? "Matches your preferences" : "Focus Feed";
    bar.append(label);
    for (const [direction, label, icon] of [[1, "Show more like this", "👍"], [-1, "Hide this or show less like it", "👎"]]) {
      const rate = button(label, event => {
        event.preventDefault();
        event.stopPropagation();
        confirm(card, direction);
      });
      rate.textContent = icon;
      rate.setAttribute("aria-pressed", String(saved?.direction === direction));
      bar.append(rate);
    }
    node.append(bar);
  }

  function scan() {
    frame = 0;
    if (currentUrl !== location.href) {
      currentUrl = location.href;
      fullScan = true;
    }
    if (!adapter.home()) {
      document.querySelectorAll("[data-focus-feed-hidden]").forEach(node => node.removeAttribute("data-focus-feed-hidden"));
      document.querySelectorAll(".focus-feed-votes").forEach(node => node.remove());
      pending.clear();
      return;
    }
    const nodes = fullScan ? new Set([...document.querySelectorAll(adapter.selector)].map(adapter.root)) : pending;
    fullScan = false;
    for (const node of nodes) if (node.isConnected) decorate(node);
    pending.clear();
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(scan);
  }

  function collect(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || element.closest(".focus-feed-votes, #focus-feed-dialog")) return;
    const match = element.closest(adapter.selector);
    if (match) pending.add(adapter.root(match));
    for (const child of element.querySelectorAll(adapter.selector)) pending.add(adapter.root(child));
  }

  const observer = new MutationObserver(records => {
    if (currentUrl !== location.href) fullScan = true;
    if (adapter.home() && !fullScan) {
      for (const record of records) {
        if (record.type === "childList") {
          const relevant = [...record.addedNodes, ...record.removedNodes].filter(node =>
            node.nodeType !== 1 || !node.matches(".focus-feed-votes, #focus-feed-dialog"));
          if (!relevant.length) continue;
          const parent = record.target.nodeType === 1 ? record.target.closest(adapter.selector) : null;
          if (parent) pending.add(adapter.root(parent));
          for (const node of record.addedNodes) collect(node);
        } else {
          collect(record.target);
        }
      }
    }
    if (fullScan || pending.size) schedule();
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["href", "aria-label", "alt"] });
  for (const event of ["popstate", "yt-navigate-finish", "pageshow"]) {
    window.addEventListener(event, () => { fullScan = true; schedule(); });
  }

  // Subscribe before the initial read so updates from another tab cannot be lost.
  schedule();
  const duringLoad = [];
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!ready) { duringLoad.push(changes); return; }
    apply(changes);
  });
  function apply(changes) {
    for (const [key, change] of Object.entries(changes)) {
      if (key === "settings") settings = change.newValue || {};
      if (!key.startsWith(policy.keyPrefix)) continue;
      if (change.newValue) votes.set(change.newValue.id, change.newValue);
      else votes.delete(key.slice(policy.keyPrefix.length));
    }
    fullScan = true;
    schedule();
  }

  api.storage.local.get(null).then(records => {
    votes = policy.votesFrom(records);
    settings = records.settings || {};
  }).catch(() => {}).finally(() => {
    ready = true;
    fullScan = true;
    duringLoad.forEach(apply);
    schedule();
  });
})();
