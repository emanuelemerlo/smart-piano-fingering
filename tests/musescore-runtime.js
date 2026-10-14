#!/usr/bin/env node
// Runtime test: runs the REAL plugin inside a real MuseScore 4 and checks the exported score.
//
// How it works
//   MuseScore 4 has no "--plugin" command line option (Qt swallows it as one of its own
//   options and prints 'No such plugin for spec ...'). What MuseScore 4 does offer is
//       mscore -o out.musicxml --extension <uri> score
//   which runs an extension/plugin on the score and then exports it. Legacy QML plugins
//   found in the user Plugins folder get the URI
//       musescore://extensions/v1/<folder>/<file>.qml        (lower-case)
//
//   The production plugin is a dialog that waits for a click on "Apply", which cannot be
//   done headless. So this script builds a TEST COPY of smart-piano-fingering.qml in which
//     1. pluginType: "dialog" is removed, and
//     2. onRun additionally calls applyFingering() and drives runSlice() synchronously.
//   Everything else (the whole QML tree, the embedded core and the adapter talking to the
//   real MuseScore plugin API) is the production code, loaded by MuseScore's own QML engine.
//
// What it does NOT cover: the dialog's look and feel, and clicks on its buttons.
//
// Usage: node tests/musescore-runtime.js --musescore <path-to-mscore> [--timeout 120]
// On Linux run it under a virtual display: xvfb-run -a node tests/musescore-runtime.js ...
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repo = path.join(__dirname, "..");
const qmlSource = path.join(repo, "smart-piano-fingering.qml");
const fixture = path.join(__dirname, "fixtures", "smoke.musicxml");

// ---------------------------------------------------------------- arguments
function arg(name, def) {
    const i = process.argv.indexOf("--" + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const musescore = arg("musescore", process.env.MUSESCORE_EXE);
const timeoutSec = Number(arg("timeout", "120"));
if (!musescore) {
    console.error("Missing --musescore <path> (or MUSESCORE_EXE).");
    process.exit(2);
}
if (!fs.existsSync(musescore)) {
    console.error("MuseScore executable not found: " + musescore);
    process.exit(2);
}

// MuseScore 4 default user plugin folder is the same on Windows, macOS and Linux.
const pluginsRoot = process.env.SPF_PLUGINS_DIR || path.join(os.homedir(), "Documents", "MuseScore4", "Plugins");
const testDirName = "spf-ci-test";
const testDir = path.join(pluginsRoot, testDirName);
const testQml = path.join(testDir, testDirName + ".qml");
const extensionUri = "musescore://extensions/v1/" + testDirName + "/" + testDirName + ".qml";

// ---------------------------------------------------------------- build the test copy
function buildTestCopy() {
    let src = fs.readFileSync(qmlSource, "utf8").replace(/\r\n/g, "\n");

    const anchor = 'status.text = n === 0 ? qsTr("No open score found.") : qsTr("Staves in score: ") + n;';
    if (src.split(anchor).length !== 2) {
        throw new Error("Cannot patch onRun: anchor line not found exactly once. " +
            "The onRun handler changed; update the anchor in tests/musescore-runtime.js.");
    }
    const hook = anchor +
        "\n        if (n > 0) { applyFingering(); var guard = 0; while (runCtx && guard++ < 100000) { runSlice(); } }";
    src = src.replace(anchor, hook);

    const before = src;
    src = src.replace(/^[ \t]*pluginType:\s*"dialog"[ \t]*$/m, "");
    if (src === before) {
        throw new Error('Cannot find pluginType: "dialog" to remove.');
    }

    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testQml, src, "utf8");
}

// ---------------------------------------------------------------- run MuseScore
function runMuseScore(outFile, withPlugin) {
    const args = ["-o", outFile];
    if (withPlugin) { args.push("--extension", extensionUri); }
    args.push(fixture);
    console.log("  $ " + [musescore].concat(args).map(a => (/\s/.test(a) ? '"' + a + '"' : a)).join(" "));
    const r = spawnSync(musescore, args, {
        encoding: "utf8",
        timeout: timeoutSec * 1000,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
    });
    return {
        status: r.status,
        signal: r.signal,
        timedOut: !!(r.error && r.error.code === "ETIMEDOUT"),
        output: (r.stdout || "") + (r.stderr || ""),
        spawnError: r.error && r.error.code !== "ETIMEDOUT" ? r.error.message : null,
    };
}

function fingerings(file) {
    const xml = fs.readFileSync(file, "utf8");
    const out = [];
    const re = /<fingering\b[^>]*>([^<]*)<\/fingering>/g;
    let m;
    while ((m = re.exec(xml)) !== null) { out.push(m[1].trim()); }
    return out;
}

// NOTE: in console mode MuseScore prints nothing about QML errors, so the reliable signals
// are the exit code (a QML syntax error gave exit 202 in our tests) and the fingerings that
// end up in the exported score (a runtime error while writing gives 0 fingerings).

// ---------------------------------------------------------------- test
let failed = 0;
function check(ok, msg) {
    console.log((ok ? "  ok   " : "  FAIL ") + msg);
    if (!ok) { failed++; }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "spf-runtime-"));
let diag = "";
try {
    console.log("MuseScore runtime test");
    console.log("  plugins folder: " + pluginsRoot);

    // 1. Control run: no plugin. Proves the fixture has no fingering by itself, so a
    //    positive result below can only come from the plugin.
    console.log("Control run (no plugin)");
    const baseOut = path.join(work, "baseline.musicxml");
    const base = runMuseScore(baseOut, false);
    diag += "--- control run ---\n" + base.output;
    check(!base.timedOut && base.status === 0, "MuseScore converts the fixture (exit " + base.status + ")");
    check(fs.existsSync(baseOut), "control output file written");
    if (fs.existsSync(baseOut)) {
        check(fingerings(baseOut).length === 0, "fixture contains no fingering before the plugin runs");
    }

    // 2. Real run with the plugin.
    console.log("Plugin run");
    buildTestCopy();
    const out = path.join(work, "with-plugin.musicxml");
    const run = runMuseScore(out, true);
    diag += "--- plugin run ---\n" + run.output;
    if (run.spawnError) { console.log("  spawn error: " + run.spawnError); }
    check(!run.timedOut, "MuseScore finished within " + timeoutSec + " s");
    check(run.status === 0, "exit code 0 (got " + run.status + (run.signal ? ", signal " + run.signal : "") + ")");
    check(fs.existsSync(out), "output file written");

    if (fs.existsSync(out)) {
        const f = fingerings(out);
        console.log("  fingerings found: [" + f.join(", ") + "]");
        // Fixture: 4 quarter notes in the right hand + 1 whole note in the left hand.
        check(f.length === 5, "5 fingerings written (4 right hand + 1 left hand), got " + f.length);
        check(f.every(x => /^[1-5]$/.test(x)), "every fingering is a digit 1-5");
        if (f.length === 0) {
            console.log("  hint: 0 fingerings usually means MuseScore did not find or run the test plugin.");
            console.log("        Check that '" + testQml + "' exists and that the URI is right:");
            console.log("        " + extensionUri);
        }
    }
} catch (e) {
    failed++;
    console.error("  FAIL unexpected error: " + e.message);
} finally {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    if (failed) {
        const logFile = process.env.SPF_RUNTIME_LOG || path.join(work, "musescore-output.log");
        try { fs.writeFileSync(logFile, diag, "utf8"); console.log("  MuseScore output saved to " + logFile); } catch (e) { /* ignore */ }
        console.log("\n--- last 4000 characters of MuseScore output ---\n" + diag.slice(-4000) + "\n--- end ---");
    }
}

console.log(failed ? "\n" + failed + " check(s) failed" : "\nMuseScore runtime test passed.");
process.exit(failed ? 1 : 0);
