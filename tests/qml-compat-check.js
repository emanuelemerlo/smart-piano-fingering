#!/usr/bin/env node
// Static checks on smart-piano-fingering.qml. They run in a fraction of a second on any OS
// and catch the most common packaging mistakes. They do NOT replace the runtime test
// (tests/musescore-runtime.js), which loads the plugin in a real MuseScore.
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const file = path.join(root, "smart-piano-fingering.qml");
const src = fs.readFileSync(file, "utf8");

let failed = 0;
function check(condition, message) {
    if (condition) {
        console.log("  ok   " + message);
    } else {
        console.error("  FAIL " + message);
        failed++;
    }
}

// Remove comments and string/regex-free noise so that braces inside strings or comments
// do not confuse the structural checks. Template literals are not used in this plugin.
function stripCommentsAndStrings(text) {
    let out = "";
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i], d = text[i + 1];
        if (c === "/" && d === "/") {                    // line comment
            while (i < n && text[i] !== "\n") { i++; }
        } else if (c === "/" && d === "*") {             // block comment
            i += 2;
            while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { i++; }
            i += 2;
        } else if (c === '"' || c === "'") {             // string literal
            const q = c;
            i++;
            while (i < n && text[i] !== q) { i += text[i] === "\\" ? 2 : 1; }
            i++;
            out += '""';
        } else {
            out += c;
            i++;
        }
    }
    return out;
}
const code = stripCommentsAndStrings(src);

console.log("QML compatibility checks");

// ---- required declarations
const required = [
    "import MuseScore 3.0",
    "import QtQuick 2.9",
    "import QtQuick.Controls 2.2",
    "import QtQuick.Layouts 1.3",
    'pluginType: "dialog"',
    "requiresScore: true",
    "function createSmartPianoFingeringCore()",
    "function createMuseScoreAdapter(api)",
    "onRun:",
];
for (const text of required) {
    check(src.includes(text), "contains " + text);
}

// ---- things that must not appear (checked on code only, so comments may mention them)
check(!/\bQt\.quit\s*\(/.test(code), "does not call Qt.quit()");
check(!/import\s+Qt\.WebSockets\b/.test(code), "does not depend on QtWebSockets");
check(!/import\s+QtQuick\.Dialogs\b/.test(src), "does not depend on QtQuick.Dialogs");
check(!/localStorage|XMLHttpRequest/.test(code), "does not use network or browser storage APIs");
check(!/[A-Za-z]:\\/.test(src), "contains no Windows drive path");
check(!/\/Users\/[^/"'\s]+/.test(src), "contains no hard-coded macOS user path");
check(!/\/home\/[^/"'\s]+/.test(src), "contains no hard-coded Linux home path");

// ---- structure
const count = ch => code.split(ch).length - 1;
check(count("{") === count("}"), `balanced braces (${count("{")}/${count("}")})`);
check(count("(") === count(")"), `balanced parentheses (${count("(")}/${count(")")})`);
check(count("[") === count("]"), `balanced brackets (${count("[")}/${count("]")})`);

// ---- files and metadata that must stay consistent
const thumb = (src.match(/thumbnailName:\s*"([^"]+)"/) || [])[1];
check(!!thumb && fs.existsSync(path.join(root, thumb)),
    "thumbnailName points to an existing file" + (thumb ? " (" + thumb + ")" : ""));

const qmlVersion = (src.match(/^\s*version:\s*"([^"]+)"/m) || [])[1];
check(!!qmlVersion, "QML declares a version" + (qmlVersion ? " (" + qmlVersion + ")" : ""));

const citationPath = path.join(root, "CITATION.cff");
if (qmlVersion && fs.existsSync(citationPath)) {
    const cv = (fs.readFileSync(citationPath, "utf8").match(/^version:\s*"?([^"\s]+)"?/m) || [])[1];
    check(cv === qmlVersion, `CITATION.cff version (${cv}) matches the QML version (${qmlVersion})`);
}
const changelogPath = path.join(root, "CHANGELOG.md");
if (qmlVersion && fs.existsSync(changelogPath)) {
    const first = (fs.readFileSync(changelogPath, "utf8").match(/^##\s*\[([^\]]+)\]/m) || [])[1];
    check(first === qmlVersion, `latest CHANGELOG entry (${first}) matches the QML version (${qmlVersion})`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll QML compatibility checks passed.");
process.exit(failed ? 1 : 0);
