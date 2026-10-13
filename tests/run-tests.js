#!/usr/bin/env node
// Tests for the embedded JavaScript of smart-piano-fingering.qml.
// The core and the adapter are extracted from the QML file and run against a mock score.
// These tests do NOT exercise MuseScore's QML runtime.
"use strict";
const fs = require("fs");
const path = require("path");

const qmlPath = path.join(__dirname, "..", "smart-piano-fingering.qml");
const src = fs.readFileSync(qmlPath, "utf8");
const start = src.indexOf("    function createSmartPianoFingeringCore()");
const end = src.lastIndexOf("}");
if (start < 0) { console.error("Cannot find createSmartPianoFingeringCore in the QML file"); process.exit(1); }
const mod = {};
new Function("m", src.slice(start, end) +
    ";m.Core=createSmartPianoFingeringCore;m.Adapter=createMuseScoreAdapter;")(mod);

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log("  ok   " + name); }
    catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
function eq(a, b, msg) {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) { throw new Error((msg || "values differ") + ": got " + x + ", expected " + y); }
}
function ok(c, msg) { if (!c) { throw new Error(msg || "assertion failed"); } }

// ------------------------------------------------------------------ mock MuseScore objects
const E = { CHORD: 1, REST: 2, FINGERING: 3 };
function note(p) {
    return { pitch: p, tieBack: null, tieForward: null, els: [],
        get elements() { return this.els; },
        remove(e) { this.els = this.els.filter(x => x !== e); },
        add(e) { this.els.push(e); } };
}
function fing(text) { return { type: E.FINGERING, text: text }; }
function chord(notes, ticks, o) {
    o = o || {};
    const c = { type: E.CHORD, notes: notes, duration: { ticks: ticks }, tuplet: o.tuplet || null, staffMove: o.staffMove || 0 };
    notes.forEach(n => { n.parent = c; });
    return c;
}
function mkScore(staves) {   // staves[staff][voice] = [{ tick, el }]
    return {
        nstaves: staves.length,
        staves: staves.map(() => ({ part: { startTrack: 0 } })),
        newCursor() {
            return { staffIdx: 0, voice: 0, i: 0, list: [],
                rewind() { this.list = (staves[this.staffIdx] || [])[this.voice] || []; this.i = 0; },
                get segment() { return this.i < this.list.length ? {} : null; },
                get element() { return this.list[this.i].el; },
                get tick() { return this.list[this.i].tick; },
                next() { this.i++; return this.i < this.list.length; } };
        }
    };
}
const api = score => ({ score: score, Element: E, Cursor: { SCORE_START: 0 }, division: 480, newElement: () => ({ text: "" }) });
const clone = o => JSON.parse(JSON.stringify(o));

function scale(pitches, dur) {
    return pitches.map((p, i) => ({ id: i, pitch: p, start: i * dur, end: (i + 1) * dur, anchor: 0, voice: 0 }));
}

console.log("Core");
const core = mod.Core();

test("unison in two voices becomes one note, primary = lowest voice (any input order)", () => {
    const items = [
        { id: 0, pitch: 64, start: 1, end: 3, anchor: 0, voice: 1 },
        { id: 1, pitch: 64, start: 1, end: 1.5, anchor: 0, voice: 0 }
    ];
    const seq = core.buildSequence(items, 0.05);
    eq(seq.length, 1);
    eq(seq[0].id, 1, "primary note id (voice 0)");
    eq(seq[0].dups, [0]);
    eq(seq[0].end, 3, "sounding end is the longest");
});

test("simultaneous different pitches become an ordered chord group", () => {
    const seq = core.buildSequence([
        { id: 0, pitch: 67, start: 0, end: 1, anchor: 0, voice: 0 },
        { id: 1, pitch: 60, start: 0, end: 1, anchor: 0, voice: 1 }], 0.05);
    eq(seq.map(n => n.pitch), [60, 67]);
    ok(seq[0].isChord && seq[1].isChord && seq[0].chordID === seq[1].chordID);
});

test("generate() and the incremental generator give identical results; x is restored", () => {
    const items = scale([60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60], 0.5);
    for (const side of ["right", "left"]) {
        const a = core.buildSequence(clone(items), 0.05), b = core.buildSequence(clone(items), 0.05);
        const x0 = b.map(n => n.x);
        core.generate(a, side, "M");
        const g = core.createGenerator(b, side, "M");
        let steps = 0; while (g.step()) { steps++; }
        eq(a.map(n => n.finger), b.map(n => n.finger), side + " hand");
        eq(b.map(n => n.x), x0, "x restored");
        ok(a.every(n => n.finger >= 1 && n.finger <= 5), "fingers in 1..5");
        eq(steps + 1, a.length, "one step per note");
    }
});

test("results are deterministic", () => {
    const items = scale([60, 64, 67, 72, 67, 64, 60, 59, 62, 65, 69, 65, 62, 59], 0.5);
    const run = () => { const s = core.buildSequence(clone(items), 0.05); core.generate(s, "right", "M"); return s.map(n => n.finger); };
    eq(run(), run());
});

test("right-hand chord fingers ascend with pitch; left-hand descend", () => {
    const items = [60, 64, 67].map((p, i) => ({ id: i, pitch: p, start: 0, end: 1, anchor: 0, voice: 0 }));
    const r = core.buildSequence(clone(items), 0.05); core.generate(r, "right", "M");
    const l = core.buildSequence(clone(items), 0.05); core.generate(l, "left", "M");
    const rf = r.map(n => n.finger), lf = l.map(n => n.finger);
    ok(rf[0] < rf[1] && rf[1] < rf[2], "RH " + rf);
    ok(lf[0] > lf[1] && lf[1] > lf[2], "LH " + lf);
});

test("existing fingerings (anchors) are respected", () => {
    const items = scale([60, 62, 64, 65, 67], 0.5);
    items[2].anchor = 5;
    const s = core.buildSequence(items, 0.05); core.generate(s, "right", "M");
    eq(s[2].finger, 5);
});

console.log("Adapter: reading");
test("tuplet durations are correct whether duration.ticks is actual or nominal", () => {
    const trip = { actualNotes: 3, normalNotes: 2 };
    for (const d of [160, 240]) {
        const els = [0, 160, 320].map((tk, i) => ({ tick: tk, el: chord([note(60 + i)], d, { tuplet: trip }) }))
            .concat([{ tick: 480, el: chord([note(70)], 480) }]);
        const r = mod.Adapter(api(mkScore([[els]]))).readStaves([0], false, null)[0];
        eq(r.items.map(i => +(i.end - i.start).toFixed(4)), [0.3333, 0.3333, 0.3333, 1], "ticks=" + d);
    }
});

test("tied continuations are merged into the first note", () => {
    const a = note(60), b = note(60);
    a.tieForward = { endNote: b }; b.tieBack = {};
    const els = [{ tick: 0, el: chord([a], 480) }, { tick: 480, el: chord([b], 480) }];
    const r = mod.Adapter(api(mkScore([[els]]))).readStaves([0], false, null)[0];
    eq(r.items.length, 1);
    eq(r.items[0].end - r.items[0].start, 2);
});

test("cross-staff chord is assigned to the displaying staff", () => {
    const s0 = [[{ tick: 0, el: chord([note(72)], 480, { staffMove: 1 }) }, { tick: 480, el: chord([note(74)], 480) }]];
    const s1 = [[{ tick: 0, el: chord([note(60)], 480) }]];
    const r = mod.Adapter(api(mkScore([s0, s1]))).readStaves([0, 1], false, null);
    eq(r[0].items.map(i => i.pitch), [74]);
    eq(r[1].items.map(i => i.pitch).sort(), [60, 72]);
});

test("window limits what is read", () => {
    const list = []; for (let i = 0; i < 100; i++) { list.push({ tick: i * 480, el: chord([note(60 + i % 12)], 480) }); }
    const r = mod.Adapter(api(mkScore([[list]]))).readStaves([0], false, { from: 28 * 480, to: 56 * 480 })[0];
    eq(r.items.length, 28);
});

test("voice index and plain-number anchors are recorded", () => {
    const n = note(60); n.els.push(fing("3"));
    const r = mod.Adapter(api(mkScore([[[], [{ tick: 0, el: chord([n], 480) }]]]))).readStaves([0], true, null)[0];
    eq(r.items[0].voice, 1);
    eq(r.items[0].anchor, 3);
});

console.log("Adapter: writing");
const adapter = mod.Adapter(api(mkScore([[]])));

test("unison group gets ONE fingering, on the primary note", () => {
    const a = note(60), b = note(60);
    const r = adapter.writeFingerings([{ id: 0, dups: [1], finger: 3 }], [{ note: a, tick: 0 }, { note: b, tick: 0 }], true, null);
    eq(r, { written: 1, skipped: 0 });
    eq(a.els.length, 1); eq(b.els.length, 0);
});

test("keep: any fingering inside the unison group blocks writing", () => {
    const a = note(60), b = note(60); b.els.push(fing("2"));
    const r = adapter.writeFingerings([{ id: 0, dups: [1], finger: 3 }], [{ note: a, tick: 0 }, { note: b, tick: 0 }], true, null);
    eq(r.written, 0); eq(a.els.length, 0); eq(b.els.length, 1);
});

test("replace: numeric replaced (also on secondary voice), custom text left alone", () => {
    const a = note(60), b = note(60), c = note(62);
    a.els.push(fing("2")); b.els.push(fing("5")); c.els.push(fing("1-2"));
    const refs = [{ note: a, tick: 0 }, { note: b, tick: 0 }, { note: c, tick: 480 }];
    const r = adapter.writeFingerings([{ id: 0, dups: [1], finger: 3 }, { id: 2, dups: [], finger: 4 }], refs, false, null);
    eq(r, { written: 1, skipped: 1 });
    eq(a.els.map(e => e.text), ["3"]); eq(b.els.length, 0); eq(c.els.map(e => e.text), ["1-2"]);
});

test("range excludes notes outside it", () => {
    const a = note(60), b = note(62);
    const r = adapter.writeFingerings([{ id: 0, dups: [], finger: 1 }, { id: 1, dups: [], finger: 2 }],
        [{ note: a, tick: 0 }, { note: b, tick: 960 }], true, { from: 480, to: 1440 });
    eq(r.written, 1); eq(a.els.length, 0); eq(b.els.length, 1);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
