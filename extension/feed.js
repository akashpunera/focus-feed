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
      const target = link && URL.canParse(link.href, location.origin) ? new URL(link.href, location.origin) : null;
      const href = target?.origin === location.origin ? target : null;
      const id = href?.searchParams.get("v") || href?.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
      const meta = node.querySelector("#video-title, .yt-lockup-metadata-view-model__title, h3");
      const title = titleLink?.textContent?.trim() || meta?.textContent?.trim() ||
        titleLink?.getAttribute("title") || link?.getAttribute("aria-label") || "";
      const image = [...node.querySelectorAll("img[alt]")].map(img => img.alt).join(" ");
      return {
        id: id ? "youtube:" + id : "", url: href?.href || "",
        voteAnchor: titleLink?.closest("h3") || titleLink,
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
      const url = link?.href && URL.canParse(link.href) ? new URL(link.href) : null;
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
  const voteBars = new WeakMap();
  let fullScan = true;

  async function queueVote(card, direction, status) {
    try {
      await api.storage.local.set({ [policy.pendingKey]: {
        id: card.id, text: card.text.slice(0, 500), direction, createdAt: Date.now()
      } });
      status.textContent = "Open Focus Feed in the toolbar to confirm.";
    } catch {
      status.textContent = "Couldn’t prepare the vote. Try again.";
    }
  }

  function decorate(node) {
    const card = adapter.extract(node);
    const existing = voteBars.get(node);
    const anchor = card.voteAnchor?.closest("a") || card.voteAnchor;
    const result = policy.decide(card, votes, settings);
    const review = settings.review === true && result.kind === "preference";
    if (result.hide && !review) {
      node.setAttribute("data-focus-feed-hidden", "");
      existing?.remove();
      return;
    }
    node.removeAttribute("data-focus-feed-hidden");
    if (!policy.canonicalUrl(card.id) || !ready) { existing?.remove(); return; }
    const saved = votes.get(card.id);
    const signature = JSON.stringify([card.id, card.text, saved?.direction, review, result.liked]);
    const barInPlace = anchor ? anchor.nextElementSibling === existing : existing?.parentElement === node;
    if (barInPlace && existing?.dataset.signature === signature) return;
    existing?.remove();
    const bar = document.createElement("div");
    bar.className = youtube ? "focus-feed-votes focus-feed-votes--youtube" : "focus-feed-votes";
    bar.dataset.signature = signature;
    const label = document.createElement("span");
    label.textContent = review ? "Hidden by Focus Feed" : result.liked ? "Matches your preferences" : "Focus Feed";
    label.hidden = youtube && !review && !result.liked;
    bar.append(label);
    const status = document.createElement("small");
    status.className = "focus-feed-vote-status";
    status.setAttribute("role", "status");
    for (const [direction, label, icon] of [[1, "Show more like this", "👍"], [-1, "Hide this or show less like it", "👎"]]) {
      const rate = document.createElement("button");
      rate.type = "button";
      rate.textContent = icon;
      rate.setAttribute("aria-label", label);
      rate.setAttribute("aria-pressed", String(saved?.direction === direction));
      rate.addEventListener("click", event => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopPropagation();
        if (adapter.home() && node.isConnected && voteBars.get(node) === bar && adapter.extract(node).id === card.id)
          queueVote(card, direction, status);
      });
      bar.append(rate);
    }
    bar.append(status);
    voteBars.set(node, bar);
    if (anchor && anchor !== node && node.contains(anchor)) anchor.after(bar);
    else node.append(bar);
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
    // Safari may defer animation frames in an inactive browser window.
    if (!frame) frame = setTimeout(scan, 16);
  }

  function collect(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || element.closest(".focus-feed-votes")) return;
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
            node.nodeType !== 1 || !node.matches(".focus-feed-votes"));
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
      const record = policy.readVote(key, change.newValue);
      if (record) votes.set(record.id, record);
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
