const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const src = file => readFileSync(resolve(__dirname, "../extension", file), "utf8");
const scripts = Object.fromEntries(["policy.js", "feed.js", "settings.js"].map(file => [file, src(file)]));
const windowOptions = { runScripts: "outside-only", pretendToBeVisual: true };

function storage(initial = {}) {
  const records = structuredClone(initial);
  const listeners = new Set();
  function update(changes) {
    for (const listener of listeners) listener(structuredClone(changes), "local");
  }
  return {
    records,
    api: { storage: {
      onChanged: { addListener: listener => listeners.add(listener) },
      local: {
        async get() { return structuredClone(records); },
        async set(items) {
          const changes = {};
          for (const [key, item] of Object.entries(items)) {
            changes[key] = { oldValue: records[key], newValue: item };
            records[key] = structuredClone(item);
          }
          update(changes);
        },
        async remove(key) {
          const oldValue = records[key];
          delete records[key];
          update({ [key]: { oldValue } });
        }
      }
    } }
  };
}

function fixture(t, url, markup, memory, script = "feed.js") {
  const dom = new JSDOM(markup, { ...windowOptions, url });
  const { window } = dom;
  window.browser = memory.api;
  const observers = [];
  const Observer = window.MutationObserver;
  window.MutationObserver = class extends Observer {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  t.after(() => {
    observers.forEach(observer => observer.disconnect());
    window.close();
  });
  window.eval(scripts["policy.js"]);
  window.eval(scripts[script]);
  return window;
}

async function until(predicate, message) {
  for (let i = 0; i < 35; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  assert.fail(message);
}

const youtube = (id, text) => `<ytd-rich-item-renderer id="${id}"><a id="video-title" href="/watch?v=${id}">${text}</a></ytd-rich-item-renderer>`;
const tweet = (id, text, extra = "") => `<div id="x${id}" data-testid="cellInnerDiv"><article data-testid="tweet">
  <a href="/ada/status/${id}"><time>Now</time></a><div data-testid="tweetText">${text}</div>${extra}</article></div>`;

test("YouTube Home screens ads, explicit text and newly inserted cards", async t => {
  const view = fixture(t, "https://www.youtube.com/?app=desktop",
    youtube("keep", "How to build an audio meter") + youtube("adult", "Nude leaks") +
    '<ytd-rich-item-renderer id="ad"><ytd-ad-slot-renderer>Sponsored</ytd-ad-slot-renderer></ytd-rich-item-renderer>',
    storage());
  const doc = view.document;
  await until(() => doc.querySelector("#keep [aria-pressed]"), "Normal card receives voting controls");
  assert.equal(doc.querySelectorAll("[data-focus-feed-hidden]").length, 2);
  const keep = doc.querySelector("#keep");
  const controls = keep.querySelector("a").nextElementSibling;
  assert.ok(controls.classList.contains("focus-feed-votes--youtube"));
  assert.equal(controls.querySelectorAll("button").length, 2);
  assert.ok(controls.querySelector("span").hidden);
  keep.querySelector("a").replaceWith(keep.querySelector("a").cloneNode(true));
  // Re-render the title and metadata ahead of the toolbar, as YouTube does on recycled cards.
  keep.querySelector("a").after(doc.createElement("p"));
  await until(() => keep.querySelector("a").nextElementSibling === keep.querySelector(".focus-feed-votes"), "Controls reattach to the new title");
  assert.equal(keep.querySelectorAll(".focus-feed-votes").length, 1);
  doc.body.insertAdjacentHTML("beforeend", youtube("late", "How to fix a meter"));
  await until(() => doc.querySelector("#late button"), "New feed card is decorated");
  doc.querySelector("#late a").textContent = "Explicit sexual content";
  await until(() => doc.querySelector("#late[data-focus-feed-hidden]"), "Reused or updated feed card is rescanned");
});

test("X Home screens ads and media warnings and restores content on route changes", async t => {
  const view = fixture(t, "https://x.com/home",
    tweet("11", "A guide") +
    tweet("12", "Advert", '<div data-testid="placementTracking">Promoted</div>') +
    tweet("13", "A different guide", '<div data-testid="tweetInterstitial">Potentially sensitive content</div>') +
    tweet("14", "<span>Ad</span>"), storage());
  const doc = view.document;
  await until(() => doc.querySelector("#x11 button"), "Normal tweet receives controls");
  assert.equal(doc.querySelectorAll("[data-focus-feed-hidden]").length, 2);
  assert.ok(doc.querySelector("#x14 button"), "User-authored Ad text is not a paid placement label");
  view.history.pushState({}, "", "/explore");
  view.dispatchEvent(new view.PopStateEvent("popstate"));
  await until(() => !doc.querySelector(".focus-feed-votes, [data-focus-feed-hidden]"), "Home state is cleared outside Home");
  view.history.back();
  await until(() => doc.querySelector("#x13[data-focus-feed-hidden]"), "Filtering resumes on Home");
});

test("Confirm, persist, edit, review and undo a vote across extension views", async t => {
  const memory = storage();
  const markup = `<ytd-rich-item-renderer id="keep"><a href="/watch?v=keep">50:30</a><h3><a class="yt-lockup-metadata-view-model__title" href="/watch?v=keep">You won’t believe this new camera</a></h3></ytd-rich-item-renderer>` +
    youtube("adult", "Porn video");
  const view = fixture(t, "https://www.youtube.com/", markup, memory);
  const doc = view.document;
  const dislike = () => doc.querySelector("#keep button[aria-label='Hide this or show less like it']");
  await until(dislike, "Vote buttons render");
  assert.ok(doc.querySelector("#keep h3 + .focus-feed-votes"));
  dislike().click();
  assert.deepEqual(memory.records, {});
  assert.equal(doc.querySelector("dialog, textarea"), null);
  await memory.api.storage.local.set({ pendingVote: { id: "youtube:keep", direction: -1,
    text: "You won’t believe this new camera", createdAt: Date.now() } });
  const popup = fixture(t, "https://extension.invalid/settings.html", src("settings.html"), memory, "settings.js").document;
  await until(() => popup.querySelector("#pending textarea"), "Toolbar displays the draft");
  popup.querySelector("#pending textarea").value = "Skip sensational headlines";
  popup.querySelector("#pending button").click();
  await until(() => doc.querySelector("#keep[data-focus-feed-hidden]"), "Confirmed vote hides card");
  assert.equal(memory.records["vote:youtube:keep"].reason, "clickbait");
  assert.equal(memory.records["vote:youtube:keep"].text, "You won’t believe this new camera");
  assert.equal(memory.records.pendingVote, undefined);

  const another = fixture(t, "https://www.youtube.com/", markup, memory).document;
  await until(() => another.querySelector("#keep[data-focus-feed-hidden]"), "New tab reads existing preference");
  await until(() => popup.querySelector("#saved")?.textContent.includes("Skip sensational headlines"), "Popup reads vote");
  popup.querySelector("#saved button").click();
  popup.querySelector("#saved textarea").value = "Skip clickbait";
  popup.querySelector("#saved article > div > button").click();
  await until(() => memory.records["vote:youtube:keep"].note === "Skip clickbait", "Popup saves the edited reason");
  popup.querySelector("#review").click();
  await until(() => doc.querySelector("#keep .focus-feed-votes")?.textContent.includes("Hidden by Focus Feed"), "Review explains hidden card");
  assert.ok(doc.querySelector("#adult[data-focus-feed-hidden]"));
  assert.ok(!doc.body.innerHTML.includes("Skip clickbait"));
  [...popup.querySelectorAll("#saved button")].find(button => button.textContent === "Undo vote").click();
  await until(() => !memory.records["vote:youtube:keep"] && another.querySelector("#keep .focus-feed-votes span")?.textContent === "Focus Feed", "Undo updates feeds");
});

test("YouTube playback ads are covered, muted and skipped when available", async t => {
  const dom = new JSDOM('<div id="movie_player"><video></video><button class="ytp-skip-ad-button" disabled>Skip</button></div>',
    { ...windowOptions, url: "https://www.youtube.com/watch?v=example" });
  const { window } = dom;
  const player = window.document.querySelector("#movie_player");
  const video = player.querySelector("video");
  const skip = player.querySelector("button");
  skip.getClientRects = () => [{}];
  let skips = 0;
  skip.addEventListener("click", () => {
    skips++;
    skip.disabled = true;
    player.classList.remove("ad-showing");
  });
  const observer = window.MutationObserver;
  let playbackObserver;
  window.MutationObserver = class extends observer {
    constructor(callback) { super(callback); playbackObserver = this; }
  };
  t.after(() => { playbackObserver.disconnect(); window.close(); });
  window.eval(src("youtube-player.js"));
  player.classList.add("ad-showing");
  await until(() => player.hasAttribute("data-focus-player-ad"), "Ad is covered");
  assert.equal(video.muted, true);
  assert.equal(skips, 0);
  skip.disabled = false;
  await until(() => !player.hasAttribute("data-focus-player-ad"), "Player is restored when ad ends");
  assert.equal(skips, 1);
  assert.equal(video.muted, false);

  video.muted = true;
  player.classList.add("ad-showing");
  skip.disabled = false;
  await until(() => skips === 2 && !player.hasAttribute("data-focus-player-ad"), "A new ad can reuse the skip button");
  assert.equal(video.muted, true);
});
