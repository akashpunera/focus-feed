(() => {
  "use strict";
  const policy = globalThis.FocusPolicy;
  const api = globalThis.browser ?? globalThis.chrome;
  const discovery = document.querySelector("#discovery");
  const review = document.querySelector("#review");
  const focus = document.querySelector("#focus");
  const savedList = document.querySelector("#saved");
  const status = document.querySelector("#status");

  function make(tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }

  function button(label, handler) {
    const element = make("button", label);
    element.type = "button";
    element.tabIndex = 0;
    element.addEventListener("click", async () => {
      element.disabled = true;
      try {
        await handler();
      } catch (error) {
        status.textContent = error.message || "Couldn’t save your changes.";
      } finally {
        element.disabled = false;
      }
    });
    return element;
  }

  function entry(record) {
    const article = document.createElement("article");
    const platform = record.id.startsWith("x:") ? "X" : "YouTube";
    const link = make("a", (record.direction > 0 ? "👍 " : "👎 ") + platform + " example");
    link.href = record.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    article.append(make("strong", policy.reasons[record.reason]));
    article.append(link);
    if (record.text) article.append(make("p", record.text.slice(0, 150)));
    if (record.note) article.append(make("p", record.note));
    const edit = button("Edit reason", () => {
      edit.hidden = true;
      const editor = document.createElement("div");
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Reason");
      const choices = policy.choices(record.direction);
      for (const key of choices) select.add(new Option(policy.reasons[key], key));
      select.value = record.reason || "example";
      const note = document.createElement("textarea");
      note.setAttribute("aria-label", "Your reason");
      note.placeholder = 'Add your reason or put an exact phrase in "quotes".';
      note.value = record.note || "";
      note.maxLength = 400;
      editor.append(select, note, button("Save preference", async () => {
        const vote = policy.vote({ ...record, text: record.text || "" }, record.direction, select.value, note.value);
        await api.storage.local.set({ [policy.keyPrefix + vote.id]: vote });
        await render();
        status.textContent = "Preference saved.";
      }), button("Cancel", () => { editor.remove(); edit.hidden = false; }));
      article.append(editor);
      select.focus();
    });
    article.append(edit);
    article.append(button("Undo vote", async () => {
      await api.storage.local.remove(policy.keyPrefix + record.id);
      await render();
      status.textContent = "Vote removed.";
    }));
    return article;
  }

  async function render() {
    const records = await api.storage.local.get(null);
    const votes = policy.votesFrom(records);
    discovery.value = String(records.settings?.discovery ?? 15);
    review.checked = records.settings?.review === true;
    focus.checked = records.settings?.focus === true;
    savedList.replaceChildren(...[...votes.values()].sort((a, b) => b.savedAt - a.savedAt).map(entry));
    if (!votes.size) savedList.append(make("p", "Your confirmed votes will appear here."));

  }

  async function saveSettings() {
    try {
      await api.storage.local.set({ settings: { discovery: Number(discovery.value), review: review.checked, focus: focus.checked } });
      status.textContent = "Settings saved.";
    } catch {
      status.textContent = "Couldn’t save settings.";
    }
  }
  discovery.addEventListener("change", saveSettings);
  review.addEventListener("change", saveSettings);
  focus.addEventListener("change", saveSettings);
  render().catch(() => { status.textContent = "Couldn’t load preferences."; });
})();
