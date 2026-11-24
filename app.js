(function () {
  const bank = globalThis.KERIBANK;
  const engine = globalThis.KERIENGINE;
  const KEY = "keri-knowledge-adaptive-v1";
  const root = document.getElementById("app");

  if (!bank || !engine || !bank.questions || !bank.questions.length) {
    root.textContent = "The question bank did not load.";
    return;
  }

  const index = {};
  bank.questions.forEach(function (q) { index[q.id] = q; });
  const areaOf = {};
  bank.areas.forEach(function (a) { areaOf[a.id] = a; });

  const TOTAL = engine.MAX_SCORED + 1;
  const TIER = { 1: "Base", 2: "Working", 3: "Hard" };
  const IDK_TEXT = "I don’t know yet.";

  const LEVEL_LINE = {
    newcomer: "KERI is still new ground. Nothing held firmly enough yet to place you higher, and that is a fine place to start from.",
    familiar: "The basic ideas hold in your strongest areas. The working detail does not hold yet.",
    practitioner: "The working detail holds in your strongest areas. The hardest questions did not hold consistently.",
    specialist: "The hardest questions held in your two strongest areas.",
  };

  const WHY = {
    start: "The starting point, set by your opening answer.",
    "wider-up": "A new area. Your previous answer held, so this question was one tier harder.",
    "wider-down": "A new area. Your previous answer did not hold, so this question was one tier easier.",
    "wider-same": "A new area, at the same tier as the previous question.",
    "deeper-up": "Your earlier answer in this area held, so this question was harder.",
    "deeper-down": "Your earlier answer in this area did not hold, so this question was easier.",
    confirm: "A second question at the highest tier that held in this area, to confirm it.",
    retry: "A second chance at a tier you missed in this area.",
  };

  let state = load();
  let focusKey = "";

  function blank() {
    return { phase: "intro", opener: "", steps: [], current: null, pick: "" };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (!saved || saved.version !== bank.version) return blank();
      const steps = (saved.steps || []).filter(function (s) { return index[s.id]; });
      if (steps.length !== (saved.steps || []).length) return blank();
      if (saved.current && !index[saved.current.id]) return blank();
      return {
        phase: saved.phase || "intro",
        opener: saved.opener || "",
        steps: steps,
        current: saved.current || null,
        pick: saved.pick || "",
      };
    } catch (err) {
      return blank();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: bank.version,
        phase: state.phase,
        opener: state.opener,
        steps: state.steps,
        current: state.current,
        pick: state.pick,
      }));
    } catch (err) {
      /* Private mode or a full store: the questionnaire still works for this visit. */
    }
  }

  function session() {
    return { opener: state.opener, steps: state.steps };
  }

  function shuffled(q) {
    const ids = q.choices.map(function (c) { return c.id; });
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = ids[i];
      ids[i] = ids[j];
      ids[j] = tmp;
    }
    return ids;
  }

  /* Ask the engine what comes next, given everything answered so far. */
  function advance() {
    const pick = engine.next(bank, session());
    if (!pick) {
      state.phase = "results";
      state.current = null;
    } else {
      state.phase = "test";
      state.current = { id: pick.id, kind: pick.kind, why: pick.why, order: shuffled(index[pick.id]) };
    }
    state.pick = "";
  }

  function commit() {
    if (!state.pick) return;
    if (state.phase === "opener") {
      state.opener = state.pick;
      state.steps = [];
      advance();
    } else if (state.phase === "test" && state.current) {
      const q = index[state.current.id];
      state.steps.push({
        id: q.id,
        pick: state.pick,
        ok: state.pick === q.answer,
        kind: state.current.kind,
        why: state.current.why,
        order: state.current.order,
      });
      advance();
    }
    go();
  }

  /* Going back removes the last answer. The path is worked out again from there. */
  function back() {
    if (state.phase === "opener") {
      state.phase = "intro";
    } else if (state.phase === "test") {
      const last = state.steps.pop();
      if (last) {
        state.current = { id: last.id, kind: last.kind, why: last.why, order: last.order };
        state.pick = last.pick;
      } else {
        state.phase = "opener";
        state.current = null;
        state.pick = state.opener;
      }
    }
    go();
  }

  function go() {
    save();
    render();
    window.scrollTo(0, 0);
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    const props = attrs || {};
    Object.keys(props).forEach(function (key) {
      const value = props[key];
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.indexOf("on") === 0 && typeof value === "function") {
        node.addEventListener(key.slice(2), value);
      } else if (value === true) node.setAttribute(key, "");
      else if (value !== false && value != null) node.setAttribute(key, String(value));
    });
    (children || []).forEach(function (child) {
      if (child == null || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function number() {
    return state.phase === "opener" ? 1 : state.steps.length + 2;
  }

  function render() {
    root.replaceChildren();
    const shell = el("div", { class: "app" });
    shell.append(header());
    if (state.phase === "opener") shell.append(openerView());
    else if (state.phase === "test" && state.current) shell.append(testView());
    else if (state.phase === "results" && state.opener) shell.append(resultsView());
    else shell.append(intro());
    root.append(shell);

    const key = state.phase + ":" + state.steps.length;
    if (key !== focusKey) {
      const focus = shell.querySelector("[data-focus]");
      if (focus) focus.focus();
      focusKey = key;
    } else {
      const selected = shell.querySelector('.choice[aria-checked="true"]');
      if (selected) selected.focus({ preventScroll: true });
    }
  }

  function header() {
    const asking = state.phase === "opener" || state.phase === "test";
    const meta = asking
      ? "Question " + number() + " · " + TOTAL + " at most"
      : state.phase === "results" ? "Result" : "About 5 minutes";
    const done = asking ? ((number() - 1) / TOTAL) * 100 : state.phase === "results" ? 100 : 0;
    return el("header", {}, [
      el("div", { class: "top" }, [
        el("div", { class: "mark" }, [mark(), el("span", { text: "KERI knowledge assessment" })]),
        el("div", { class: "top-meta", text: meta }),
      ]),
      el("div", { class: "progress", role: "presentation" }, [
        el("span", { style: "width:" + done + "%" }),
      ]),
    ]);
  }

  function mark() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "28");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 28 16");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<rect x="0.5" y="3.5" width="9" height="9" fill="none" stroke="#1c1914" stroke-width="1.2"/><rect x="9.5" y="3.5" width="9" height="9" fill="none" stroke="#1c1914" stroke-width="1.2"/><rect x="18.5" y="3.5" width="9" height="9" fill="#8c3b22" stroke="#8c3b22" stroke-width="1.2"/>';
    return svg;
  }

  function intro() {
    const box = el("section", {});
    box.append(el("h1", { tabindex: "-1", "data-focus": "true", text: "Where do you stand in KERI?" }));
    box.append(el("p", { class: "dek", text: "A short questionnaire that adapts to you. Each answer decides the next question: a right answer brings a harder one, a miss brings an easier one." }));
    box.append(el("ul", { class: "facts" }, [
      fact("Length", TOTAL + " questions at most. Fewer when your level is clear sooner."),
      fact("Level", "Newcomer, Familiar, Practitioner, or Specialist."),
      fact("Type", "Protocol thinker, builder, credential designer, adopter, or generalist."),
    ]));
    box.append(el("p", { text: "Guessing blurs the result. When you do not know, say so: every question has that answer." }));
    box.append(el("p", { class: "quiet", text: "Scored in this browser. Nothing is sent anywhere. Not a certification." }));
    box.append(el("div", { class: "actions" }, [
      el("span", {}),
      el("button", {
        class: "btn",
        type: "button",
        text: "Begin",
        onclick: function () {
          state = blank();
          state.phase = "opener";
          go();
        },
      }),
    ]));
    return box;
  }

  function fact(title, text) {
    return el("li", {}, [el("strong", { text: title }), el("span", { text: text })]);
  }

  function openerView() {
    const options = bank.opener.choices.map(function (c) { return { id: c.id, text: c.text }; });
    return questionBlock({
      kicker: "Opening question",
      prompt: bank.opener.prompt,
      note: bank.opener.note,
      options: options,
      next: "Next",
    });
  }

  function testView() {
    const q = index[state.current.id];
    const options = state.current.order.map(function (id) {
      const choice = q.choices.find(function (c) { return c.id === id; });
      return { id: choice.id, text: choice.text };
    });
    options.push({ id: engine.IDK, text: IDK_TEXT, soft: true });
    return questionBlock({
      kicker: areaOf[q.area].name,
      prompt: q.prompt,
      options: options,
      next: "Next",
    });
  }

  function questionBlock(view) {
    const box = el("section", {});
    box.append(el("p", { class: "kicker", text: view.kicker }));
    box.append(el("h2", { class: "ask", tabindex: "-1", "data-focus": "true", text: view.prompt }));
    if (view.note) box.append(el("p", { class: "quiet", text: view.note }));

    const choices = el("div", { class: "choices", role: "radiogroup", "aria-label": "Answers" });
    view.options.forEach(function (option, i) {
      const selected = state.pick === option.id;
      choices.append(el("button", {
        type: "button",
        class: "choice" + (option.soft ? " soft" : ""),
        role: "radio",
        "aria-checked": selected ? "true" : "false",
        onclick: function () {
          state.pick = option.id;
          save();
          render();
        },
      }, [
        el("b", { text: String(i + 1) }),
        document.createTextNode(option.text),
      ]));
    });
    box.append(choices);

    box.append(el("div", { class: "actions" }, [
      el("button", { type: "button", class: "btn secondary", text: "Back", onclick: back }),
      el("button", { type: "button", class: "btn", text: view.next, disabled: !state.pick, onclick: commit }),
    ]));
    return box;
  }

  function lower(text) {
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  function typeTitle(result) {
    if (result.kind === "broad") return "Generalist";
    if (result.kind === "open") return "No settled type yet";
    if (result.kind === "bridge") return result.primary.type + " and " + lower(result.secondary.type);
    return result.primary.type;
  }

  function typeLine(result) {
    const first = result.rows[0];
    const second = result.rows[1];
    if (result.kind === "broad") {
      const thin = result.thin.map(function (r) { return r.name; });
      const tail = thin.length
        ? " " + thin.join(" and ") + " is still thin."
        : "";
      return "Three or more areas hold at working level or better. That is knowledge across the field, not one specialty." + tail;
    }
    if (result.kind === "open") {
      if (first.score > 0 && first.score > second.score) {
        return "No area holds at working level yet, so a type would be a guess. The nearest lean is " + lower(first.name) + ".";
      }
      return "No area holds at working level yet, and none stands ahead of the others. A type would be a guess.";
    }
    if (result.kind === "bridge") {
      const gap = first.score > second.score ? " is close behind" : " holds just as well";
      return first.blurb + " " + second.name + gap + ", so this is two specialties, not one.";
    }
    return first.blurb;
  }

  function openerNote(result) {
    const said = "Your opening answer: “" + result.opener.text + "”";
    if (!result.lean) {
      if (result.level.id === "newcomer" || result.level.id === "familiar") return said + " The answers agree.";
      return said + " The answers sit above that.";
    }
    const lean = areaOf[result.lean].name.toLowerCase();
    if (result.kind === "broad") return said + " The answers reach wider than " + lean + ".";
    if (result.kind === "open") return said + " The answers do not confirm a type yet.";
    const match = result.primary.id === result.lean
      || (result.secondary && result.secondary.id === result.lean);
    if (match) return said + " That is where the answers are strongest.";
    return said + " The answers are strongest in " + lower(result.primary.name) + ".";
  }

  function reached(row) {
    if (row.score < 1) return row.score > 0 ? "Partly base" : "Not yet";
    if (row.score >= 3) return "Hard";
    if (row.score >= 2) return row.score > 2 ? "Working, partly hard" : "Working";
    return row.score > 1 ? "Base, partly working" : "Base";
  }

  function bars(result) {
    const order = bank.areas.map(function (a) {
      return result.rows.find(function (r) { return r.id === a.id; });
    });
    return el("ul", { class: "bars" }, order.map(function (row) {
      const width = Math.round((row.score / engine.TOP_TIER) * 100) + "%";
      return el("li", {}, [
        el("span", { class: "name", text: row.name }),
        el("span", { class: "track", title: row.name }, [el("span", { style: "width:" + width })]),
        el("span", { class: "pct", text: reached(row) }),
      ]);
    }));
  }

  function outcome(step) {
    if (step.ok) return "Held";
    return step.pick === engine.IDK ? "Not known" : "Missed";
  }

  function pathView() {
    const details = el("details", {}, [
      el("summary", { text: "Your path, question by question (" + state.steps.length + ")" }),
    ]);
    state.steps.forEach(function (step, i) {
      const q = index[step.id];
      const theirs = q.choices.find(function (c) { return c.id === step.pick; });
      const right = q.choices.find(function (c) { return c.id === q.answer; });
      const block = el("div", { class: "miss" }, [
        el("p", { class: "tag" }, [
          (i + 2) + " · " + areaOf[q.area].name + " · " + TIER[q.tier] + " · ",
          el("span", { class: step.ok ? "held" : "lost", text: outcome(step) }),
        ]),
        el("h3", { text: q.prompt }),
        el("p", { class: "quiet", text: WHY[step.why] || "" }),
      ]);
      if (!step.ok) {
        block.append(el("p", { text: "Your answer: " + (theirs ? theirs.text : IDK_TEXT) }));
      }
      block.append(el("p", { text: (step.ok ? "Your answer: " : "The answer: ") + right.text }));
      block.append(el("p", { text: q.why }));
      block.append(el("p", { class: "source", text: q.source }));
      details.append(block);
    });
    return details;
  }

  function resultsView() {
    const result = engine.assess(bank, session());
    const box = el("section", {});
    box.append(el("p", { class: "level", text: "Knowledge level" }));
    box.append(el("h1", { class: "level-name", tabindex: "-1", "data-focus": "true", text: result.level.name }));
    box.append(el("p", { class: "dek", text: LEVEL_LINE[result.level.id] }));
    box.append(el("p", { class: "scoreline", text: result.right + " of " + result.asked + " scored questions held" }));

    const card = el("div", { class: "profile" });
    card.append(el("p", { class: "tag", text: "Type" }));
    card.append(el("h3", { text: typeTitle(result) }));
    card.append(el("p", { text: typeLine(result) }));
    card.append(el("p", { class: "quiet", text: openerNote(result) }));
    card.append(bars(result));
    box.append(card);

    box.append(pathView());

    box.append(el("details", {}, [
      el("summary", { text: "How this was placed" }),
      el("p", { text: "Questions come in four areas and three tiers: base, working, hard. Your opening answer set the first area and the first tier. After that each answer set the next question: one tier up after a right answer, one tier down after a miss, until the highest tier that holds in each area was found. Questions left over were spent on second looks." }),
      el("p", { text: "Each area scores from 0 to 3, one point per tier that held, half a point where two questions on a tier split. A tier that was skipped on the way up counts as held. “I don’t know yet” counts as a miss, without the second chance a wrong pick gets." }),
      el("p", { text: "The level is the average of your two strongest areas: Familiar from 1, Practitioner from 2, Specialist from 2.75. The type is the shape across the areas: one area clearly ahead names a type, two close together name both, three or more at working level make a generalist. When areas tie, the one nearer your opening answer is listed first." }),
    ]));

    box.append(el("div", { class: "actions" }, [
      el("span", {}),
      el("button", {
        type: "button",
        class: "btn",
        text: "Start over",
        onclick: function () {
          state = blank();
          go();
        },
      }),
    ]));
    box.append(el("p", { class: "footnote", text: "Sources live in understanding-KERI/txt and in the KERI Conference 2026 subtitle files. The questions paraphrase them. They do not replace the specifications, and a high result is not permission to operate a production agent." }));
    return box;
  }

  document.addEventListener("keydown", function (event) {
    if (state.phase !== "opener" && state.phase !== "test") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const buttons = root.querySelectorAll(".choice");
    const n = "123456789".indexOf(event.key);
    if (n >= 0 && buttons[n]) {
      buttons[n].click();
      return;
    }
    const active = document.activeElement;
    const onChoice = active && active.classList && active.classList.contains("choice");
    if (event.key === "Enter" && state.pick && onChoice) {
      event.preventDefault();
      commit();
    }
  });

  render();
})();
