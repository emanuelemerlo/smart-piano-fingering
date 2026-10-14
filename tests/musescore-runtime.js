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

// MuseScore 4 looks for user plugins in <Qt DocumentsLocation>/MuseScore4/Plugins.
// On Linux/macOS that is ~/Documents; on Windows it is the "Documents" known folder, which
// can differ from %USERPROFILE%\Documents (e.g. OneDrive redirection). We install the test
// copy in every distinct candidate, so whichever one MuseScore scans will find it.
function documentsCandidates() {
    const list = [];
    if (process.env.SPF_PLUGINS_DIR) { return [process.env.SPF_PLUGINS_DIR]; }
    if (process.platform === "win32") {
        const r = spawnSync("powershell", ["-NoProfile", "-Command",
            "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8" });
        const d = (r.stdout || "").trim();
        if (d) { list.push(path.join(d, "MuseScore4", "Plugins")); }
    }
    list.push(path.join(os.homedir(), "Documents", "MuseScore4", "Plugins"));
    return Array.from(new Set(list.map(x => path.normalize(x))));
}
const pluginsRoots = documentsCandidates();
const testDirName = "spf-ci-test";
const probeDirName = "spf-ci-probe";
const uriFor = name => "musescore://extensions/v1/" + name + "/" + name + ".qml";
const extensionUri = uriFor(testDirName);
const createdDirs = [];

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

    installPlugin(testDirName, src);
}

function installPlugin(name, qmlText) {
    for (const root of pluginsRoots) {
        const dir = path.join(root, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name + ".qml"), qmlText, "utf8");
        createdDirs.push(dir);
    }
}

// Minimal plugin: only proves that MuseScore finds and runs a plugin from the folders above.
const PROBE_TITLE = "SPF_PROBE_OK";
const probeQml = [
    "import QtQuick 2.9", "import MuseScore 3.0", "MuseScore {",
    '    title: "SPF probe"', "    requiresScore: true", "    onRun: {",
    "        curScore.startCmd();",
    '        curScore.setMetaTag("workTitle", "' + PROBE_TITLE + '");',
    "        curScore.endCmd();", "    }", "}", ""].join("\n");

// ---------------------------------------------------------------- run MuseScore
// On Windows the MSI keeps the Qt QML modules in <install>/qml, next to bin/. MuseScore's GUI
// adds that folder to its own QML engine, but the engine that runs plugins in console mode
// did not find QtQuick.Controls / QtQuick.Layouts ("module ... is not installed", exit 202).
// Pointing QML2_IMPORT_PATH at it fixes that. Harmless where the folder does not exist.
function spawnEnv() {
    const env = Object.assign({}, process.env);
    const qmlDir = path.resolve(path.dirname(musescore), "..", "qml");
    if (fs.existsSync(path.join(qmlDir, "QtQuick", "Controls"))) {
        env.QML2_IMPORT_PATH = env.QML2_IMPORT_PATH ? qmlDir + path.delimiter + env.QML2_IMPORT_PATH : qmlDir;
        console.log("  QML2_IMPORT_PATH=" + env.QML2_IMPORT_PATH);
    }
    return env;
}

function runMuseScore(outFile, uri) {
    const args = ["-o", outFile];
    if (uri) { args.push("--extension", uri); }
    args.push(fixture);
    console.log("  $ " + [musescore].concat(args).map(a => (/\s/.test(a) ? '"' + a + '"' : a)).join(" "));
    const r = spawnSync(musescore, args, {
        encoding: "utf8",
        env: spawnEnv(),
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

// MuseScore writes its own log files; in console mode this is the only place where QML
// load errors appear. Returns ERROR lines from logs written since `sinceMs`.
function museScoreLogErrors(sinceMs) {
    const home = os.homedir();
    const dirs = [
        path.join(process.env.LOCALAPPDATA || "", "MuseScore", "MuseScore4", "logs"),
        path.join(home, "Library", "Application Support", "MuseScore", "MuseScore4", "logs"),
        path.join(home, ".local", "share", "MuseScore", "MuseScore4", "logs"),
    ];
    const lines = [];
    for (const d of dirs) {
        let names = [];
        try { names = fs.readdirSync(d).filter(n => n.endsWith(".log")); } catch (e) { continue; }
        for (const n of names) {
            const f = path.join(d, n);
            try {
                if (fs.statSync(f).mtimeMs < sinceMs) { continue; }
                fs.readFileSync(f, "utf8").split(/\r?\n/).forEach(l => {
                    if (/\| ERROR \|/.test(l) && !/plugins\.json|CrashHandler|crash handler/.test(l)) { lines.push(l.slice(0, 500)); }
                });
            } catch (e) { /* ignore */ }
        }
    }
    return Array.from(new Set(lines));
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

// Exit status check. MuseScore 4.7.4 on macOS (arm64) aborts AFTER finishing the conversion
// ("libc++abi: ... mutex lock failed", logged "Goodbye!! code: 0"), also without any plugin.
// That is a MuseScore shutdown crash, not a plugin failure: if the process died from a signal
// but the output file was written, we report a warning instead of a failure.
function exitOk(label, r, outFile) {
    if (!r.timedOut && r.status === 0) { check(true, label + " (exit 0)"); return; }
    if (r.signal && fs.existsSync(outFile)) {
        console.log("  warn " + label + ": MuseScore was killed by " + r.signal +
            " after writing the output (shutdown crash, ignored)");
        return;
    }
    check(false, label + " (exit " + r.status + (r.signal ? ", signal " + r.signal : "") + (r.timedOut ? ", timeout" : "") + ")");
}

// Runs a minimal plugin to tell "MuseScore cannot find/run any plugin" (path or URI problem)
// from "it runs plugins but ours does not work".
function diagnose() {
    console.log("Diagnosis");
    createdDirs.forEach(d => {
        let listing = "missing";
        try { listing = fs.readdirSync(d).join(", "); } catch (e) { /* missing */ }
        console.log("  " + d + " -> " + listing);
    });
    installPlugin(probeDirName, probeQml);
    const out = path.join(work, "probe.musicxml");
    const r = runMuseScore(out, uriFor(probeDirName));
    diag += "--- probe run ---\n" + r.output;
    const ok = fs.existsSync(out) && fs.readFileSync(out, "utf8").includes(PROBE_TITLE);
    console.log("  probe exit code: " + r.status + (r.timedOut ? " (timeout)" : ""));
    console.log(ok
        ? "  => MuseScore finds and runs a trivial plugin here: plugin folder and URI are fine; see the MuseScore errors below."
        : "  => MuseScore did NOT run even a trivial plugin: plugin folder or --extension URI problem on this platform.");
    const errs = museScoreLogErrors(startedAt);
    console.log("  MuseScore log errors (" + errs.length + "):");
    errs.slice(0, 15).forEach(l => console.log("    " + l));
    diag += "--- MuseScore log errors ---\n" + errs.join("\n") + "\n";
}

// ---------------------------------------------------------------- test
let failed = 0;
function check(ok, msg) {
    console.log((ok ? "  ok   " : "  FAIL ") + msg);
    if (!ok) { failed++; }
}

const startedAt = Date.now() - 2000;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "spf-runtime-"));
let diag = "";
try {
    console.log("MuseScore runtime test");
    console.log("  platform: " + process.platform + " " + process.arch + ", node " + process.version);
    console.log("  plugin folder candidates:");
    pluginsRoots.forEach(r => console.log("    " + r + (fs.existsSync(path.dirname(r)) ? "" : "   (parent MuseScore4 folder does not exist yet)")));

    // 1. Control run: no plugin. Proves the fixture has no fingering by itself, so a
    //    positive result below can only come from the plugin.
    console.log("Control run (no plugin)");
    const baseOut = path.join(work, "baseline.musicxml");
    const base = runMuseScore(baseOut, null);
    diag += "--- control run ---\n" + base.output;
    check(fs.existsSync(baseOut), "control output file written");
    exitOk("MuseScore converts the fixture", base, baseOut);
    if (fs.existsSync(baseOut)) {
        check(fingerings(baseOut).length === 0, "fixture contains no fingering before the plugin runs");
    }

    // 2. Real run with the plugin.
    console.log("Plugin run");
    buildTestCopy();
    const out = path.join(work, "with-plugin.musicxml");
    const run = runMuseScore(out, extensionUri);
    diag += "--- plugin run ---\n" + run.output;
    if (run.spawnError) { console.log("  spawn error: " + run.spawnError); }
    check(!run.timedOut, "MuseScore finished within " + timeoutSec + " s");
    check(fs.existsSync(out), "output file written");
    exitOk("MuseScore exit status", run, out);

    if (fs.existsSync(out)) {
        const f = fingerings(out);
        console.log("  fingerings found: [" + f.join(", ") + "]");
        // Fixture: 4 quarter notes in the right hand + 1 whole note in the left hand.
        check(f.length === 5, "5 fingerings written (4 right hand + 1 left hand), got " + f.length);
        check(f.every(x => /^[1-5]$/.test(x)), "every fingering is a digit 1-5");
    }
    if (failed) { diagnose(); }
} catch (e) {
    failed++;
    console.error("  FAIL unexpected error: " + e.message);
} finally {
    createdDirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
    if (failed) {
        const logFile = process.env.SPF_RUNTIME_LOG || path.join(work, "musescore-output.log");
        try { fs.writeFileSync(logFile, diag, "utf8"); console.log("  MuseScore output saved to " + logFile); } catch (e) { /* ignore */ }
        console.log("\n--- last 4000 characters of MuseScore output ---\n" + diag.slice(-4000) + "\n--- end ---");
    }
}

console.log(failed ? "\n" + failed + " check(s) failed" : "\nMuseScore runtime test passed.");
process.exit(failed ? 1 : 0);
