// Musical reference suite (spec sections 21-23).
// Each case: { group, name, items, side, size, expected, variants, perNote, min, check, ref }
//   expected : canonical fingering (one finger per item, in item order)
//   variants : other fingerings a teacher would accept
//   perNote  : allowed fingers per note (alternative to variants)
//   min      : minimum classification required to pass (default "ACCEPTABLE VARIANT")
//   check    : extra assertion, (result, case) -> error string or null
//   ref      : provenance of the reference fingering
"use strict";
const { midi, line, scalePitches } = require("./lib.js");

const TONICS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const MINOR_NAMES = ["c", "c#", "d", "eb", "e", "f", "f#", "g", "g#", "a", "bb", "b"];

// Reference one-octave fingerings, written out from the standard method books
// (Hanon, "The Virtuoso Pianist" part III; ABRSM "Manual of Scales, Broken Chords and Arpeggios").
// Order: tonic to tonic, ascending. Descending fingerings are the same keys in reverse order.
const REF_MAJOR_RH = {
    C: "12312345", Db: "23123412", D: "12312345", Eb: "31234123", E: "12312345", F: "12341234",
    Gb: "23412312", G: "12312345", Ab: "34123123", A: "12312345", Bb: "41231234", B: "12312345"
};
const REF_MAJOR_LH = {
    C: "54321321", Db: "32143213", D: "54321321", Eb: "32143213", E: "54321321", F: "54321321",
    Gb: "43213214", G: "54321321", Ab: "32143213", A: "54321321", Bb: "32143213", B: "43214321"
};
const REF_HARM_RH = {
    c: "12312345", "c#": "34123123", d: "12312345", eb: "31234123", e: "12312345", f: "12341234",
    "f#": "34123123", g: "12312345", "g#": "34123123", a: "12312345", bb: "41231234", b: "12312345"
};
const REF_HARM_LH = {
    c: "54321321", "c#": "32143213", d: "54321321", eb: "21432132", e: "54321321", f: "54321321",
    "f#": "43213214", g: "54321321", "g#": "32132143", a: "54321321", bb: "21321432", b: "43214321"
};
// Melodic minor ascending: as the harmonic form except where the raised 6th would fall under the
// thumb (f#, c# right hand), where the books give 2 3 1 2 3 4 1 2. Natural minor (and melodic
// descending): as the harmonic form.
const REF_MELODIC_RH_OVERRIDE = { "f#": "23123412", "c#": "23123412" };

const STEPS = {
    major: [0, 2, 4, 5, 7, 9, 11], harmonic: [0, 2, 3, 5, 7, 8, 11],
    melodic: [0, 2, 3, 5, 7, 9, 11], natural: [0, 2, 3, 5, 7, 8, 10]
};

const digits = s => s.split("").map(Number);

// Two-octave expected fingering from the one-octave table: the inner tonic takes the finger of the
// tonic on the thumb side (RH: first finger; LH: last finger).
function twoOctaves(table, side) {
    const t = digits(table);
    if (side === "right") { return t.slice(0, 7).concat(t.slice(0, 7), [t[7]]); }
    return t.slice(0, 7).concat([t[7]], t.slice(1, 7), [t[7]]);
}

function scaleCases() {
    const cases = [];
    const add = (group, label, tonicPc, steps, table, side, octaves, ref) => {
        const base = side === "right" ? 60 : 48;
        const up = scalePitches(base + tonicPc, steps, octaves);
        const fUp = octaves === 2 ? twoOctaves(table, side) : digits(table);
        cases.push({ group, name: label + " " + (side === "right" ? "RH" : "LH") + " ascending " + octaves + " oct",
            items: line(up, 0.25), side, expected: fUp, min: "CANONICAL", ref });
        cases.push({ group, name: label + " " + (side === "right" ? "RH" : "LH") + " descending " + octaves + " oct",
            items: line(up.slice().reverse(), 0.25), side, expected: fUp.slice().reverse(), min: "CANONICAL", ref });
    };
    TONICS.forEach((t, pc) => {
        for (const side of ["right", "left"]) {
            const tab = side === "right" ? REF_MAJOR_RH[t] : REF_MAJOR_LH[t];
            add("A. Major scales", t + " major", pc, STEPS.major, tab, side, 2, "method books");
        }
    });
    add("A. Major scales", "C major", 0, STEPS.major, REF_MAJOR_RH.C, "right", 1, "method books");
    add("A. Major scales", "Ab major", 8, STEPS.major, REF_MAJOR_LH.Ab, "left", 1, "method books");

    MINOR_NAMES.forEach((t, pc) => {
        for (const side of ["right", "left"]) {
            const harm = side === "right" ? REF_HARM_RH[t] : REF_HARM_LH[t];
            add("B. Minor scales", t + " harmonic minor", pc, STEPS.harmonic, harm, side, 2, "method books");
            add("B. Minor scales", t + " natural minor", pc, STEPS.natural, harm, side, 2, "method books (same fingers as harmonic)");
            // melodic: ascending melodic form, descending natural form
            const melo = side === "right" && REF_MELODIC_RH_OVERRIDE[t] ? REF_MELODIC_RH_OVERRIDE[t] : harm;
            const base = side === "right" ? 60 : 48;
            const upP = scalePitches(base + pc, STEPS.melodic, 2);
            const downP = scalePitches(base + pc, STEPS.natural, 2).reverse();
            const s = side === "right" ? "RH" : "LH";
            const refM = REF_MELODIC_RH_OVERRIDE[t] && side === "right" ? "method books (thumb kept off the raised 6th)" : "method books";
            cases.push({ group: "B. Minor scales", name: t + " melodic minor " + s + " ascending 2 oct",
                items: line(upP, 0.25), side, expected: twoOctaves(melo, side), min: "CANONICAL", ref: refM });
            cases.push({ group: "B. Minor scales", name: t + " melodic minor " + s + " descending (natural form) 2 oct",
                items: line(downP, 0.25), side, expected: twoOctaves(harm, side).reverse(), min: "CANONICAL", ref: "method books" });
            // up and back down in one phrase: the turning point is the outer extreme
            if (side === "right" && (t === "a" || t === "f#")) {
                const one = scalePitches(base + pc, STEPS.melodic, 1);
                const down1 = scalePitches(base + pc, STEPS.natural, 1).reverse().slice(1);
                // At the turning point the top tonic must also prepare the descent in the natural
                // form: f# takes 3 there (2 would be followed by 2 on E natural).
                const fUp = digits(melo), fDown = digits(harm).reverse().slice(1);
                if (t === "f#") { fUp[7] = 3; }
                cases.push({ group: "B. Minor scales", name: t + " melodic minor RH up and down, 1 oct",
                    items: line(one.concat(down1), 0.25), side, expected: fUp.concat(fDown), min: "CANONICAL",
                    ref: t === "f#" ? "method books; top note adapted to the natural-form descent" : refM });
            }
        }
    });
    return cases;
}

function chromaticCases() {
    const cases = [];
    // Canonical "1-3" chromatic fingering: 3 on black keys, 1 on white keys, 2 on the second of
    // two adjacent white keys (RH: F after E and C after B; LH: E after F and B after C).
    const ref = (pitches, side) => pitches.map((p, i) => {
        const pc = ((p % 12) + 12) % 12;
        if ([1, 3, 6, 8, 10].includes(pc)) { return 3; }
        const special = side === "right" ? (pc === 5 || pc === 0) : (pc === 4 || pc === 11);
        if (!special) { return 1; }
        const partner = side === "right" ? p - 1 : p + 1;
        return (pitches[i - 1] === partner || pitches[i + 1] === partner) ? 2 : 1;
    });
    const per = pitches => pitches.map(p => ([1, 3, 6, 8, 10].includes(p % 12) ? [2, 3, 4] : [1, 2]));
    const mk = (name, start, len, side, dir) => {
        let p = []; for (let i = 0; i < len; i++) { p.push(start + i); }
        if (dir === "down") { p = p.reverse(); }
        cases.push({ group: "C. Chromatic & pentatonic", name, items: line(p, 0.25), side, expected: ref(p, side),
            perNote: per(p), min: "ACCEPTABLE VARIANT", ref: "standard 1-3 chromatic fingering" });
    };
    mk("chromatic RH up 1 oct from C4", 60, 13, "right", "up");
    mk("chromatic RH down 1 oct from C5", 60, 13, "right", "down");
    mk("chromatic RH up 2 oct from C4", 60, 25, "right", "up");
    mk("chromatic RH down 2 oct from E5", 52, 25, "right", "down");
    mk("chromatic LH up 1 oct from C3", 48, 13, "left", "up");
    mk("chromatic LH down 1 oct from C4", 48, 13, "left", "down");
    mk("chromatic LH up 2 oct from E2", 40, 25, "left", "up");
    mk("chromatic LH down 2 oct from C4", 36, 25, "left", "down");
    mk("short chromatic run (3 notes) RH", 64, 3, "right", "up");
    // Pentatonic scales (no single canonical fingering exists: groups of 2+3 fingers, thumb on white
    // keys where possible). Checked for recognition and for a clean legato fingering.
    const penta = (name, notes, side) => cases.push({ group: "C. Chromatic & pentatonic", name, items: line(notes, 0.25), side,
        min: "NON-STANDARD", clean: true, ref: "2+3 finger groups",
        check: r => r.analysis.patterns.some(p => p.kind === "pentatonic") ? null : "not recognised as pentatonic" });
    penta("C major pentatonic RH 2 oct (recognised)", ["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5", "C6"], "right");
    penta("C major pentatonic LH 2 oct (recognised)", ["C3", "D3", "E3", "G3", "A3", "C4", "D4", "E4", "G4", "A4", "C5"], "left");
    penta("black-key pentatonic RH (recognised)", ["Gb4", "Ab4", "Bb4", "Db5", "Eb5", "Gb5", "Ab5", "Bb5", "Db6"], "right");
    return cases;
}

function arpeggioCases() {
    const cases = [];
    const mk = (name, tones, startOct, side, rh, lh, variantsRH, variantsLH, ref) => {
        // two octaves from the lowest tone, ascending and descending
        const base = (side === "right" ? 60 : 48) + startOct;
        const p = [];
        for (let o = 0; o < 2; o++) { tones.forEach(t => p.push(base + t + 12 * o)); }
        p.push(base + tones[0] + 24);
        const f = digits(side === "right" ? rh : lh);
        const vars = ((side === "right" ? variantsRH : variantsLH) || []).map(digits);
        const s = side === "right" ? "RH" : "LH";
        cases.push({ group: "D. Arpeggios", name: name + " " + s + " up 2 oct", items: line(p, 0.25), side,
            expected: f, variants: vars, min: "ACCEPTABLE VARIANT", ref });
        cases.push({ group: "D. Arpeggios", name: name + " " + s + " down 2 oct", items: line(p.slice().reverse(), 0.25), side,
            expected: f.slice().reverse(), variants: vars.map(v => v.slice().reverse()), min: "ACCEPTABLE VARIANT", ref });
    };
    for (const side of ["right", "left"]) {
        mk("C major root position", [0, 4, 7], 0, side, "1231235", "5421421", [], ["5321321"], "method books");
        mk("C major 1st inversion", [0, 3, 8], 4, side, "1241245", "5421421", [], [], "method books");
        mk("C major 2nd inversion", [0, 5, 9], 7, side, "1241245", "5321321", ["1231235"], [], "method books (RH 1-2-3 also taught)");
        mk("A minor root position", [0, 3, 7], 9 - 12, side, "1231235", "5421421", [], ["5321321"], "method books");
        mk("B diminished", [0, 3, 6], 11 - 12, side, "1231235", "5421421", [], [], "rule-derived (thumb on the white root)");
        mk("G dominant 7th", [0, 4, 7, 10], 7 - 12, side, "123412345", "543214321", [], [], "method books");
        mk("C diminished 7th", [0, 3, 6, 9], 0, side, "123412345", "543214321", [], [], "method books");
        mk("Db major (black-key root)", [0, 4, 7], 1, side, "2124124", "2142142", [], ["2132132"],
            side === "right" ? "method books" : "rule-derived; books differ (4 or 3 on Ab)");
        mk("F# major (all black keys)", [0, 4, 7], 6 - 12, side, "1231235", "5421421", [], ["5321321"], "method books");
    }
    return cases;
}

function chordCases() {
    const cases = [];
    const mk = (name, notes, side, exp, variants, size, ref) => {
        cases.push({ group: "E. Chords", name: name + " " + (side === "right" ? "RH" : "LH") + (size ? " (" + size + ")" : ""),
            items: line([notes.map(midi)], 1), side, size, expected: digits(exp),
            variants: (variants || []).map(digits), min: "ACCEPTABLE VARIANT", ref: ref || "standard hand shape" });
    };
    mk("C major root position", ["C4", "E4", "G4"], "right", "135");
    mk("C major root position", ["C3", "E3", "G3"], "left", "531");
    mk("C major 1st inversion", ["E4", "G4", "C5"], "right", "125");
    mk("C major 1st inversion", ["E3", "G3", "C4"], "left", "531");
    mk("C major 2nd inversion", ["G4", "C5", "E5"], "right", "135");
    mk("C major 2nd inversion", ["G3", "C4", "E4"], "left", "521");
    mk("A minor root position", ["A4", "C5", "E5"], "right", "135");
    mk("Db major (thumb on black is normal)", ["Db4", "F4", "Ab4"], "right", "135");
    mk("G dominant 7th root", ["G4", "B4", "D5", "F5"], "right", "1235");
    mk("G dominant 7th root", ["G2", "B2", "D3", "F3"], "left", "5321", ["5421"]);
    mk("G7 1st inversion", ["B3", "D4", "F4", "G4"], "right", "1235", ["1245"]);
    mk("C major triad + octave", ["C4", "E4", "G4", "C5"], "right", "1235", ["1245"]);
    mk("C major triad + octave", ["C3", "E3", "G3", "C4"], "left", "5321", ["5421"]);
    mk("octave", ["C4", "C5"], "right", "15", ["14"]);
    mk("octave", ["C3", "C4"], "left", "51", ["41"]);
    mk("five-note cluster", ["C4", "D4", "E4", "F4", "G4"], "right", "12345");
    mk("C major root position", ["C4", "E4", "G4"], "right", "135", ["125"], "XS", "standard shape; 1-2-5 accepted for a small hand");
    mk("C major + octave", ["C4", "E4", "G4", "C5"], "right", "1235", ["1245"], "XXL");
    return cases;
}

function repeatedCases() {
    const cases = [];
    const noConsecutiveSame = r => {
        for (let i = 1; i < r.fingers.length; i++) { if (r.fingers[i] === r.fingers[i - 1]) { return "same finger at " + i; } }
        return null;
    };
    cases.push({ group: "F. Repeated notes", name: "slow repeated C (half notes) keeps the finger",
        items: line(["C4", "C4", "C4", "C4"], 2), side: "right", min: "NON-STANDARD",
        check: r => new Set(r.fingers).size === 1 ? null : "finger changed: " + r.fingers.join(""), ref: "same finger when slow" });
    cases.push({ group: "F. Repeated notes", name: "fast repeated C (16ths) alternates fingers",
        items: line(Array(8).fill("C4"), 0.25), side: "right", min: "NON-STANDARD", check: noConsecutiveSame, ref: "3-2-1 / 4-3-2-1 / 2-1" });
    cases.push({ group: "F. Repeated notes", name: "very fast long repetition (16 x 32nds) alternates",
        items: line(Array(16).fill("G4"), 0.125), side: "right", min: "NON-STANDARD", check: noConsecutiveSame, ref: "3-2-1 / 4-3-2-1 / 2-1" });
    cases.push({ group: "F. Repeated notes", name: "fast repetition LH alternates",
        items: line(Array(6).fill("C3"), 0.25), side: "left", min: "NON-STANDARD", check: noConsecutiveSame, ref: "1-2-3 / 2-1" });
    cases.push({ group: "F. Repeated notes", name: "fast repetition avoids the 5th finger",
        items: line(Array(8).fill("E4"), 0.25), side: "right", min: "NON-STANDARD",
        check: r => r.fingers.includes(5) ? "5th finger used: " + r.fingers.join("") : null, ref: "5 is too weak for repetitions" });
    cases.push({ group: "F. Repeated notes", name: "fast repetition then scale up",
        items: line(["C4", "C4", "C4", "C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"], 0.25), side: "right", min: "NON-STANDARD",
        check: r => noConsecutiveSame({ fingers: r.fingers.slice(0, 4) }), ref: "alternation, then any valid continuation" });
    return cases;
}

function blackKeyCases() {
    const cases = [];
    const noThumbOnBlack = r => {
        const bad = r.items.filter((it, i) => [1, 3, 6, 8, 10].includes(it.pitch % 12) && r.fingers[i] === 1);
        return bad.length ? "thumb on black key(s)" : null;
    };
    const p = (n, d) => line(n, d || 0.25);
    cases.push({ group: "G. Black keys", name: "D major scale RH: no thumb on F#/C#",
        items: p(scalePitches(62, STEPS.major, 1)), side: "right", min: "NON-STANDARD", check: noThumbOnBlack, ref: "thumb on white keys in scales" });
    cases.push({ group: "G. Black keys", name: "melodic line in E major RH: no thumb on black",
        items: p(["E4", "F#4", "G#4", "B4", "A4", "G#4", "F#4", "E4", "D#4", "E4"]), side: "right", min: "NON-STANDARD", check: noThumbOnBlack,
        ref: "thumb on white keys in stepwise lines" });
    cases.push({ group: "G. Black keys", name: "Db major chord RH: thumb on black accepted",
        items: line([[midi("Db4"), midi("F4"), midi("Ab4")]], 1), side: "right", expected: [1, 3, 5], min: "CANONICAL", ref: "standard chord shape" });
    cases.push({ group: "G. Black keys", name: "F# major arpeggio RH: thumb on black accepted (all black)",
        items: p(["F#4", "A#4", "C#5", "F#5", "A#5", "C#6", "F#6"]), side: "right", expected: [1, 2, 3, 1, 2, 3, 5], min: "CANONICAL", ref: "method books" });
    cases.push({ group: "G. Black keys", name: "F major scale RH: 4th finger on Bb",
        items: p(scalePitches(65, STEPS.major, 1)), side: "right", min: "NON-STANDARD",
        check: r => r.fingers[3] === 4 ? null : "Bb fingered " + r.fingers[3], ref: "4 on Bb in F major" });
    cases.push({ group: "G. Black keys", name: "five-finger F-G-A-Bb RH: 4 (not 5) on Bb",
        items: p(["G4", "A4", "Bb4", "A4", "G4", "F4"]), side: "right", expected: [2, 3, 4, 3, 2, 1], min: "CANONICAL", ref: "five-finger position" });
    cases.push({ group: "G. Black keys", name: "Eb major scale RH: no 5th finger on black",
        items: p(scalePitches(63, STEPS.major, 2)), side: "right", min: "NON-STANDARD",
        check: r => r.items.some((it, i) => [1, 3, 6, 8, 10].includes(it.pitch % 12) && r.fingers[i] === 5) ? "5 on black" : null,
        ref: "5 only at white extremes in scales" });
    cases.push({ group: "G. Black keys", name: "chromatic RH: thumb never on black",
        items: p([...Array(13)].map((_, i) => 61 + i)), side: "right", min: "NON-STANDARD", check: noThumbOnBlack, ref: "1-3 chromatic fingering" });
    return cases;
}

function leapCases() {
    const cases = [];
    cases.push({ group: "H. Leaps", name: "RH leap of two octaves into a five-finger position",
        items: line(["C4", "E4", "G4", "C6", "D6", "E6", "F6", "G6"], 0.5), side: "right", min: "NON-STANDARD", clean: true,
        check: r => r.fingers.slice(3).join("") === "12345" ? null : "after the leap: " + r.fingers.slice(3).join(""),
        ref: "land with the finger the next position needs" });
    cases.push({ group: "H. Leaps", name: "RH leap into a C major scale",
        items: line(["G3"].concat(scalePitches(72, STEPS.major, 1).map(String).map(Number)), 0.25), side: "right", min: "NON-STANDARD",
        check: r => r.fingers.slice(1).join("") === "12312345" ? null : "scale after the leap: " + r.fingers.slice(1).join(""),
        ref: "scale fingering after repositioning" });
    cases.push({ group: "H. Leaps", name: "LH stride bass (octave and fifth leaps)",
        items: line(["C2", "C3", "G2", "C3", "F2", "F3", "C3", "F3"], 0.5), side: "left", min: "NON-STANDARD", clean: true,
        ref: "any valid fingering without same-finger legato steps" });
    cases.push({ group: "H. Leaps", name: "LH leap of two octaves then scale down",
        items: line(["C5", "C3", "B2", "A2", "G2", "F2", "E2", "D2", "C2"], 0.25), side: "left", min: "NON-STANDARD",
        check: r => r.fingers.slice(1).join("") === "12312345" ? null : "scale after the leap: " + r.fingers.slice(1).join(""),
        ref: "C major LH descending" });
    return cases;
}

function heldCases() {
    const cases = [];
    const it = (p, s, e, v) => ({ pitch: midi(p), start: s, end: e, anchor: 0, voice: v || 0 });
    const ids = arr => arr.map((x, i) => Object.assign(x, { id: i }));
    cases.push({ group: "I. Held notes", name: "RH holds C4 while E-F-G move above",
        items: ids([it("C4", 0, 4, 1), it("E4", 1, 2), it("F4", 2, 3), it("G4", 3, 4)]), side: "right", min: "ACCEPTABLE VARIANT", clean: true,
        expected: [1, 3, 4, 5], variants: [[1, 2, 3, 4]], ref: "five-finger position C-G with the thumb held" });
    cases.push({ group: "I. Held notes", name: "LH holds G2 while D3-E3-F3-G3 move above",
        items: ids([it("G2", 0, 4, 1), it("D3", 0.5, 1), it("E3", 1, 1.5), it("F3", 1.5, 2), it("G3", 2, 2.5)]), side: "left", min: "NON-STANDARD",
        ref: "held 5th, moving voice above" });
    cases.push({ group: "I. Held notes", name: "RH holds top G5 while a scale runs below",
        items: ids([it("G5", 0, 4, 1), it("C5", 0.5, 0.75), it("D5", 0.75, 1), it("E5", 1, 1.25), it("F5", 1.25, 1.5),
                    it("E5", 1.5, 1.75), it("D5", 1.75, 2), it("C5", 2, 2.5)]), side: "right", min: "NON-STANDARD",
        ref: "held 5th, 1-2-3-4 below" });
    cases.push({ group: "I. Held notes", name: "two-voice chorale texture RH",
        items: ids([it("E4", 0, 2, 1), it("C5", 0, 1), it("D5", 1, 2), it("F4", 2, 4, 1), it("C5", 2, 3), it("B4", 3, 4)]),
        side: "right", min: "NON-STANDARD", clean: true, ref: "valid finger assignment with held lower voice, no 5-5 or 5-4 in the upper voice" });
    return cases;
}

function comboCases() {
    const cases = [];
    const C = [0, 2, 4, 5, 7, 9, 11];
    const sc = (t, dir) => { const p = scalePitches(t, C, 1); return dir === "down" ? p.reverse() : p; };
    const tail = (n, exp) => r => {
        const got = r.fingers.slice(r.fingers.length - n).join("");
        return got === exp ? null : "scale part " + got + " (expected " + exp + ")";
    };
    const head = (n, exp) => r => {
        const got = r.fingers.slice(0, n).join("");
        return got === exp ? null : "scale part " + got + " (expected " + exp + ")";
    };
    cases.push({ group: "J. Combinations", name: "chord -> scale (RH)",
        items: line([[60, 64, 67]].concat(sc(60)), [1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]), side: "right",
        min: "CANONICAL", expected: digits("13512312345"), ref: "C major scale after a chord" });
    cases.push({ group: "J. Combinations", name: "scale -> chord (RH)",
        items: line(sc(60).concat([[72, 76, 79]]), 0.25), side: "right", min: "CANONICAL",
        expected: digits("12312341135"), ref: "scale, then chord" });
    cases.push({ group: "J. Combinations", name: "chord -> chord: I-IV-V7-I (RH)",
        items: line([[60, 64, 67], [60, 65, 69], [59, 62, 65, 67], [60, 64, 67]], 1), side: "right", min: "ACCEPTABLE VARIANT",
        expected: digits("1351351245135"), variants: [digits("1351351235135")], ref: "close-position progression" });
    cases.push({ group: "J. Combinations", name: "chord -> chord: I-IV-V-I (LH)",
        items: line([[48, 52, 55], [48, 53, 57], [47, 50, 55], [48, 52, 55]], 1), side: "left", min: "CANONICAL",
        expected: digits("531521531531"), ref: "close-position progression" });
    cases.push({ group: "J. Combinations", name: "arpeggio -> scale (RH)",
        items: line([60, 64, 67, 72, 76, 79, 84].concat(sc(72, "down").slice(1)), 0.25), side: "right", min: "CANONICAL",
        expected: digits("12312354321321"), ref: "C major arpeggio then scale" });
    cases.push({ group: "J. Combinations", name: "scale -> arpeggio (RH)",
        items: line(sc(60).slice(0, 7).concat([72, 76, 79, 84]), 0.25), side: "right", min: "CANONICAL",
        expected: digits("12312341235"), ref: "scale then arpeggio (the scale's last C keeps the thumb)" });
    cases.push({ group: "J. Combinations", name: "broken triads changing every bar (LH)",
        items: line([48, 52, 55, 52, 43, 47, 50, 47, 48, 52, 55, 52, 41, 45, 48, 45], 1), side: "left", min: "CANONICAL",
        expected: digits("5313531353135313"), ref: "root-position broken chord, hand repositioned at each harmony" });
    cases.push({ group: "J. Combinations", name: "Alberti bass (LH)",
        items: line([48, 55, 52, 55, 48, 55, 52, 55, 47, 55, 50, 55, 48, 55, 52, 55], 0.25), side: "left", min: "ACCEPTABLE VARIANT",
        expected: digits("5131513151315131"), variants: [digits("5131513151415131"), digits("5131513141314131")], ref: "standard Alberti fingering" });
    return cases;
}

function analysisCases() {
    const cases = [];
    cases.push({ group: "K. Recognition limits", name: "neighbour-note figure is a five-finger position, not a scale",
        items: line(["C4", "D4", "C4", "E4", "D4", "F4", "E4", "G4"], 0.25), side: "right", expected: [1, 2, 1, 3, 2, 4, 3, 5],
        min: "CANONICAL", check: r => r.analysis && r.analysis.patterns.some(p => p.kind === "scale") ? "classified as scale" : null,
        ref: "five-finger position" });
    cases.push({ group: "K. Recognition limits", name: "line in thirds: no scale rules applied",
        items: line(["C4", "E4", "D4", "F4", "E4", "G4", "F4", "A4"], 0.25), side: "right", min: "NON-STANDARD",
        check: r => r.analysis && r.analysis.patterns.some(p => p.kind === "scale") ? "classified as scale" : null, ref: "generic engine" });
    cases.push({ group: "K. Recognition limits", name: "modal run G to G on white keys (ambiguous key) stays soft",
        items: line(["G4", "A4", "B4", "C5", "D5", "E5", "F5", "G5"], 0.25), side: "right", min: "ACCEPTABLE VARIANT",
        expected: [2, 3, 4, 1, 2, 3, 1, 2], variants: [[1, 2, 3, 1, 2, 3, 4, 5]],
        check: r => {
            const s = r.analysis && r.analysis.patterns.find(p => p.kind === "scale");
            return s && s.strength === "strong" ? "ambiguous run treated as strong" : null;
        }, ref: "C major fingering or G-shape fingering" });
    cases.push({ group: "K. Recognition limits", name: "scale embedded in a phrase with dotted rhythm",
        items: line(["E4", "G4"].concat(scalePitches(60, STEPS.major, 1)).concat(["E5", "C5"]), [0.75, 0.25]), side: "right",
        min: "NON-STANDARD", check: r => r.fingers.slice(2, 10).join("") === "12312341" ? null : "scale part " + r.fingers.slice(2, 10).join(""),
        ref: "C major scale inside a melody; the top C keeps the thumb because the melody continues upwards" });
    cases.push({ group: "K. Recognition limits", name: "scale from the 5th degree with key signature (G major)",
        items: line(["D4", "E4", "F#4", "G4", "A4", "B4", "C5", "D5"], 0.25).map(it => Object.assign(it, { keySig: 1 })), side: "right",
        expected: [2, 3, 4, 1, 2, 3, 1, 2], min: "CANONICAL", ref: "G major degrees" });
    return cases;
}

function anchorAndSizeCases() {
    const cases = [];
    const sc = scalePitches(60, STEPS.major, 1);
    const withAnchor = line(sc, 0.25); withAnchor[3].anchor = 4;
    cases.push({ group: "L. Anchors and hand size", name: "user anchor 4 on F in C major is kept",
        items: withAnchor, side: "right", min: "NON-STANDARD",
        check: r => r.fingers[3] === 4 ? null : "anchor overridden", ref: "user anchor has priority" });
    const it = (p, s, e, a) => ({ pitch: midi(p), start: s, end: e, anchor: a || 0, voice: 0 });
    const conflict = [it("C4", 0, 4, 1), it("E4", 1, 2, 1)].map((x, i) => Object.assign(x, { id: i }));
    cases.push({ group: "L. Anchors and hand size", name: "anchor clashing with a held finger is reported",
        items: conflict, side: "right", min: "PHYSICALLY IMPOSSIBLE",
        check: r => r.warnings.some(w => w.reason === "anchor-held") ? null : "no warning", ref: "report, do not hide" });
    for (const size of ["XXS", "S", "XXL"]) {
        cases.push({ group: "L. Anchors and hand size", name: "C major scale RH 2 oct with hand " + size,
            items: line(scalePitches(60, STEPS.major, 2), 0.25), side: "right", size,
            expected: twoOctaves(REF_MAJOR_RH.C, "right"), min: "CANONICAL", ref: "scales do not depend on hand size" });
    }
    cases.push({ group: "L. Anchors and hand size", name: "C major arpeggio RH with hand XXS stays playable",
        items: line([60, 64, 67, 72, 76, 79, 84], 0.25), side: "right", size: "XXS", min: "NON-STANDARD",
        expected: [1, 2, 3, 1, 2, 3, 5], ref: "variant allowed for very small hands" });
    cases.push({ group: "L. Anchors and hand size", name: "wide chord C3-G3-E4 RH (M): impossible span is reported",
        items: line([[48, 55, 64]], 1), side: "right", min: "PHYSICALLY IMPOSSIBLE",
        check: r => r.warnings.length ? null : "no warning for an unplayable chord", ref: "report, do not hide" });
    return cases;
}

const digitsExport = digits;
function allCases() {
    return [].concat(scaleCases(), chromaticCases(), arpeggioCases(), chordCases(), repeatedCases(),
                     blackKeyCases(), leapCases(), heldCases(), comboCases(), analysisCases(), anchorAndSizeCases());
}

module.exports = { allCases, REF_MAJOR_RH, REF_MAJOR_LH, REF_HARM_RH, REF_HARM_LH, STEPS, twoOctaves, digits: digitsExport, TONICS, MINOR_NAMES };
