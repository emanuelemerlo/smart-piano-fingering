// Harness that runs the REAL plugin inside a real MuseScore 4, headless.
//
// MuseScore 4 has no "--plugin" option. It does offer
//     mscore -o out.musicxml --extension <uri> score
// which runs an extension/plugin on the score and then exports it. Legacy QML plugins found
// in the user Plugins folder get the URI  musescore://extensions/v1/<folder>/<file>.qml
//
// The production plugin is a dialog that waits for a click on "Apply". For the tests we
// generate a COPY of smart-piano-fingering.qml in which
//   1. pluginType: "dialog" is removed (so MuseScore runs onRun and returns), and
//   2. the dialog language is forced to English (languageOverride), and
//   3. onRun ends with a test hook that sets the dialog controls (hands, size, keep, compact repeated notes, selection),
//      calls the plugin's own applyFingering()/runSlice() synchronously, and stores the dialog's
//      status message in the score's "workNumber" so the tests can read it from the export.
// Everything else (QML tree, embedded core, adapter, MuseScore API calls) is production code.
//
// Not covered: how the dialog looks and clicks on its buttons.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseNotes, readStatus } = require("./musicxml");

const ANCHOR_RUN = 'status.text = n === 0 ? tr("No open score found.") : tr("Staves in score: %1").arg(n);';
// The scenarios read the English status messages, whatever the language of MuseScore.
const ANCHOR_LANGUAGE = 'property string languageOverride: ""';
const ANCHOR_ADAPTER = "division: division, newElement: newElement";

function createHarness(opts) {
    const musescore = opts.musescore;
    const qmlSource = opts.qmlSource;
    const timeoutSec = opts.timeoutSec || 120;
    const log = opts.log || console.log;

    const testName = "spf-ci-test";
    const probeName = "spf-ci-probe";
    const created = [];
    const roots = pluginRoots();
    let diag = "";
    const startedAt = Date.now() - 2000;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spf-runtime-"));

    // MuseScore 4 looks for user plugins in <Qt DocumentsLocation>/MuseScore4/Plugins. On Windows
    // that is the "Documents" known folder (can differ from %USERPROFILE%\Documents, e.g. OneDrive).
    // We install in every distinct candidate, so whichever one MuseScore scans will find it.
    function pluginRoots() {
        if (process.env.SPF_PLUGINS_DIR) { return [process.env.SPF_PLUGINS_DIR]; }
        const list = [];
        if (process.platform === "win32") {
            const r = spawnSync("powershell", ["-NoProfile", "-Command",
                "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8" });
            const d = (r.stdout || "").trim();
            if (d) { list.push(path.join(d, "MuseScore4", "Plugins")); }
        }
        list.push(path.join(os.homedir(), "Documents", "MuseScore4", "Plugins"));
        return Array.from(new Set(list.map(x => path.normalize(x))));
    }

    // On Windows the MSI keeps the Qt QML modules in <install>/qml next to bin/. MuseScore's GUI
    // adds that folder to its own engine, but the engine that runs plugins in console mode did not
    // find QtQuick.Controls / Layouts ("module ... is not installed", exit 202). QML2_IMPORT_PATH
    // fixes that; it is harmless where the folder does not exist.
    function spawnEnv() {
        const env = Object.assign({}, process.env);
        const qmlDir = path.resolve(path.dirname(musescore), "..", "qml");
        if (fs.existsSync(path.join(qmlDir, "QtQuick", "Controls"))) {
            env.QML2_IMPORT_PATH = env.QML2_IMPORT_PATH ? qmlDir + path.delimiter + env.QML2_IMPORT_PATH : qmlDir;
        }
        return env;
    }

    function installPlugin(name, qmlText) {
        for (const root of roots) {
            const dir = path.join(root, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, name + ".qml"), qmlText, "utf8");
            if (created.indexOf(dir) < 0) { created.push(dir); }
        }
    }

    const uriFor = name => "musescore://extensions/v1/" + name + "/" + name + ".qml";

    // ---------------------------------------------------------------- test copy of the plugin
    function buildTestQml(cfg) {
        let src = fs.readFileSync(qmlSource, "utf8").replace(/\r\n/g, "\n");
        if (src.split(ANCHOR_RUN).length !== 2) {
            throw new Error("Cannot patch onRun: anchor line not found exactly once. " +
                "The onRun handler changed; update ANCHOR_RUN in tests/lib/harness.js.");
        }
        if (src.split(ANCHOR_ADAPTER).length !== 2) {
            throw new Error("Cannot patch applyFingering: adapter anchor not found exactly once. " +
                "Update ANCHOR_ADAPTER in tests/lib/harness.js.");
        }
        const hook = ANCHOR_RUN + "\n" +
            "        var cfg = " + JSON.stringify(cfg || {}) + ";\n" +
            "        if (cfg.rh !== undefined) { rhStaff.value = cfg.rh; }\n" +
            "        if (cfg.lh !== undefined) { lhStaff.value = cfg.lh; }\n" +
            "        if (cfg.size !== undefined) { sizeBox.currentIndex = cfg.size; }\n" +
            "        if (cfg.span !== undefined) { spanBox.value = Math.round(cfg.span * 10); }\n" +
            "        if (cfg.child !== undefined) { childHand.checked = cfg.child; }\n" +
            "        if (cfg.keep !== undefined) { keepExisting.checked = cfg.keep; }\n" +
            // compact repeated-note numbering is off unless a scenario asks for it, so the
            // "every note is fingered" checks and the golden files keep their meaning
            "        compactRepeats.checked = cfg.compact === true;\n" +
            "        if (cfg.select) {\n" +
            "            var m = curScore.firstMeasure, i = 1, t0 = -1, t1 = -1;\n" +
            "            while (m) {\n" +
            "                if (i === cfg.select.from) { t0 = m.firstSegment.tick; }\n" +
            "                if (i === cfg.select.to + 1) { t1 = m.firstSegment.tick; }\n" +
            "                m = m.nextMeasure; i++;\n" +
            "            }\n" +
            "            var selOk = curScore.selection.selectRange(t0, t1 < 0 ? curScore.lastSegment.tick + 1 : t1,\n" +
            "                                                       cfg.select.staffFrom, cfg.select.staffTo);\n" +
            "            hasSelection = selectionRange() !== null;\n" +
            "            onlySelection.checked = hasSelection;\n" +
            "            curScore.setMetaTag('movementNumber', 'select=' + selOk + ' from=' + t0 + ' to=' + t1);\n" +
            "        } else { onlySelection.checked = false; }\n" +
            "        if (n > 0) { applyFingering(); var guard = 0; while (runCtx && guard++ < 10000000) { runSlice(); } }\n" +
            "        curScore.setMetaTag('workNumber', status.text);";
        src = src.replace(ANCHOR_RUN, hook);

        // Fault injection: make the Nth fingering creation throw, to test the rollback path.
        const adapterHook = "division: division, newElement: function (t) {\n" +
            "                    if (cfg.failAt && ++spfNewElementCalls >= cfg.failAt) { throw new Error('injected failure'); }\n" +
            "                    return newElement(t);\n" +
            "                }";
        src = src.replace(ANCHOR_ADAPTER, adapterHook);
        src = src.replace("    property var runCtx: null", "    property var runCtx: null\n    property int spfNewElementCalls: 0");
        // cfg is local to onRun; make it visible to applyFingering through a property
        src = src.replace("        var cfg = ", "        cfg = ");
        src = src.replace("    property int spfNewElementCalls: 0", "    property int spfNewElementCalls: 0\n    property var cfg: ({})");

        if (src.split(ANCHOR_LANGUAGE).length !== 2) {
            throw new Error("Cannot force the English UI: languageOverride not found exactly once. " +
                "Update ANCHOR_LANGUAGE in tests/lib/harness.js.");
        }
        src = src.replace(ANCHOR_LANGUAGE, 'property string languageOverride: "en"');

        const before = src;
        src = src.replace(/^[ \t]*pluginType:\s*"dialog"[ \t]*$/m, "");
        if (src === before) { throw new Error('Cannot find pluginType: "dialog" to remove.'); }
        return src;
    }

    // ---------------------------------------------------------------- running MuseScore
    function spawn(outFile, uri, fixture) {
        const args = ["-o", outFile];
        if (uri) { args.push("--extension", uri); }
        args.push(fixture);
        const t0 = Date.now();
        const r = spawnSync(musescore, args, {
            encoding: "utf8", env: spawnEnv(), timeout: timeoutSec * 1000,
            killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024,
        });
        const res = {
            status: r.status, signal: r.signal, ms: Date.now() - t0,
            timedOut: !!(r.error && r.error.code === "ETIMEDOUT"),
            spawnError: r.error && r.error.code !== "ETIMEDOUT" ? r.error.message : null,
            output: (r.stdout || "") + (r.stderr || ""),
            command: [musescore].concat(args).map(a => (/\s/.test(a) ? '"' + a + '"' : a)).join(" "),
        };
        diag += "--- " + res.command + "\n" + res.output + "\n";
        return res;
    }

    // MuseScore 4.7.4 on macOS (arm64) aborts AFTER finishing the conversion ("libc++abi: ...
    // mutex lock failed", logged "Goodbye!! code: 0"), also without any plugin. That is a MuseScore
    // shutdown crash, not a plugin failure: death by signal with the output written is tolerated.
    function exitProblem(res, outFile) {
        if (res.timedOut) { return "timeout after " + timeoutSec + " s"; }
        if (res.spawnError) { return "spawn error: " + res.spawnError; }
        if (res.status === 0) { return null; }
        if (res.signal && fs.existsSync(outFile)) { return null; }
        return "exit " + res.status + (res.signal ? ", signal " + res.signal : "");
    }

    let counter = 0;
    // Runs the plugin (test copy configured with cfg) on a score file.
    // Returns { problem, toleratedCrash, status, notes, xml, ms, file }.
    function runPlugin(fixtureFile, cfg) {
        installPlugin(testName, buildTestQml(cfg));
        const out = path.join(tmp, "out-" + (++counter) + ".musicxml");
        const res = spawn(out, uriFor(testName), fixtureFile);
        const exists = fs.existsSync(out);
        const xml = exists ? fs.readFileSync(out, "utf8") : "";
        return {
            problem: exitProblem(res, out) || (exists ? null : "no output file"),
            toleratedCrash: res.status !== 0 && !!res.signal && exists,
            exit: res, ms: res.ms, file: out, xml: xml,
            status: readStatus(xml), notes: exists ? parseNotes(xml) : [],
        };
    }

    // Converts a score without any plugin (control run).
    function convertOnly(fixtureFile) {
        const out = path.join(tmp, "plain-" + (++counter) + ".musicxml");
        const res = spawn(out, null, fixtureFile);
        const exists = fs.existsSync(out);
        return {
            problem: exitProblem(res, out) || (exists ? null : "no output file"),
            toleratedCrash: res.status !== 0 && !!res.signal && exists,
            notes: exists ? parseNotes(fs.readFileSync(out, "utf8")) : [], ms: res.ms,
        };
    }

    // A trivial plugin: proves MuseScore finds and runs plugins from our folders.
    function probe(fixtureFile) {
        const qml = ["import QtQuick 2.9", "import MuseScore 3.0", "MuseScore {",
            '    title: "SPF probe"', "    requiresScore: true", "    onRun: {",
            "        curScore.startCmd();", '        curScore.setMetaTag("workNumber", "SPF_PROBE_OK");',
            "        curScore.endCmd();", "    }", "}", ""].join("\n");
        installPlugin(probeName, qml);
        const out = path.join(tmp, "probe-" + (++counter) + ".musicxml");
        const res = spawn(out, uriFor(probeName), fixtureFile);
        const ok = fs.existsSync(out) && readStatus(fs.readFileSync(out, "utf8")) === "SPF_PROBE_OK";
        return { ok: ok, exit: res };
    }

    // MuseScore logs QML load errors only to its own log files, not to the console.
    function museScoreLogErrors() {
        const home = os.homedir();
        const dirs = [
            path.join(process.env.LOCALAPPDATA || "", "MuseScore", "MuseScore4", "logs"),
            path.join(home, "Library", "Application Support", "MuseScore", "MuseScore4", "logs"),
            path.join(home, ".local", "share", "MuseScore", "MuseScore4", "logs"),
        ];
        const lines = [];
        for (const d of dirs) {
            let names = [];
            try { names = fs.readdirSync(d).filter(x => x.endsWith(".log")); } catch (e) { continue; }
            for (const name of names) {
                const f = path.join(d, name);
                try {
                    if (fs.statSync(f).mtimeMs < startedAt) { continue; }
                    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach(l => {
                        if (/\| ERROR \|/.test(l) && !/plugins\.json|CrashHandler|crash handler/.test(l)) { lines.push(l.slice(0, 500)); }
                    });
                } catch (e) { /* ignore */ }
            }
        }
        return Array.from(new Set(lines));
    }

    function cleanup() {
        created.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
    }

    return {
        roots: roots, tmp: tmp, uriFor: uriFor, runPlugin: runPlugin, convertOnly: convertOnly,
        probe: probe, museScoreLogErrors: museScoreLogErrors, cleanup: cleanup,
        diagnostics: () => diag, log: log,
        writeFixture: (name, xml) => {
            const f = path.join(tmp, name + ".musicxml");
            fs.writeFileSync(f, xml, "utf8");
            return f;
        },
    };
}

module.exports = { createHarness };
