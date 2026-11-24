/* Adaptive engine. No DOM in here, so it also runs under Node (see test/simulate.js).

   A session is { opener: <opener choice id>, steps: [ { id, pick, ok, kind, why } ] }.

   next(bank, session)   -> the next question to ask, or null when the questionnaire is done
   assess(bank, session) -> level, type and per-area scores

   How the next question is chosen:
     1. Breadth. Each area is visited once, in the order set by the opening answer.
        The tier follows the previous answer: right -> one tier harder, wrong -> one easier.
     2. Depth. Inside an area the same staircase continues until the area is settled,
        meaning the highest tier that holds is known. The strongest area goes first.
     3. Second looks, while questions remain: confirm the highest tier that held,
        then give a second chance at a tier that was missed by a wrong pick
        (not by "I don't know").
*/
(function (root) {
  const MAX_SCORED = 9; /* plus the opening question: ten at most */
  const TOP_TIER = 3;
  const IDK = "idk";

  function byId(bank) {
    const map = {};
    bank.questions.forEach(function (q) { map[q.id] = q; });
    return map;
  }

  function clamp(tier) {
    return Math.max(1, Math.min(TOP_TIER, tier));
  }

  /* What has been asked so far, grouped by area and tier. */
  function tally(bank, session) {
    const index = byId(bank);
    const areas = {};
    bank.areas.forEach(function (a) {
      areas[a.id] = { id: a.id, asked: { 1: [], 2: [], 3: [] }, lastProbe: null, count: 0 };
    });
    session.steps.forEach(function (step) {
      const q = index[step.id];
      const area = areas[q.area];
      const entry = { tier: q.tier, ok: step.ok, pick: step.pick, kind: step.kind };
      area.asked[q.tier].push(entry);
      area.count += 1;
      if (step.kind === "probe") area.lastProbe = entry;
    });
    return areas;
  }

  function anyRight(list) {
    return list.some(function (e) { return e.ok; });
  }

  /* Highest tier with a right answer, 0 if none. */
  function topHeld(area) {
    for (let t = TOP_TIER; t >= 1; t -= 1) {
      if (anyRight(area.asked[t])) return t;
    }
    return 0;
  }

  /* Score from 0 to 3. A tier that was asked counts for the share answered right.
     A tier that was skipped counts as held when a harder tier held. */
  function scoreOf(area) {
    const top = topHeld(area);
    let total = 0;
    for (let t = 1; t <= TOP_TIER; t += 1) {
      const list = area.asked[t];
      if (list.length) {
        total += list.filter(function (e) { return e.ok; }).length / list.length;
      } else if (t < top) {
        total += 1;
      }
    }
    return total;
  }

  /* Next tier on the staircase for this area, or 0 when the area is settled. */
  function stair(area) {
    const last = area.lastProbe;
    if (!last) return 0;
    const tier = last.ok ? last.tier + 1 : last.tier - 1;
    if (tier < 1 || tier > TOP_TIER) return 0;
    if (area.asked[tier].length) return 0;
    return tier;
  }

  function unused(bank, session, areaId, tier) {
    const seen = {};
    session.steps.forEach(function (s) { seen[s.id] = true; });
    return bank.questions.filter(function (q) {
      return q.area === areaId && q.tier === tier && !seen[q.id];
    });
  }

  function openerOf(bank, session) {
    return bank.opener.choices.find(function (c) { return c.id === session.opener; })
      || bank.opener.choices[0];
  }

  /* Areas ordered by score, strongest first. Ties keep the opener's order. */
  function ranked(bank, session, areas) {
    const order = openerOf(bank, session).order;
    return order
      .map(function (id, i) { return { area: areas[id], score: scoreOf(areas[id]), i: i }; })
      .sort(function (a, b) { return b.score - a.score || a.i - b.i; })
      .map(function (row) { return row.area; });
  }

  function candidates(bank, session) {
    const areas = tally(bank, session);
    const opener = openerOf(bank, session);
    const steps = session.steps;
    const list = [];

    /* 1. Breadth */
    const fresh = opener.order.filter(function (id) { return areas[id].count === 0; });
    if (fresh.length) {
      if (!steps.length) {
        list.push({ area: fresh[0], tier: clamp(opener.start), kind: "probe", why: "start" });
      } else {
        const index = byId(bank);
        const last = steps[steps.length - 1];
        const lastTier = index[last.id].tier;
        const tier = clamp(lastTier + (last.ok ? 1 : -1));
        const why = tier > lastTier ? "wider-up" : tier < lastTier ? "wider-down" : "wider-same";
        list.push({ area: fresh[0], tier: tier, kind: "probe", why: why });
      }
      return list;
    }

    const order = ranked(bank, session, areas);

    /* 2. Depth */
    order.forEach(function (area) {
      const tier = stair(area);
      if (tier) {
        list.push({
          area: area.id,
          tier: tier,
          kind: "probe",
          why: area.lastProbe.ok ? "deeper-up" : "deeper-down",
        });
      }
    });
    if (list.length) return list;

    /* 3. Second looks */
    order.forEach(function (area) {
      const top = topHeld(area);
      if (top >= 1 && area.asked[top].length === 1) {
        list.push({ area: area.id, tier: top, kind: "check", why: "confirm" });
      }
    });
    order.forEach(function (area) {
      const tier = topHeld(area) + 1;
      if (tier > TOP_TIER) return;
      const tried = area.asked[tier];
      if (tried.length === 1 && !tried[0].ok && tried[0].pick !== IDK) {
        list.push({ area: area.id, tier: tier, kind: "check", why: "retry" });
      }
    });
    return list;
  }

  function next(bank, session, random) {
    if (session.steps.length >= MAX_SCORED) return null;
    const rnd = random || Math.random;
    const list = candidates(bank, session);
    for (let i = 0; i < list.length; i += 1) {
      const c = list[i];
      const pool = unused(bank, session, c.area, c.tier);
      if (pool.length) {
        const q = pool[Math.floor(rnd() * pool.length)];
        return { id: q.id, area: c.area, tier: c.tier, kind: c.kind, why: c.why };
      }
    }
    return null;
  }

  const LEVELS = [
    { id: "newcomer", name: "Newcomer", from: 0 },
    { id: "familiar", name: "Familiar", from: 1 },
    { id: "practitioner", name: "Practitioner", from: 2 },
    { id: "specialist", name: "Specialist", from: 2.75 },
  ];

  function assess(bank, session) {
    const areas = tally(bank, session);
    const opener = openerOf(bank, session);
    const meta = {};
    bank.areas.forEach(function (a) { meta[a.id] = a; });

    const rows = ranked(bank, session, areas).map(function (area) {
      return {
        id: area.id,
        name: meta[area.id].name,
        type: meta[area.id].type,
        blurb: meta[area.id].blurb,
        score: scoreOf(area),
        top: topHeld(area),
        asked: area.count,
      };
    });

    /* Level: the mean of the two strongest areas. */
    const depth = (rows[0].score + rows[1].score) / 2;
    let level = LEVELS[0];
    LEVELS.forEach(function (l) { if (depth >= l.from) level = l; });

    /* Type: the shape of the scores across areas. */
    const first = rows[0];
    const second = rows[1];
    const solid = rows.filter(function (r) { return r.score >= 2; });
    let kind;
    if (solid.length >= 3) kind = "broad";
    else if (first.score < 1.5) kind = "open";
    else if (second.score >= 1.5 && first.score - second.score <= 0.5) kind = "bridge";
    else kind = "focused";

    const right = session.steps.filter(function (s) { return s.ok; }).length;
    return {
      level: level,
      depth: depth,
      kind: kind,
      rows: rows,
      primary: first,
      secondary: kind === "bridge" ? second : null,
      thin: rows.filter(function (r) { return r.score < 1; }),
      lean: opener.lean,
      opener: opener,
      right: right,
      asked: session.steps.length,
    };
  }

  const engine = {
    MAX_SCORED: MAX_SCORED,
    TOP_TIER: TOP_TIER,
    IDK: IDK,
    LEVELS: LEVELS,
    next: next,
    assess: assess,
  };

  root.KERIENGINE = engine;
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
})(typeof globalThis !== "undefined" ? globalThis : this);
