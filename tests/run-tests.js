#!/usr/bin/env node
// Tests for the embedded JavaScript of smart-piano-fingering.qml.
// The core and the adapter are extracted from the QML file and run against a mock score.
// These tests do NOT exercise MuseScore's QML runtime.
//
//   node tests/run-tests.js            run everything
//   node tests/run-tests.js --report   also write tests/REPORT.md (table of the musical suite)
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./lib.js");
const suite = require("./musical-suite.js");
const runner = require("./suite-runner.js");

const mod = lib.loadQml();
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


// ================================================================== algorithm version 2
console.log("Core: syntax");
test("core is ES5 (QML JavaScript engine): no let/const/arrow functions/template literals/classes", () => {
    const code = mod.source.replace(/\/\/[^\n]*/g, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const bad = [/\blet\s/, /\bconst\s/, /=>/, /`/, /\bclass\s/].filter(r => r.test(code));
    eq(bad.map(String), []);
});

console.log("Core: canonical knowledge");
const K = core.knowledge;
const D = suite.digits;
for (const form of ["major", "harmonic"]) {
    for (const side of ["right", "left"]) {
        test(form + " tables " + side + " hand: 12 keys, ascending and descending", () => {
            const ref = form === "major" ? (side === "right" ? suite.REF_MAJOR_RH : suite.REF_MAJOR_LH)
                                         : (side === "right" ? suite.REF_HARM_RH : suite.REF_HARM_LH);
            const names = form === "major" ? suite.TONICS : suite.MINOR_NAMES;
            names.forEach((nm, pc) => {
                eq(K.scaleTable(pc, form, side, "up"), D(ref[nm]), nm + " up");
                eq(K.scaleTable(pc, form, side, "down"), D(ref[nm]).reverse(), nm + " down");
            });
        });
    }
}
test("melodic minor: thumb kept off the raised 6th (f#, c# RH), natural form descending", () => {
    eq(K.scaleTable(6, "melodic", "right", "up"), D("23123412"));
    eq(K.scaleTable(1, "melodic", "right", "up"), D("23123412"));
    eq(K.scaleTable(6, "natural", "right", "down"), D("32132143"));
    eq(K.scaleFingering(9, "melodic", "right").source, "derived");
});
test("no canonical or derived scale puts the thumb on a black key", () => {
    for (const form of ["major", "harmonic", "melodic", "natural"]) {
        for (let t = 0; t < 12; t++) {
            for (const side of ["right", "left"]) {
                const cyc = K.scaleFingering(t, form, side).cyc;
                [1, 3, 6, 8, 10].forEach(pc => ok(cyc[pc] !== 1, form + " " + t + " " + side + " thumb on pc " + pc));
            }
        }
    }
});
test("chromatic and arpeggio rules", () => {
    eq([0, 1, 2, 3, 4, 5].map(pc => K.chromaticFinger(pc, "right")), [2, 3, 1, 3, 1, 2]);
    eq([0, 1, 2, 3, 4, 5].map(pc => K.chromaticFinger(pc, "left")), [1, 3, 1, 3, 2, 1]);
    const c = K.arpeggioFingering([0, 4, 7], 0, "right").cyc;
    eq([c[0], c[4], c[7]], [1, 2, 3]);
    const l = K.arpeggioFingering([0, 4, 7], 0, "left").cyc;
    eq([l[0], l[4], l[7]], [1, 4, 2]);
    eq(K.chordShape([60, 64, 67], "right").fingers, [1, 3, 5]);
    eq(K.chordShape([64, 67, 72], "right").fingers, [1, 2, 5]);
    eq(K.chordShape([55, 60, 64], "left").fingers, [5, 2, 1]);
});
test("rule generator reproduces most canonical tables (informative; the tables are what is used)", () => {
    let same = 0, total = 0;
    for (const form of ["major", "harmonic"]) {
        for (let t = 0; t < 12; t++) {
            for (const side of ["right", "left"]) {
                const g = K.generateCyclic(t, K.forms[form], side, [3, 4]);
                const c = K.scaleFingering(t, form, side).cyc;
                total++; if (g.join() === c.join()) { same++; }
            }
        }
    }
    console.log("       generator reproduces " + same + "/" + total + " canonical tables");
    ok(same >= 30, "only " + same);
});

console.log("Core: musical reference suite");
const results = runner.runSuite(core);
const groups = {};
results.forEach(r => { (groups[r.case.group] = groups[r.case.group] || []).push(r); });
Object.keys(groups).forEach(g => {
    const rs = groups[g];
    const bad = rs.filter(r => !r.pass);
    test(g + " (" + rs.length + " cases)", () => {
        if (bad.length) {
            throw new Error(bad.length + " failed:\n       " + bad.map(r => r.case.name + ": got " + r.fingers.join("") +
                (r.case.expected ? " expected " + r.case.expected.join("") : "") + " [" + r.cls + "] " + r.reason).join("\n       "));
        }
    });
});

console.log("Core: invariants");
// Random but musically shaped material: lines, chords, two voices, held notes, all hand sizes.
function rng(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
function randomPiece(seed, n) {
    const r = rng(seed), items = [];
    let t = 0, p = 64, id = 0;
    while (items.length < n) {
        const kind = r();
        const dur = [0.25, 0.5, 0.5, 1, 0.125][Math.floor(r() * 5)];
        if (kind < 0.15) {
            const root = 55 + Math.floor(r() * 12), shape = [[0, 4, 7], [0, 3, 8], [0, 5, 9], [0, 4, 7, 12], [0, 3, 7]][Math.floor(r() * 5)];
            shape.forEach(iv => items.push({ id: id++, pitch: root + iv, start: t, end: t + dur, anchor: 0, voice: 0 }));
        } else if (kind < 0.22) {
            items.push({ id: id++, pitch: p - 7, start: t, end: t + 2, anchor: 0, voice: 1 });
            items.push({ id: id++, pitch: p, start: t, end: t + dur, anchor: 0, voice: 0 });
        } else {
            p += [-2, -1, 1, 2, 2, -2, 3, -3, 0, 5, -5, 12, -12][Math.floor(r() * 13)];
            p = Math.max(48, Math.min(84, p));
            items.push({ id: id++, pitch: p, start: t, end: t + dur, anchor: r() < 0.03 ? 1 + Math.floor(r() * 5) : 0, voice: 0 });
        }
        t += dur;
    }
    return items;
}
test("hard constraints hold on 30 random pieces (all sizes, both hands) unless a warning says otherwise", () => {
    const sizes = ["child58", "child912", "small", "woman", "man", "large", { span: 21, child: true }];
    for (let k = 0; k < 30; k++) {
        const side = k % 2 ? "left" : "right", size = sizes[k % sizes.length];
        const items = randomPiece(k + 1, 150);
        const seq = core.buildSequence(JSON.parse(JSON.stringify(items)), 0.05);
        core.generate(seq, side, size);
        ok(seq.every(n => n.finger >= 1 && n.finger <= 5), "finger range");
        const h = core.internals.makeHand(side, size);
        if (side === "left") { seq.forEach(n => { n.x = -n.x; }); }
        const warned = {}; seq.warnings.forEach(w => { warned[w.index] = true; });
        for (let i = 1; i < seq.length; i++) {
            if (warned[i] || seq[i].anchor || seq[i - 1].anchor) { continue; }
            const bad = core.internals.skip(h, seq[i - 1].finger, seq[i].finger, seq[i - 1], seq[i], false);
            ok(!bad, "piece " + k + " note " + i + ": transition " + seq[i - 1].finger + "->" + seq[i].finger + " violates a hard rule");
        }
        if (side === "left") { seq.forEach(n => { n.x = -n.x; }); }
        // chords: distinct, ordered fingers (also with warnings)
        const chords = {};
        seq.filter(n => n.isChord).forEach(n => { (chords[n.chordID] = chords[n.chordID] || []).push(n); });
        Object.keys(chords).forEach(c => {
            const f = chords[c].map(n => n.finger);
            for (let i = 1; i < f.length; i++) {
                ok(side === "right" ? f[i] > f[i - 1] : f[i] < f[i - 1], "piece " + k + " chord " + c + " fingers " + f);
            }
        });
    }
});
test("generator and generate() agree on random material; anchors are never changed", () => {
    for (let k = 0; k < 6; k++) {
        const items = randomPiece(100 + k, 120);
        const a = core.buildSequence(JSON.parse(JSON.stringify(items)), 0.05);
        const b = core.buildSequence(JSON.parse(JSON.stringify(items)), 0.05);
        core.generate(a, "right", "M");
        const g = core.createGenerator(b, "right", "M"); while (g.step()) { /* run */ }
        eq(a.map(n => n.finger), b.map(n => n.finger));
        a.forEach(n => { if (n.anchor) { eq(n.finger, n.anchor, "anchor"); } });
    }
});
test("performance: 4000 notes (chords, two voices) in reasonable time", () => {
    const items = randomPiece(7, 4000);
    const t0 = Date.now();
    const seq = core.buildSequence(items, 0.05);
    core.generate(seq, "right", "M");
    const ms = Date.now() - t0;
    console.log("       " + seq.length + " notes in " + ms + " ms (Node; the QML engine is slower)");
    ok(ms < 20000, ms + " ms");
});
test("staccato lets the same finger play two keys; legato does not", () => {
    const h = core.internals.makeHand("right", "M");
    const na = { pitch: 60, x: core.keyPosition(60), isChord: false, duration: 0.5, staccato: false };
    const nb = { pitch: 64, x: core.keyPosition(64), isChord: false, duration: 0.5 };
    ok(core.internals.skip(h, 1, 1, na, nb, false), "legato 1-1 allowed");
    na.staccato = true;
    ok(!core.internals.skip(h, 1, 1, na, nb, false), "staccato 1-1 forbidden");
});
test("custom parameters are honoured (configurable coefficients)", () => {
    const items = lib.line([60, 60, 60, 60, 60, 60], 0.25);
    const normal = lib.run(core, items, "right", "M").fingers;
    const noAlt = lib.run(core, items, "right", "M", { params: { repSame: 0, repChange: 50 } }).fingers;
    ok(new Set(normal).size > 1, "default alternates");
    eq(new Set(noAlt).size, 1, "repSame=0 keeps one finger");
});

test("an existing fingering that contradicts a recognised pattern makes the neighbours follow it", () => {
    const up = [60, 62, 64, 65, 67, 69, 71, 72];
    const items = lib.line(up, 0.25);
    const plain = lib.run(core, items, "right", "M").fingers;
    items[2].anchor = 5;
    const anchored = lib.run(core, items, "right", "M");
    eq(anchored.fingers[2], 5, "anchor kept");
    ok(anchored.fingers[0] !== plain[0] || anchored.fingers[1] !== plain[1], "notes before the anchor follow it: " + anchored.fingers.join(""));
    ok(anchored.analysis.patterns.some(p => /overridden/.test(p.strength)), "pattern marked as overridden");
    items[2].anchor = 3;   // agrees with the scale: nothing changes
    eq(lib.run(core, items, "right", "M").fingers, plain);
});

console.log("Adapter: v2 fields");
test("key signature and staccato are read when the API provides them", () => {
    const n = note(60);
    const c = chord([n], 480);
    c.articulations = [{ symbol: "articStaccatoAbove" }];
    const score = mkScore([[[{ tick: 0, el: c }]]]);
    const orig = score.newCursor;
    score.newCursor = function () { const cur = orig.call(this); cur.keySignature = -2; return cur; };
    const r = mod.Adapter(api(score)).readStaves([0], false, null)[0];
    eq(r.items[0].keySig, -2);
    eq(r.items[0].staccato, true);
});
test("missing key signature / articulations are tolerated", () => {
    const r = mod.Adapter(api(mkScore([[[{ tick: 0, el: chord([note(60)], 480) }]]]))).readStaves([0], false, null)[0];
    eq(r.items[0].keySig, null);
    eq(r.items[0].staccato, false);
});

console.log("Core: repeated-note pedal");
// Left hand of Tchaikovsky, Morning Prayer op. 39 no. 1, bars 16-21 (simplified): a G2 pedal in
// quavers (voice 1) under a voice that holds or moves (voice 0). Before 2.0.2 the pedal got
// 5-4-3-4-4-5 / 5-5-4-3-4-5 / 5-5-5-5-5-5 / 5-4-2-4-4-4 in successive bars.
function pedalBars() {
    const items = [];
    let id = 0;
    const upper = [[50, 0, 1], [50, 2, 3], [51, 3, 5], [50, 6, 7], [50, 8, 9], [51, 9, 11],
                   [50, 12, 13], [48, 13, 14], [47, 14, 15], [46, 15, 17], [45, 17, 18]];
    upper.forEach(u => items.push({ id: id++, pitch: u[0], start: u[1], end: u[2], anchor: 0, voice: 0 }));
    for (let t = 0; t < 18; t += 0.5) { items.push({ id: id++, pitch: 43, start: t, end: t + 0.5, anchor: 0, voice: 1 }); }
    return items;
}
test("a repeated bass pedal under another voice keeps one finger (5), even through chords", () => {
    const seq = core.buildSequence(pedalBars(), 0.05);
    core.generate(seq, "left", "M");
    const g = seq.filter(n => n.pitch === 43);
    eq(g.length, 36);
    eq(g.map(n => n.finger).join(""), "5".repeat(36));
    eq(g.filter(n => n.showFinger !== false).length, 1);
    eq(g[0].showFinger, true);
});
test("the pedal finger is kept on every hand size", () => {
    ["child58", "child912", "small", "woman", "man", "large"].forEach(size => {
        const seq = core.buildSequence(pedalBars(), 0.05);
        core.generate(seq, "left", size);
        const fs = new Set(seq.filter(n => n.pitch === 43).map(n => n.finger));
        if (fs.size !== 1) { throw new Error(size + ": pedal fingers " + Array.from(fs).join(",")); }
    });
});
test("a fast repetition on its own still changes fingers (not a pedal)", () => {
    const seq = core.buildSequence(lib.line(Array(8).fill(60), 0.25), 0.05);
    core.generate(seq, "right", "M");
    if (new Set(seq.map(n => n.finger)).size < 2) { throw new Error("same finger: " + seq.map(n => n.finger).join("")); }
    eq(seq.some(n => n.repKeep), false);
});
test("compact writing: repeated key with the same finger gets one number; off writes all; selection restarts it", () => {
    const mkSeq = () => [{ id: 0, dups: [], finger: 5, repPrev: -1, showFinger: true },
                         { id: 1, dups: [], finger: 5, repPrev: 0, showFinger: false },
                         { id: 2, dups: [], finger: 4, repPrev: 1, showFinger: true }];
    const mkRefs = () => [{ note: note(43), tick: 0 }, { note: note(43), tick: 240 }, { note: note(43), tick: 480 }];
    let refs = mkRefs();
    let r = adapter.writeFingerings(mkSeq(), refs, false, null, { compact: true });
    eq(r.written, 2); eq(refs[1].note.els.length, 0); eq(refs[2].note.els.map(e => e.text), ["4"]);
    refs = mkRefs();
    r = adapter.writeFingerings(mkSeq(), refs, false, null);
    eq(r.written, 3);
    refs = mkRefs();
    r = adapter.writeFingerings(mkSeq(), refs, false, { from: 240, to: 960 }, { compact: true });
    eq(r.written, 2); eq(refs[1].note.els.map(e => e.text), ["5"]);
    refs = mkRefs(); refs[1].note.els.push(fing("3"));
    adapter.writeFingerings(mkSeq(), refs, false, null, { compact: true });
    eq(refs[1].note.els.length, 0);  // an old number on a hidden stroke is removed, not left stale
});

console.log("Core: hand model (profiles, two spans, mobility)");
const fingersOf = (items, side, size) => lib.run(core, items, side, size).fingers.join("");
const warningsOf = (items, side, size) => lib.run(core, items, side, size).warnings.length;
test("legacy presets map to the profiles; 'woman' is the former M, M is still accepted", () => {
    const map = { XXS: "child58", XS: "child58", S: "child912", M: "woman", L: "man", XL: "large", XXL: "large" };
    for (let k = 0; k < 6; k++) {
        const items = randomPiece(100 + k, 80), side = k % 2 ? "left" : "right";
        Object.keys(map).forEach(old => eq(fingersOf(items, side, old), fingersOf(items, side, map[old]), old + " vs " + map[old]));
    }
    eq(core.resolveHand("M").span, 20);
    eq(core.resolveHand("nonsense").id, "woman");
    eq(core.sizes.join(","), "child58,child912,small,woman,man,large");
});
test("a custom hand of the same span and mobility as a profile gives the same fingering", () => {
    const items = randomPiece(7, 120);
    eq(fingersOf(items, "right", { span: 22.5 }), fingersOf(items, "right", "man"));
    eq(fingersOf(items, "left", { span: 17, child: true }), fingersOf(items, "left", "child912"));
    ok(core.resolveHand({ span: 99 }).span <= 30 && core.resolveHand({ span: -1 }).span === 20, "custom span clamped");
});
test("chord limits follow the measured span: a ninth 1-5 for the man, not for the woman; an octave not for a child 9-12", () => {
    const ninth = lib.line([["C4", "D5"]], 1), octave = lib.line([["C4", "C5"]], 1);
    eq(warningsOf(ninth, "right", "man"), 0, "man plays C4-D5");
    ok(warningsOf(ninth, "right", "woman") > 0, "woman: C4-D5 is reported");
    eq(warningsOf(octave, "right", "woman"), 0, "woman plays the octave");
    ok(warningsOf(octave, "right", "child912") > 0, "child 9-12: octave reported");
    eq(warningsOf(lib.line([["C4", "A4"]], 1), "right", "child58"), 0, "child 5-8 plays a sixth");
});
test("the thumb span and the long-finger span scale separately", () => {
    const man = core.internals.makeHand("right", "man"), woman = core.internals.makeHand("right", "woman");
    const t = man.thumbScale / woman.thumbScale, f = man.fingerScale / woman.fingerScale;
    ok(t > 1.1 && f > 1 && f < t, "thumb " + t.toFixed(3) + ", fingers " + f.toFixed(3));
});
test("a child's hand is not a scaled adult hand (mobility)", () => {
    const child = core.internals.makeHand("right", { span: 20, child: true });
    const adult = core.internals.makeHand("right", { span: 20 });
    eq(child.thumbScale, adult.thumbScale);
    ok(child.fingerScale < adult.fingerScale, "less abduction between the long fingers");
    ok(child.comfortScale < adult.comfortScale, "earlier strain");
    ok(child.params.weakStretch > adult.params.weakStretch, "4th finger less independent");
    ok(child.params.crossBase[3] > adult.params.crossBase[3] && child.params.crossReach[3] < adult.params.crossReach[3], "thumb passage");
    ok(child.weights[5] < adult.weights[5], "weaker 5th finger");
    const over = core.internals.makeHand("right", { span: 20, child: true }, { params: { weakStretch: 1 } });
    eq(over.params.weakStretch, 1, "explicit parameters still win over mobility");
});
test("canonical scale fingerings do not depend on the hand", () => {
    const items = lib.line(lib.scalePitches(60, [0, 2, 4, 5, 7, 9, 11], 2), 0.25);
    core.sizes.forEach(sz => eq(fingersOf(items, "right", sz), "123123412312345", sz));
});

if (process.argv.includes("--report")) {
    const sum = runner.summary(results);
    let md = "# Musical reference suite - results\n\nGenerated by `node tests/run-tests.js --report`.\n\n";
    md += "Classes: CANONICAL = the standard fingering; ACCEPTABLE VARIANT = a fingering teachers also use; " +
          "VALID (no reference) = physically valid, the case only states a check; " +
          "NON-STANDARD = physically valid but not the reference (a failure only where the case requires more); " +
          "PHYSICALLY IMPOSSIBLE = violates the independent physical checker.\n\n";
    md += "| group | cases | pass | canonical | acceptable | valid, no reference | non-standard | impossible |\n|---|---|---|---|---|---|---|---|\n";
    Object.keys(sum).forEach(g => {
        const x = sum[g];
        md += "| " + g + " | " + x.total + " | " + x.pass + " | " + x.CANONICAL + " | " + x["ACCEPTABLE VARIANT"] + " | " +
              x["VALID (no reference)"] + " | " + x["NON-STANDARD"] + " | " + x["PHYSICALLY IMPOSSIBLE"] + " |\n";
    });
    md += "\n" + runner.markdownTable(results) + "\n";
    fs.writeFileSync(path.join(__dirname, "REPORT.md"), md);
    console.log("\nwrote tests/REPORT.md");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
