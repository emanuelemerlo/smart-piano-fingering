// Runs the musical reference suite against a fingering core and classifies every result.
"use strict";
const { run, physicalCheck, classify, RANK } = require("./lib.js");
const { allCases } = require("./musical-suite.js");

function evaluate(core, c, opts) {
    const r = run(core, c.items, c.side, c.size, opts);
    r.items = c.items;
    const phys = physicalCheck(c.items, r.fingers, c.side, c.size);
    const cls = classify(r.fingers, phys, c.expected, c.variants, c.perNote);
    let pass = RANK[cls] >= RANK[c.min || "ACCEPTABLE VARIANT"];
    let reason = "";
    if (!pass) {
        reason = cls === "PHYSICALLY IMPOSSIBLE" ? phys.impossible[0] : "below " + (c.min || "ACCEPTABLE VARIANT");
    }
    if (pass && c.clean && phys.nonstandard.length) { pass = false; reason = "non-standard succession: " + phys.nonstandard[0]; }
    if (pass && c.check) {
        let err;
        try { err = c.check(r, c); } catch (e) { err = "check failed: " + e.message; }
        if (err) { pass = false; reason = err; }
    }
    if (pass && !reason) {
        reason = cls === "CANONICAL" ? "" : (phys.nonstandard.length ? phys.nonstandard[0] : "");
    }
    return { case: c, fingers: r.fingers, cls, pass, reason, warnings: r.warnings, analysis: r.analysis, phys };
}

function runSuite(core, opts) {
    return allCases().map(c => evaluate(core, c, opts));
}

const fmt = a => (a ? a.join("") : "");

function markdownTable(results) {
    const lines = ["| # | group | case | expected | actual | class | result | reason |", "|---|---|---|---|---|---|---|---|"];
    results.forEach((r, i) => {
        lines.push("| " + (i + 1) + " | " + r.case.group + " | " + r.case.name + " | " + (fmt(r.case.expected) || "–") + " | " +
            fmt(r.fingers) + " | " + r.cls + " | " + (r.pass ? "pass" : "**FAIL**") + " | " + (r.reason || "").replace(/\|/g, "/") + " |");
    });
    return lines.join("\n");
}

function summary(results) {
    const by = {};
    results.forEach(r => {
        const g = r.case.group;
        by[g] = by[g] || { total: 0, pass: 0, CANONICAL: 0, "ACCEPTABLE VARIANT": 0, "VALID (no reference)": 0, "NON-STANDARD": 0, "PHYSICALLY IMPOSSIBLE": 0 };
        by[g].total++; if (r.pass) { by[g].pass++; } by[g][r.cls]++;
    });
    return by;
}

module.exports = { runSuite, evaluate, markdownTable, summary, allCases };
