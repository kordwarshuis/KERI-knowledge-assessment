/* Walks every possible path through the questionnaire and checks the engine.
   Run: node test/simulate.js
*/
const assert = require("node:assert");
const bank = require("../questions.js");
const engine = require("../engine.js");

const index = {};
bank.questions.forEach(function (q) {
  assert.ok(!index[q.id], "duplicate question id " + q.id);
  index[q.id] = q;
  assert.ok(bank.areas.some(function (a) { return a.id === q.area; }), q.id + ": unknown area");
  assert.ok(q.tier >= 1 && q.tier <= engine.TOP_TIER, q.id + ": bad tier");
  assert.strictEqual(q.choices.length, 4, q.id + ": needs four choices");
  assert.ok(q.choices.some(function (c) { return c.id === q.answer; }), q.id + ": answer missing");
});

/* Each area needs two questions per tier: one to probe and one for a second look. */
bank.areas.forEach(function (a) {
  for (let t = 1; t <= engine.TOP_TIER; t += 1) {
    const n = bank.questions.filter(function (q) { return q.area === a.id && q.tier === t; }).length;
    assert.ok(n >= 2, a.id + " tier " + t + " has " + n + " question(s), needs 2");
  }
});

const OUTCOMES = ["right", "wrong", "idk"];
const lengths = {};
const levels = {};
const kinds = {};
let paths = 0;

function walk(session) {
  const q = engine.next(bank, session, function () { return 0; });
  if (!q) {
    const result = engine.assess(bank, session);
    const n = session.steps.length;
    assert.ok(n >= 4, "a path ended before every area was visited");
    assert.ok(n <= engine.MAX_SCORED, "a path ran past the maximum");
    result.rows.forEach(function (r) {
      assert.ok(r.asked >= 1, "area " + r.id + " was never asked");
      assert.ok(r.score >= 0 && r.score <= engine.TOP_TIER, "score out of range");
    });
    if (result.right === 0) assert.strictEqual(result.level.id, "newcomer");
    if (result.right === n && n === engine.MAX_SCORED) assert.strictEqual(result.level.id, "specialist");
    lengths[n] = (lengths[n] || 0) + 1;
    levels[result.level.id] = (levels[result.level.id] || 0) + 1;
    kinds[result.kind] = (kinds[result.kind] || 0) + 1;
    paths += 1;
    return;
  }
  assert.ok(!session.steps.some(function (s) { return s.id === q.id; }), "question asked twice: " + q.id);
  assert.strictEqual(index[q.id].tier, q.tier);
  OUTCOMES.forEach(function (outcome) {
    session.steps.push({
      id: q.id,
      pick: outcome === "idk" ? engine.IDK : outcome,
      ok: outcome === "right",
      kind: q.kind,
      why: q.why,
    });
    walk(session);
    session.steps.pop();
  });
}

bank.opener.choices.forEach(function (c) {
  walk({ opener: c.id, steps: [] });
});

function show(title, opener, script) {
  const session = { opener: opener, steps: [] };
  const line = [];
  for (;;) {
    const q = engine.next(bank, session, function () { return 0; });
    if (!q) break;
    const outcome = script(index[q.id], session.steps.length);
    session.steps.push({ id: q.id, pick: outcome === "idk" ? engine.IDK : outcome, ok: outcome === "right", kind: q.kind, why: q.why });
    line.push(q.area.slice(0, 4) + q.tier + (outcome === "right" ? "+" : outcome === "idk" ? "?" : "-"));
  }
  const r = engine.assess(bank, session);
  console.log(title.padEnd(34), line.join(" ").padEnd(64), "->", r.level.name + ",", r.kind,
    r.kind === "open" ? "" : "(" + r.primary.type + (r.secondary ? " + " + r.secondary.type : "") + ")");
}

console.log("paths walked:", paths);
console.log("scored questions per path:", lengths);
console.log("levels:", levels);
console.log("types:", kinds);
console.log("");
show("knows nothing, says so", "explore", function () { return "idk"; });
show("knows nothing, guesses wrong", "explore", function () { return "wrong"; });
show("knows everything", "protocol", function () { return "right"; });
show("knows tier 1 only", "adopt", function (q) { return q.tier <= 1 ? "right" : "idk"; });
show("knows tiers 1 and 2", "build", function (q) { return q.tier <= 2 ? "right" : "wrong"; });
show("developer: protocol + tooling", "build", function (q) {
  if (q.area === "protocol" || q.area === "infrastructure") return "right";
  return q.tier <= 1 ? "right" : "idk";
});
show("governance person", "adopt", function (q) {
  if (q.area === "ecosystem") return "right";
  if (q.area === "credentials") return q.tier <= 2 ? "right" : "idk";
  return q.tier <= 1 ? "right" : "idk";
});
show("expert who called himself new", "explore", function () { return "right"; });
console.log("\nall checks passed");
