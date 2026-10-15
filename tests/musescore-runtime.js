#!/usr/bin/env node
// Runtime tests: run the REAL plugin inside a real MuseScore 4 (headless) on a set of small
// scores and check the exported result. See tests/lib/harness.js for how this works, and
// tests/runtime-scenarios.js for what is checked.
//
// Usage:
//   node tests/musescore-runtime.js --musescore <path-to-mscore> [options]
//     --timeout <s>          per MuseScore run (default 120)
//     --only a,b             run only these scenarios
//     --list                 list the scenarios and exit
//     --update-golden        rewrite tests/golden/*.json from the current output
//     --write-fixtures <dir> write the generated test scores as .musicxml files and exit
//     --verbose              print every passed check too
// On Linux run it under a virtual display: xvfb-run -a node tests/musescore-runtime.js ...
//
// Golden files pin the exact fingering the algorithm produces for a few scores. The algorithm is
// meant to stay stable between releases, so a change shows up as a diff. If the change is
// intended, run with --update-golden and commit the files.
// SPF_GOLDEN=warn turns golden mismatches into warnings.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createHarness } = require("./lib/harness");
const fixtures = require("./lib/fixtures");
const { scenarios } = require("./runtime-scenarios");

const repo = path.join(__dirname, "..");
const goldenDir = path.join(__dirname, "golden");

function arg(name, def) {
    const i = process.argv.indexOf("--" + name);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const flag = name => process.argv.indexOf("--" + name) >= 0;

// ------------------------------------------------------------------ simple modes
if (flag("list")) {
    scenarios.forEach(s => console.log(s.name.padEnd(28) + s.description));
    process.exit(0);
}
if (flag("write-fixtures")) {
    const dir = arg("write-fixtures", null);
    if (!dir) { console.error("Missing directory after --write-fixtures"); process.exit(2); }
    fs.mkdirSync(dir, { recursive: true });
    Object.keys(fixtures).forEach(k => fs.writeFileSync(path.join(dir, k + ".musicxml"), fixtures[k](), "utf8"));
    console.log("Wrote " + Object.keys(fixtures).length + " scores to " + dir);
    process.exit(0);
}

const musescore = arg("musescore", process.env.MUSESCORE_EXE);
const timeoutSec = Number(arg("timeout", "120"));
if (!musescore) { console.error("Missing --musescore <path> (or MUSESCORE_EXE)."); process.exit(2); }
if (!fs.existsSync(musescore)) { console.error("MuseScore executable not found: " + musescore); process.exit(2); }

const only = arg("only", null);
const selected = only ? scenarios.filter(s => only.split(",").indexOf(s.name) >= 0) : scenarios;
if (only && !selected.length) { console.error("No scenario matches --only " + only + ". Use --list."); process.exit(2); }
const updateGolden = flag("update-golden");
const verbose = flag("verbose");
const goldenWarnOnly = process.env.SPF_GOLDEN === "warn";

const harness = createHarness({
    musescore: musescore, timeoutSec: timeoutSec,
    qmlSource: path.join(repo, "smart-piano-fingering.qml"),
});

// ------------------------------------------------------------------ golden files
function goldenLines(notes) {
    return notes.filter(x => !x.rest && !x.grace).map(x =>
        "m" + x.measure + " s" + x.staff + " v" + x.voice + " @" + x.onset + " " + x.midi + "=" +
        (x.fingers.length ? x.fingers.join("+") : "-"));
}

function compareGolden(key, notes) {
    const file = path.join(goldenDir, key + ".json");
    const lines = goldenLines(notes);
    const sha = crypto.createHash("sha1").update(lines.join("\n")).digest("hex");
    const big = lines.length > 300;
    const current = big ? { count: lines.length, sha1: sha, head: lines.slice(0, 40) } : { count: lines.length, lines: lines };
    if (updateGolden) {
        fs.mkdirSync(goldenDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(current, null, 1) + "\n", "utf8");
        return { ok: true, message: "golden " + key + " updated (" + lines.length + " notes)" };
    }
    if (!fs.existsSync(file)) {
        return { ok: false, message: "golden " + key + ": no file; run with --update-golden to create it" };
    }
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (big) {
        const same = saved.count === current.count && saved.sha1 === current.sha1;
        let detail = "";
        if (!same) {
            const k = current.head.findIndex((l, i) => l !== saved.head[i]);
            detail = k >= 0 ? " (first difference among the first 40 notes: was \"" + saved.head[k] + "\", now \"" + current.head[k] + "\")"
                : " (the first 40 notes are unchanged; later notes differ)";
        }
        return { ok: same, message: "golden " + key + ": fingering of " + lines.length + " notes matches the saved result" + (same ? "" : detail) };
    }
    const diffs = [];
    for (let i = 0; i < Math.max(saved.lines.length, lines.length); i++) {
        if (saved.lines[i] !== lines[i]) { diffs.push("#" + i + ": was \"" + saved.lines[i] + "\", now \"" + lines[i] + "\""); }
    }
    return {
        ok: diffs.length === 0,
        message: "golden " + key + ": fingering matches the saved result" +
            (diffs.length ? " (" + diffs.length + " difference(s): " + diffs.slice(0, 6).join("; ") + ")" : ""),
    };
}

// ------------------------------------------------------------------ running
let totalFailed = 0;
let environmentProblem = false;   // MuseScore itself failed to run (not just an assertion)
const summary = [];

function diagnose() {
    console.log("\nDiagnosis");
    harness.roots.forEach(r => console.log("  plugin folder candidate: " + r));
    const p = harness.probe(path.join(__dirname, "fixtures", "smoke.musicxml"));
    console.log("  trivial probe plugin: exit " + p.exit.status + (p.exit.timedOut ? " (timeout)" : "") + " -> " + (p.ok ? "worked" : "did NOT run"));
    console.log(p.ok
        ? "  => MuseScore finds and runs a trivial plugin here: plugin folder and URI are fine; see the MuseScore errors below."
        : (p.exit.status === 0
            ? "  => MuseScore ran but did NOT execute even a trivial plugin: plugin folder or --extension URI problem on this platform."
            : "  => MuseScore itself failed (exit " + p.exit.status + (p.exit.signal ? ", signal " + p.exit.signal : "") + "): startup or crash problem, see the output below."));
    const errs = harness.museScoreLogErrors();
    console.log("  MuseScore log errors (" + errs.length + "):");
    errs.slice(0, 15).forEach(l => console.log("    " + l));
    const logFile = process.env.SPF_RUNTIME_LOG || path.join(harness.tmp, "musescore-output.log");
    try {
        fs.writeFileSync(logFile, harness.diagnostics() + "\n--- MuseScore log errors ---\n" + errs.join("\n") + "\n", "utf8");
        console.log("  full MuseScore output saved to " + logFile);
    } catch (e) { /* ignore */ }
}

function runScenario(s) {
    const t0 = Date.now();
    let checks = 0, failed = 0;
    const lines = [];
    const ctx = {
        fixtureFile: name => path.join(__dirname, "fixtures", name),
        file: (name, xml) => harness.writeFixture(name, xml),
        run: (fixture, cfg) => {
            const r = harness.runPlugin(fixture, cfg || {});
            if (r.problem) { environmentProblem = true; }
            if (r.toleratedCrash) {
                const w = "  warn MuseScore was killed by " + r.exit.signal + " after writing the output (shutdown crash, ignored)";
                if (lines.indexOf(w) < 0) { lines.push(w); }
            }
            return r;
        },
        check: (ok, message) => {
            checks++;
            if (!ok) { failed++; lines.push("  FAIL " + message); } else if (verbose) { lines.push("  ok   " + message); }
        },
        info: message => lines.push("  info " + message),
        golden: (key, notes) => {
            const g = compareGolden(key, notes);
            checks++;
            if (g.ok) { if (verbose || updateGolden) { lines.push("  ok   " + g.message); } }
            else if (goldenWarnOnly) { lines.push("  warn " + g.message); }
            else { failed++; lines.push("  FAIL " + g.message); }
        },
    };
    try {
        s.run(ctx);
    } catch (e) {
        failed++;
        lines.push("  FAIL unexpected error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log((failed ? "FAIL " : "PASS ") + s.name.padEnd(28) + checks + " checks, " + secs + " s");
    lines.forEach(l => console.log(l));
    summary.push({ name: s.name, failed: failed, checks: checks, secs: secs });
    totalFailed += failed;
}

try {
    console.log("MuseScore runtime tests");
    console.log("  platform: " + process.platform + " " + process.arch + ", node " + process.version);
    console.log("  plugin folder candidates: " + harness.roots.join(", "));

    // Preflight: MuseScore can convert the fixture, and the fixture has no fingering by itself,
    // so every fingering found later comes from the plugin.
    const base = harness.convertOnly(path.join(__dirname, "fixtures", "smoke.musicxml"));
    if (base.toleratedCrash) { console.log("  warn MuseScore was killed by a signal after writing the output (shutdown crash, ignored)"); }
    const pre = !base.problem && base.notes.filter(x => x.fingers.length).length === 0;
    console.log((pre ? "PASS " : "FAIL ") + "preflight".padEnd(28) + (base.problem ? base.problem : "MuseScore converts the fixture; no fingering before the plugin runs"));
    if (!pre) { totalFailed++; environmentProblem = true; }
    else {
        for (const s of selected) {
            runScenario(s);
            if (environmentProblem) {
                console.log("Stopping: MuseScore itself failed to run, so the remaining scenarios would only repeat the problem.");
                break;
            }
        }
    }
    if (environmentProblem) { diagnose(); }
} catch (e) {
    totalFailed++;
    console.error("FAIL unexpected error: " + e.message);
} finally {
    harness.cleanup();
}

console.log("\n" + summary.length + " scenario(s): " + summary.filter(s => !s.failed).length + " passed, " +
    summary.filter(s => s.failed).length + " failed" + (updateGolden ? " (golden files updated)" : ""));
if (environmentProblem) {
    const d = harness.diagnostics();
    console.log("\n--- last 3000 characters of MuseScore output ---\n" + d.slice(-3000) + "\n--- end ---");
}
process.exit(totalFailed ? 1 : 0);
