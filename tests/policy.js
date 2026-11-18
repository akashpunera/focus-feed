const policy = globalThis.FocusPolicy;
const card = (id, text, extras = {}) => ({ id, text, url: "", ...extras });
const memory = (...votes) => new Map(votes.map(vote => [vote.id, vote]));
function test(label, condition) {
  if (!condition) throw new Error("FAIL " + label);
  print("PASS " + label);
}

const useful = card("youtube:useful", "A hands-on tutorial for building a mechanical keyboard");
const bait = card("x:125", "You won’t believe this new mechanical keyboard");
const yes = policy.vote(useful, 1, "practical", "Show practical tutorials");
const no = policy.vote(bait, -1, "example", "Skip sensational titles");
const votes = memory(yes, no);

test("New cards stay visible before any votes", !policy.decide(bait, memory()).hide);
test("Direct dislikes hide even with 100% discovery", policy.decide(bait, votes, { discovery: 100 }).hide);
test("Style transfers across platforms without treating the topic as disliked",
  policy.decide(card("youtube:bait", bait.text), votes, { discovery: 0 }).hide &&
  !policy.decide(card("x:useful", useful.text), votes, { discovery: 0 }).hide);
test("Confirmed positive preferences identify matching style",
  policy.decide(card("x:useful", useful.text), votes).liked);
test("Discovery lets a share of style matches through", (() => {
  const visible = Array.from({ length: 300 }, (_, index) => card("x:" + index, bait.text))
    .filter(item => !policy.decide(item, votes).hide).length;
  return visible > 20 && visible < 75;
})());
test("Ads override preferences", policy.decide({ ...useful, sponsored: true }, votes).kind === "safety");
test("Sensitive labels override preferences", policy.decide({ ...useful, sensitive: true }, votes).kind === "safety");
test("Explicit text is filtered without training", policy.decide(card("x:adult", "Nude leaks"), memory()).kind === "safety");
const phrase = policy.vote(card("x:126", "Generic post"), -1, "example", 'Hide "DM for the link" posts');
test("Custom phrases affect other creators", policy.decide(card("x:another", "DM for the link now"), memory(phrase), { discovery: 0 }).hide);
test("Undo removes a direct hide", !policy.decide(bait, memory(yes)).hide);

test("Focus keeps likes and samples neutral cards for discovery",
  !policy.decide(card("x:tutorial", useful.text), votes, { focus: true, discovery: 0 }).hide &&
  policy.decide(card("x:neutral", "Weekend park photos"), votes, { focus: true, discovery: 0 }).hide &&
  !policy.decide(card("x:neutral", "Weekend park photos"), votes, { focus: true, discovery: 100 }).hide);


test("Stored votes use canonical URLs and reject mismatched or invalid records",
  policy.readVote("vote:x:125", { ...no, url: "https://example.invalid/" }).url === "https://x.com/i/status/125" &&
  policy.readVote("vote:x:999", no) === null &&
  policy.readVote("vote:x:125", { ...no, direction: 999 }) === null);
test("Expired pending votes cannot be confirmed",
  policy.readDraft({ id: "x:125", direction: -1, text: "A post", createdAt: 0 }, 600001) === null);
