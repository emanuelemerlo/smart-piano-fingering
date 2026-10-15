// Shared helpers for the tests of smart-piano-fingering.qml.
// Everything here is independent of the plugin's own knowledge: reference fingerings are written
// out separately (tests/musical-suite.js) and the physical checker below does not reuse the
// plugin's constraint code, so a test cannot pass just because the plugin agrees with itself.
"use strict";
const fs = require("fs");
const path = require("path");

const QML = path.join(__dirname, "..", "smart-piano-fingering.qml");

function loadQml() {
    const src = fs.readFileSync(QML, "utf8");
    const start = src.indexOf("    function createSmartPianoFingeringCore()");
    const end = src.lastIndexOf("}");
    if (start < 0) { throw new Error("Cannot find createSmartPianoFingeringCore in the QML file"); }
    const mod = {};
    new Function("m", src.slice(start, end) +
        ";m.Core=createSmartPianoFingeringCore;m.Adapter=createMuseScoreAdapter;")(mod);
    mod.source = src.slice(start, end);
    return mod;
}

function loadLegacy() { return require("./legacy/core-1.1.0.js")(); }

// ------------------------------------------------------------------ notes
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// "C4" = 60, "F#3", "Bb5", "E#4" (= F4)
function midi(name) {
    const m = /^([A-G])([#b]*)(-?\d)$/.exec(name);
    if (!m) { throw new Error("bad note " + name); }
    let v = NAMES[m[1]] + 12 * (Number(m[3]) + 1);
    for (const ch of m[2]) { v += ch === "#" ? 1 : -1; }
    return v;
}
function isBlack(p) { return [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12); }

// items for one staff. notes: array of pitches (numbers or names) or arrays of pitches (chords).
// dur: number or array of durations (beats).
function line(notes, dur, opts) {
    opts = opts || {};
    const items = [];
    let t = opts.start || 0, id = 0;
    notes.forEach((n, i) => {
        const d = Array.isArray(dur) ? dur[i % dur.length] : dur;
        const group = Array.isArray(n) ? n : [n];
        group.forEach(p => {
            items.push({ id: id++, pitch: typeof p === "string" ? midi(p) : p, start: t,
                         end: t + d * (opts.legato === false ? 0.5 : 1), anchor: 0, voice: 0 });
        });
        t += d;
    });
    return items;
}

// pitches of a scale: tonic midi, interval steps, octaves, ascending
function scalePitches(tonic, steps, octaves) {
    const r = [];
    for (let o = 0; o < octaves; o++) { for (const s of steps) { r.push(tonic + 12 * o + s); } }
    r.push(tonic + 12 * octaves);
    return r;
}

// Runs a core (new or legacy) on items. Returns fingers in item order (by id) + extra info.
function run(core, items, side, size, opts) {
    const copy = JSON.parse(JSON.stringify(items));
    const seq = core.buildSequence(copy, 0.05);
    core.generate(seq, side, size || "M", null, opts);
    const byId = {};
    seq.forEach(n => { byId[n.id] = n.finger; (n.dups || []).forEach(d => { byId[d] = n.finger; }); });
    return { fingers: items.map(it => byId[it.id]), seq: seq, warnings: seq.warnings || [], analysis: seq.analysis || null };
}

// ------------------------------------------------------------------ independent physical checker
// Generous physical limits (semitones, M hand) for two fingers on simultaneous keys. Beyond them a
// chord cannot be held by an average adult hand; scaled linearly with the hand-size preset.
const SIZE = { XXS: 0.33, XS: 0.46, S: 0.64, M: 0.82, L: 1.0, XL: 1.1, XXL: 1.2 };
const MAXSPAN = { "1,2": 9, "1,3": 10, "1,4": 12, "1,5": 13, "2,3": 5, "2,4": 7, "2,5": 9, "3,4": 4, "3,5": 6, "4,5": 4 };

function physicalCheck(items, fingers, side, size) {
    const scale = (SIZE[size || "M"] || 0.82) / 0.82;
    const impossible = [], nonstandard = [];
    const notes = items.map((it, i) => ({ p: it.pitch, s: it.start, e: it.end, f: fingers[i], i: i }));
    notes.forEach(n => { if (!(n.f >= 1 && n.f <= 5)) { impossible.push("note " + n.i + " has no finger"); } });
    // simultaneous groups (unique pitches)
    const groups = {};
    notes.forEach(n => { const k = n.s.toFixed(6); (groups[k] = groups[k] || []).push(n); });
    Object.keys(groups).forEach(k => {
        const g = groups[k].filter((n, i, a) => a.findIndex(x => x.p === n.p) === i).sort((a, b) => a.p - b.p);
        for (let a = 0; a < g.length; a++) {
            for (let b = a + 1; b < g.length; b++) {
                if (g[a].f === g[b].f) { impossible.push("chord at " + k + ": finger " + g[a].f + " twice"); continue; }
                const ordered = side === "right" ? g[a].f < g[b].f : g[a].f > g[b].f;
                if (!ordered) { impossible.push("chord at " + k + ": fingers crossed " + g[a].f + "/" + g[b].f); }
                const key = Math.min(g[a].f, g[b].f) + "," + Math.max(g[a].f, g[b].f);
                if (g[b].p - g[a].p > MAXSPAN[key] * scale + 1e-9) {
                    impossible.push("chord at " + k + ": span " + (g[b].p - g[a].p) + " too wide for " + key);
                }
            }
        }
    });
    // a finger holding a key cannot play another key
    for (const a of notes) {
        for (const b of notes) {
            if (b.s > a.s + 1e-9 && b.s < a.e - 1e-9 && a.p !== b.p && a.f === b.f) {
                impossible.push("finger " + a.f + " holds " + a.p + " while playing " + b.p);
            }
        }
    }
    // successions (onset order, single notes only): legato technique
    const order = Object.keys(groups).map(Number).sort((x, y) => x - y);
    for (let k = 1; k < order.length; k++) {
        const A = groups[order[k - 1].toFixed(6)], B = groups[order[k].toFixed(6)];
        if (A.length !== 1 || B.length !== 1) { continue; }
        const a = A[0], b = B[0], d = b.p - a.p;
        if (d === 0) { continue; }
        if (a.f === b.f && Math.abs(d) <= 12 && b.s - a.s < 1) { nonstandard.push("same finger " + a.f + " on " + a.p + "->" + b.p); }
        const up = side === "right" ? d > 0 : d < 0;
        if (a.f > 1 && b.f > 1 && Math.abs(d) <= 12 && (up ? b.f < a.f : b.f > a.f)) {
            nonstandard.push("crossing " + a.f + "->" + b.f + " on " + a.p + "->" + b.p);
        }
    }
    return { impossible, nonstandard };
}

// "VALID (no reference)": the case states no reference fingering, only a check (e.g. "no thumb
// on black keys"); the fingering is physically valid and is judged by that check alone.
const RANK = { "PHYSICALLY IMPOSSIBLE": 0, "NON-STANDARD": 1, "VALID (no reference)": 2, "ACCEPTABLE VARIANT": 2, "CANONICAL": 3 };

// expected: canonical array; variants: arrays; perNote: array of allowed-finger arrays.
function classify(actual, phys, expected, variants, perNote) {
    if (phys.impossible.length) { return "PHYSICALLY IMPOSSIBLE"; }
    const s = actual.join(",");
    if (expected && s === expected.join(",")) { return "CANONICAL"; }
    if (variants && variants.some(v => v.join(",") === s)) { return "ACCEPTABLE VARIANT"; }
    if (perNote && actual.every((f, i) => perNote[i].includes(f))) { return "ACCEPTABLE VARIANT"; }
    if (!expected && !variants && !perNote) { return "VALID (no reference)"; }
    return "NON-STANDARD";
}

module.exports = { loadQml, loadLegacy, midi, isBlack, line, scalePitches, run, physicalCheck, classify, RANK, SIZE };
