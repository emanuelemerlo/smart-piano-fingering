// Scenarios for tests/musescore-runtime.js. Each one runs the real plugin inside MuseScore on a
// small score, with specific dialog settings, and asserts on the score MuseScore exports.
//
// ctx.run(fixture, cfg)  -> { problem, status, notes, xml, ms, file }
//     cfg: { rh, lh (staff numbers, 0 = none), size (0..6 = XXS..XXL), keep (bool),
//            select: { from, to (measures, 1-based), staffFrom, staffTo (0-based, end exclusive) },
//            compact (bool, default false: "Repeated notes: write the finger only when it changes"),
//            failAt (make the Nth fingering creation throw, to test the rollback) }
// ctx.check(cond, message), ctx.golden(key, notes), ctx.info(message)
"use strict";

const fx = require("./lib/fixtures");

// ------------------------------------------------------------------ helpers
const pitched = notes => notes.filter(x => !x.rest && !x.grace);
const hasFinger = x => x.fingers.length > 0;
const isDigit = f => /^[1-5]$/.test(f);
const where = x => "m" + x.measure + " s" + x.staff + " v" + x.voice + " @" + x.onset + " midi" + x.midi;
const staffNotes = (notes, s) => pitched(notes).filter(x => x.staff === s);
const find = (notes, pred) => pitched(notes).filter(pred);
const doneCount = status => { const m = /^Done: (\d+) fingerings/.exec(status); return m ? Number(m[1]) : -1; };
const finger = x => (x.fingers.length === 1 ? x.fingers[0] : x.fingers.join("+"));

// Every pitched note carries at most one fingering and, if present, it is a digit 1-5.
function wellFormed(ctx, notes, label) {
    const bad = pitched(notes).filter(x => x.fingers.length > 1 || (x.fingers.length === 1 && !isDigit(x.fingers[0])));
    ctx.check(bad.length === 0, label + ": at most one fingering per note, digits 1-5" +
        (bad.length ? " (violations: " + bad.slice(0, 3).map(where).join("; ") + ")" : ""));
}

// In a single voice, two consecutive different pitches should not use the same finger.
function repeatedFingerOnDifferentPitch(notes) {
    const bad = [];
    const groups = {};
    pitched(notes).filter(x => !x.chord && hasFinger(x)).forEach(x => {
        const k = x.staff + "/" + x.voice;
        (groups[k] = groups[k] || []).push(x);
    });
    Object.keys(groups).forEach(k => {
        const g = groups[k].sort((a, b) => a.measure - b.measure || a.onset - b.onset);
        for (let i = 1; i < g.length; i++) {
            if (g[i].midi !== g[i - 1].midi && finger(g[i]) === finger(g[i - 1])) { bad.push(where(g[i - 1]) + " -> " + where(g[i])); }
        }
    });
    return bad;
}

function runOk(ctx, fixture, cfg, label) {
    const r = ctx.run(fixture, cfg);
    ctx.check(!r.problem, label + ": MuseScore ran the plugin" + (r.problem ? " (" + r.problem + ")" : ""));
    return r;
}

// ------------------------------------------------------------------ scenarios
const scenarios = [];
const scenario = (name, description, fn) => scenarios.push({ name: name, description: description, run: fn });

scenario("smoke", "default settings on the small fixture", ctx => {
    const r = runOk(ctx, ctx.fixtureFile("smoke.musicxml"), {}, "smoke");
    const f = pitched(r.notes).filter(hasFinger);
    ctx.check(f.length === 5, "4 right-hand + 1 left-hand fingerings written (got " + f.length + ")");
    ctx.check(doneCount(r.status) === 5, 'dialog status says "Done: 5 fingerings" (got "' + r.status + '")');
    wellFormed(ctx, r.notes, "smoke");
});

scenario("right-hand-only", "left hand disabled: only staff 1 is fingered", ctx => {
    const r = runOk(ctx, ctx.file("scale4", fx.scale4()), { rh: 1, lh: 0 }, "rh only");
    ctx.check(staffNotes(r.notes, 1).every(hasFinger), "every staff-1 note is fingered");
    ctx.check(staffNotes(r.notes, 2).every(x => !hasFinger(x)), "no staff-2 note is fingered");
    ctx.check(doneCount(r.status) === 16, "status counts 16 fingerings (got " + doneCount(r.status) + ")");
});

scenario("left-hand-only", "right hand on staff 2, no left hand: only staff 2 is fingered", ctx => {
    const r = runOk(ctx, ctx.file("scale4", fx.scale4()), { rh: 2, lh: 0 }, "lh only");
    ctx.check(staffNotes(r.notes, 2).every(hasFinger), "every staff-2 note is fingered");
    ctx.check(staffNotes(r.notes, 1).every(x => !hasFinger(x)), "no staff-1 note is fingered");
});

scenario("same-staff-twice", "both hands pointing at the same staff: processed once, no duplicates", ctx => {
    const r = runOk(ctx, ctx.file("scale4", fx.scale4()), { rh: 1, lh: 1 }, "same staff");
    wellFormed(ctx, r.notes, "same staff");
    ctx.check(staffNotes(r.notes, 1).every(hasFinger), "staff 1 is fingered");
    ctx.check(staffNotes(r.notes, 2).every(x => !hasFinger(x)), "staff 2 is untouched");
    ctx.check(doneCount(r.status) === 16, "16 fingerings, not 32 (got " + doneCount(r.status) + ")");
    // With Keep existing OFF a second pass over the same staff would replace the first one's digits
    // and the counter would say 32.
    const r2 = runOk(ctx, ctx.file("scale4", fx.scale4()), { rh: 1, lh: 1, keep: false }, "same staff, replace");
    wellFormed(ctx, r2.notes, "same staff, replace");
    ctx.check(doneCount(r2.status) === 16, "keep OFF: still 16 fingerings, staff processed once (got " + doneCount(r2.status) + ")");
});

scenario("keep-existing", "Keep existing ON: existing fingerings (even custom text) are never touched", ctx => {
    const r = runOk(ctx, ctx.file("existing", fx.existingFingerings()), { keep: true }, "keep on");
    const c4 = find(r.notes, x => x.staff === 1 && x.measure === 1 && x.midi === 60)[0];
    const d4 = find(r.notes, x => x.staff === 1 && x.measure === 1 && x.midi === 62)[0];
    ctx.check(c4 && c4.fingers.join() === "3", 'plain "3" is kept (got ' + (c4 && c4.fingers.join()) + ")");
    ctx.check(d4 && d4.fingers.join() === "1-2", 'custom "1-2" is kept (got ' + (d4 && d4.fingers.join()) + ")");
    ctx.check(pitched(r.notes).every(hasFinger), "every other note received a fingering");
    wellFormed(ctx, r.notes.filter(x => x !== d4), "keep on");
});

scenario("replace-plain", "Keep existing OFF: plain digits are replaced, custom text is left and reported", ctx => {
    const r = runOk(ctx, ctx.file("existing", fx.existingFingerings()), { keep: false }, "keep off");
    const c4 = find(r.notes, x => x.staff === 1 && x.measure === 1 && x.midi === 60)[0];
    const d4 = find(r.notes, x => x.staff === 1 && x.measure === 1 && x.midi === 62)[0];
    ctx.check(c4 && c4.fingers.length === 1 && isDigit(c4.fingers[0]),
        "plain digit on C4 was recalculated and appears exactly once (got " + (c4 && c4.fingers.join("+")) + ")");
    ctx.check(d4 && d4.fingers.join() === "1-2", 'custom "1-2" is left untouched (got ' + (d4 && d4.fingers.join("+")) + ")");
    ctx.check(/left untouched/.test(r.status) && /\b1 note/.test(r.status), "status reports the untouched custom fingering (got \"" + r.status + '")');
    ctx.check(pitched(r.notes).every(hasFinger), "every note has a fingering");
});

scenario("rich-notation", "chords, rests, ties, grace note, tuplets and a unison between voices", ctx => {
    const r = runOk(ctx, ctx.file("rich", fx.richNotation()), {}, "rich");
    wellFormed(ctx, r.notes, "rich");
    const chord = find(r.notes, x => x.staff === 1 && x.measure === 1 && x.onset === 0);
    ctx.check(chord.length === 3 && chord.every(hasFinger), "chord: all 3 notes fingered");
    ctx.check(new Set(chord.map(finger)).size === 3, "chord: 3 different fingers (got " + chord.map(finger).join(",") + ")");
    const tied = find(r.notes, x => x.staff === 1 && x.measure === 2 && x.midi === 67);
    ctx.check(tied.length === 2 && tied.filter(hasFinger).length === 1,
        "tied notes: exactly one fingering for the tied group (got " + tied.filter(hasFinger).length + ")");
    const grace = r.notes.filter(x => x.grace);
    ctx.check(grace.length >= 1 && grace.every(x => !hasFinger(x)), "grace notes are not fingered");
    const tuplets = find(r.notes, x => x.staff === 1 && x.measure === 3 && x.midi !== 65 && x.midi !== 72);
    ctx.check(tuplets.length === 6 && tuplets.every(hasFinger), "all 6 tuplet notes are fingered");
    const unison = find(r.notes, x => x.staff === 1 && x.measure === 4 && x.onset === 0 && x.midi === 64);
    ctx.check(unison.length === 2 && unison.filter(hasFinger).length === 1,
        "unison between voices: exactly one fingering (got " + unison.filter(hasFinger).length + ")");
    const lowest = Math.min.apply(null, unison.map(x => x.voice));
    ctx.check(unison.filter(hasFinger).every(x => x.voice === lowest), "unison: the fingering is on the lowest voice");
    ctx.golden("rich-notation", r.notes);
});

scenario("selection", "Selection only: only the selected measures are written", ctx => {
    const f = ctx.file("eight", fx.eightMeasures());
    let r = runOk(ctx, f, { select: { from: 3, to: 4, staffFrom: 0, staffTo: 2 } }, "measures 3-4");
    const fingered = pitched(r.notes).filter(hasFinger);
    ctx.check(fingered.length === 16 && fingered.every(x => x.measure === 3 || x.measure === 4),
        "16 fingerings, all in measures 3-4 (got " + fingered.length + " in measures " + Array.from(new Set(fingered.map(x => x.measure))).join(",") + ")");
    ctx.check(doneCount(r.status) === 16, "status counts 16 (got " + doneCount(r.status) + ")");

    r = runOk(ctx, f, { select: { from: 1, to: 1, staffFrom: 0, staffTo: 2 } }, "first measure");
    ctx.check(pitched(r.notes).filter(hasFinger).every(x => x.measure === 1) && pitched(r.notes).filter(hasFinger).length === 8,
        "first measure only: 8 fingerings in measure 1");

    r = runOk(ctx, f, { select: { from: 8, to: 8, staffFrom: 0, staffTo: 2 } }, "last measure");
    ctx.check(pitched(r.notes).filter(hasFinger).every(x => x.measure === 8) && pitched(r.notes).filter(hasFinger).length === 8,
        "last measure only: 8 fingerings in measure 8");
});

scenario("selection-one-staff", "Selection covering only staff 1: the other hand is reported as outside", ctx => {
    const r = runOk(ctx, ctx.file("eight", fx.eightMeasures()), { select: { from: 3, to: 4, staffFrom: 0, staffTo: 1 } }, "staff 1 only");
    const fingered = pitched(r.notes).filter(hasFinger);
    ctx.check(fingered.length === 8 && fingered.every(x => x.staff === 1 && (x.measure === 3 || x.measure === 4)),
        "8 fingerings, all on staff 1, measures 3-4 (got " + fingered.length + ")");
    ctx.check(/staff 2 is outside the selection/.test(r.status), 'status mentions "staff 2 is outside the selection" (got "' + r.status + '")');
});

scenario("existing-guides-neighbours", "an existing fingering is kept AND steers the fingering of the notes around it", ctx => {
    const plain = runOk(ctx, ctx.file("scale4", fx.scale4()), { rh: 1, lh: 0, keep: true }, "no existing fingering");
    const anchored = runOk(ctx, ctx.file("anchored", fx.scaleWithAnchor()), { rh: 1, lh: 0, keep: true }, "E4 already fingered 5");
    const pick = r => staffNotes(r.notes, 1).filter(x => x.measure <= 2).map(x => x.midi + "=" + finger(x));
    const e4 = staffNotes(anchored.notes, 1).filter(x => x.measure === 1 && x.midi === 64)[0];
    ctx.check(e4 && finger(e4) === "5", "the existing fingering on E4 is kept (got " + (e4 && finger(e4)) + ")");
    const a = pick(plain), b = pick(anchored);
    const changed = b.filter((v, i) => v !== a[i] && !/^64=/.test(v));
    ctx.check(changed.length > 0, "the notes around it are fingered differently than without it (changed: " + changed.join(", ") + ")");
});

scenario("selection-context", "a selection inside a score gets the same fingering as the full run", ctx => {
    const f = ctx.file("eight", fx.eightMeasures());
    const full = runOk(ctx, f, {}, "full score");
    const part = runOk(ctx, f, { select: { from: 4, to: 5, staffFrom: 0, staffTo: 2 } }, "measures 4-5");
    const key = x => "m" + x.measure + " s" + x.staff + " @" + x.onset + " " + x.midi;
    const fullMap = {};
    pitched(full.notes).forEach(x => { fullMap[key(x)] = finger(x); });
    const diffs = pitched(part.notes).filter(hasFinger).filter(x => fullMap[key(x)] !== finger(x));
    ctx.check(pitched(part.notes).filter(hasFinger).length === 16, "16 fingerings written in the selection");
    ctx.check(diffs.length === 0, "same fingering as the full run (differences: " + diffs.slice(0, 3).map(x => key(x) + " " + finger(x) + " vs " + fullMap[key(x)]).join("; ") + ")");
});

scenario("hand-sizes", "all seven hand sizes run, produce valid output and are deterministic", ctx => {
    const f = ctx.file("scale4", fx.scale4());
    const names = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];
    const results = {};
    names.forEach((name, i) => {
        const r = runOk(ctx, f, { size: i }, "size " + name);
        results[name] = r;
        ctx.check(doneCount(r.status) === 32 && pitched(r.notes).every(hasFinger), name + ": all 32 notes fingered (status \"" + r.status + '")');
        wellFormed(ctx, r.notes, name);
    });
    const again = runOk(ctx, f, { size: 3 }, "size M again");
    ctx.check(JSON.stringify(pitched(again.notes).map(finger)) === JSON.stringify(pitched(results.M.notes).map(finger)),
        "same input and settings give the same fingering (deterministic)");
    ["XXS", "M", "XXL"].forEach(name => ctx.golden("scale4-" + name, results[name].notes));
});

scenario("cross-staff", "notes displayed on the other staff are fingered by that staff's hand", ctx => {
    const f = ctx.file("cross", fx.crossStaff());
    let r = runOk(ctx, f, { rh: 1, lh: 2 }, "both hands");
    ctx.check(pitched(r.notes).every(hasFinger) && pitched(r.notes).length === 5, "both hands: all 5 notes fingered");
    // Only the right hand: the two notes displayed on staff 2 must NOT be fingered.
    r = runOk(ctx, f, { rh: 1, lh: 0 }, "right hand only");
    const shown1 = pitched(r.notes).filter(x => x.staff === 1);
    const shown2 = pitched(r.notes).filter(x => x.staff === 2);
    ctx.check(shown1.length === 2 && shown1.every(hasFinger), "right hand only: the 2 notes displayed on staff 1 are fingered");
    ctx.check(shown2.length === 3 && shown2.every(x => !hasFinger(x)), "right hand only: the 3 notes displayed on staff 2 (2 cross-staff) are not");
});

scenario("percussion", "percussion staves are rejected with a message, other staves still work", ctx => {
    const f = ctx.file("perc", fx.withPercussion());
    let r = runOk(ctx, f, { rh: 1, lh: 3 }, "perc as left hand");
    ctx.check(/staff 3 is a percussion staff/.test(r.status), 'status mentions "staff 3 is a percussion staff" (got "' + r.status + '")');
    ctx.check(pitched(r.notes).filter(x => x.staff === 1).every(hasFinger), "the pitched staff is still fingered");
    ctx.check(r.notes.filter(x => x.staff === 3).every(x => !hasFinger(x)), "nothing is written on the percussion staff");
    r = runOk(ctx, f, { rh: 3, lh: 0 }, "perc only");
    ctx.check(/^Nothing to do/.test(r.status), 'only a percussion staff: "Nothing to do" (got "' + r.status + '")');
    ctx.check(pitched(r.notes).every(x => !hasFinger(x)), "nothing is written");
});

scenario("no-notes", "a score with only rests: no crash, clear message, nothing written", ctx => {
    const r = runOk(ctx, ctx.file("rests", fx.restsOnly()), {}, "rests only");
    ctx.check(/No notes found/.test(r.status), 'status says "No notes found" (got "' + r.status + '")');
    ctx.check(r.notes.every(x => !hasFinger(x)), "nothing is written");
});

scenario("idempotent", "running twice with Keep existing ON changes nothing the second time", ctx => {
    const first = runOk(ctx, ctx.file("scale4", fx.scale4()), { keep: true }, "first run");
    const second = runOk(ctx, first.file, { keep: true }, "second run");
    ctx.check(JSON.stringify(pitched(second.notes).map(finger)) === JSON.stringify(pitched(first.notes).map(finger)),
        "second run leaves all fingerings as they were");
    ctx.check(doneCount(second.status) === 0, "second run writes 0 fingerings (got \"" + second.status + '")');
    wellFormed(ctx, second.notes, "second run");
});

scenario("rollback", "a failure while writing leaves the score unchanged and reports the error", ctx => {
    const r = runOk(ctx, ctx.file("scale4", fx.scale4()), { failAt: 5 }, "injected failure");
    ctx.check(/^Error:/.test(r.status), 'status starts with "Error:" (got "' + r.status + '")');
    ctx.check(pitched(r.notes).every(x => !hasFinger(x)), "score is unchanged: the whole command was rolled back");
});

scenario("musical-sanity", "basic fingering rules hold on scales", ctx => {
    const r = runOk(ctx, ctx.file("scale4", fx.scale4()), {}, "scale");
    const bad = repeatedFingerOnDifferentPitch(r.notes);
    ctx.check(bad.length === 0, "no two consecutive different pitches share a finger" + (bad.length ? " (e.g. " + bad.slice(0, 3).join("; ") + ")" : ""));
});

scenario("stress", "1536 notes: completes, every note fingered, result is stable", ctx => {
    const r = runOk(ctx, ctx.file("stress", fx.stress()), {}, "stress");
    ctx.info("stress: " + r.ms + " ms for " + pitched(r.notes).length + " notes");
    ctx.check(pitched(r.notes).length === 1536, "all 1536 notes survived the round trip");
    ctx.check(pitched(r.notes).every(hasFinger), "every note has a fingering");
    ctx.check(doneCount(r.status) === 1536, "status counts 1536 (got \"" + r.status + '")');
    wellFormed(ctx, r.notes, "stress");
    const bad = repeatedFingerOnDifferentPitch(r.notes);
    ctx.check(bad.length === 0, "no consecutive different pitches share a finger" + (bad.length ? " (" + bad.length + " cases, e.g. " + bad.slice(0, 2).join("; ") + ")" : ""));
    ctx.golden("stress", r.notes);
});

scenario("repeated-pedal", "repeated-note pedal under another voice: one finger; compact numbering on and off", ctx => {
    const pedalOf = r => find(r.notes, x => x.staff === 2 && x.midi === 43);
    const full = runOk(ctx, ctx.file("pedal", fx.repeatedPedal()), { compact: false }, "pedal, compact off");
    const g = pedalOf(full);
    ctx.check(g.length === 32 && g.every(hasFinger), "compact off: all 32 pedal notes are fingered (got " + g.filter(hasFinger).length + "/" + g.length + ")");
    ctx.check(new Set(g.map(finger)).size === 1 && finger(g[0]) === "5",
        "the pedal keeps one finger, 5 (got " + Array.from(new Set(g.map(finger))).join(",") + ")");
    wellFormed(ctx, full.notes, "pedal, compact off");
    const compact = runOk(ctx, ctx.file("pedal", fx.repeatedPedal()), { compact: true }, "pedal, compact on");
    const c = pedalOf(compact);
    const shown = c.filter(hasFinger);
    ctx.check(c.length === 32 && shown.length === 1 && shown[0].measure === 1 && shown[0].onset === 0 && finger(shown[0]) === "5",
        "compact on: only the first pedal note is numbered, with 5 (got " + shown.map(x => where(x) + "=" + finger(x)).join("; ") + ")");
    ctx.check(doneCount(compact.status) === pitched(compact.notes).filter(hasFinger).length,
        "status counts the numbers actually written (got \"" + compact.status + '")');
    wellFormed(ctx, compact.notes, "pedal, compact on");
});

module.exports = { scenarios: scenarios };
