(() => {
  "use strict";

  const keyPrefix = "vote:";
  const styles = {
    clickbait: /\b(you won.t believe|what happens next|this changes everything|shocking truth|the secret (?:to|behind)|nobody (?:tells|talks)|they don.t want you to know|number \d+ will shock|do this before it.s too late)\b/i,
    outrage: /\b(outrage|absolutely disgusting|destroyed|humiliated|wake up|this is insane|the media won.t show|they are coming for)\b/i,
    engagement: /\b(follow for follow|like and retweet|like and share|comment below to win|retweet to win|drop a .{1,15} below|reply .{1,15} if you agree)\b/i,
    practical: /\b(step by step|walkthrough|tutorial|worked example|hands-on|beginner.s guide|how to (?:build|use|learn|fix|make))\b/i,
    evidence: /\b(peer.reviewed|data shows|methodology|case study|source code|replication|systematic review|controlled trial)\b/i
  };
  const reasons = {
    clickbait: "Clickbait",
    outrage: "Outrage bait",
    engagement: "Engagement bait",
    practical: "Practical explanation",
    evidence: "Evidence or examples",
    example: "More or less like this example"
  };
  const stop = new Set("about after again also been before being both could does down from have here into just like more most only other over some than that their them then there these they this those through until very want what when where which while will with would your video post https http".split(" "));

  function features(value) {
    return Object.keys(styles).filter(reason => styles[reason].test(value));
  }

  function words(value) {
    const tokens = value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    return [...new Set(tokens.filter(token => !stop.has(token)))].slice(0, 80);
  }

  function quote(value) {
    return Array.from(value.toLowerCase().matchAll(/["“]([^"”]{3,80})["”]/g), match => match[1]);
  }

  function safety(card) {
    if (card.sponsored) return "Ad or sponsored placement";
    if (card.sensitive) return "Platform sensitive-content warning";
    const explicit = /\b(?:porn(?:ography|hub)?|onlyfans(?:\.com)?|adult content|explicit sexual content|sex tape|sex video|nude leaks?|send nudes|hardcore sex|nsfw|striptease|hentai|erotic (?:video|photos?))\b/i;
    if (explicit.test(card.text)) return "Sexual-content signal";
    return "";
  }

  function styleForNote(note, direction) {
    if (direction > 0) {
      if (/\b(tutorial|practical|hands.on|step.by.step|walkthrough)\b/i.test(note)) return "practical";
      if (/\b(evidence|data.driven|well.sourced|research.based)\b/i.test(note)) return "evidence";
    } else {
      if (/\b(clickbait|sensational|misleading (?:headline|title))\b/i.test(note)) return "clickbait";
      if (/\b(outrage|rage.bait|rage farming)\b/i.test(note)) return "outrage";
      if (/\b(engagement|view farming|like farming|reaction bait)\b/i.test(note)) return "engagement";
    }
    return "example";
  }

  function vote(card, direction, reason, note) {
    const text = card.text.slice(0, 1600);
    return { id: card.id, url: card.url, text, direction, reason,
      note: note.trim().slice(0, 400), features: features(text), words: words(text), savedAt: Date.now() };
  }

  function bucket(id) {
    let hash = 2166136261;
    for (const letter of id) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
    return (hash >>> 0) % 100;
  }

  function decide(card, votes, settings = {}) {
    const safetyReason = safety(card);
    if (safetyReason) return { hide: true, reason: safetyReason, kind: "safety" };
    const direct = votes.get(card.id);
    if (direct) return direct.direction < 0
      ? { hide: true, reason: direct.note || reasons[direct.reason], kind: "preference" }
      : { hide: false, liked: true };
    const style = features(card.text);
    const terms = new Set(words(card.text));
    let positive = 0;
    let negative = 0;
    let reason = "";
    let hasPositiveSignal = false;
    const scoredStyles = new Map();
    for (const saved of votes.values()) {
      const phrases = quote(saved.note || "");
      const phraseMatch = phrases.some(phrase => card.text.toLowerCase().includes(phrase));
      const selectedStyle = saved.reason === "example" ? styleForNote(saved.note || "", saved.direction) : saved.reason;
      const styleMatch = style.includes(selectedStyle);
      if (saved.direction > 0 && (selectedStyle !== "example" || phrases.length || saved.words.length >= 4))
        hasPositiveSignal = true;
      const overlap = saved.words.filter(word => terms.has(word)).length;
      const similar = saved.reason === "example" && overlap >= 4 &&
        overlap / (terms.size + saved.words.length - overlap) >= 0.62;
      if (styleMatch) {
        const key = selectedStyle + saved.direction;
        if (!scoredStyles.has(key)) scoredStyles.set(key, saved);
      }
      if (!styleMatch && (phraseMatch || similar)) {
        if (saved.direction > 0) positive += phraseMatch ? 4 : 3;
        else {
          negative += phraseMatch ? 4 : 3;
          reason = saved.note || reasons[saved.reason];
        }
      }
    }
    for (const saved of scoredStyles.values()) {
      if (saved.direction > 0) positive += 3;
      else {
        negative += 3;
        reason ||= saved.note || reasons[saved.reason];
      }
    }
    const discovery = Number.isInteger(settings.discovery) ? settings.discovery : 15;
    if (negative - positive >= 3 && bucket(card.id) >= discovery)
      return { hide: true, reason, kind: "preference" };
    if (settings.focus && hasPositiveSignal && !positive && bucket(card.id) >= discovery)
      return { hide: true, reason: "Outside your liked styles", kind: "preference" };
    return { hide: false, liked: positive > negative };
  }

  function votesFrom(records) {
    return new Map(Object.entries(records).filter(([key, record]) => key.startsWith(keyPrefix) && record?.id)
      .map(([, record]) => [record.id, record]));
  }

  function choices(direction) {
    return direction > 0 ? ["example", "practical", "evidence"] : ["example", "clickbait", "outrage", "engagement"];
  }

  globalThis.FocusPolicy = { keyPrefix, reasons, features, safety, vote, decide, votesFrom, choices };
})();
