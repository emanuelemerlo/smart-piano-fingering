// Test scores for the runtime tests, built in code so they are reviewable and deterministic.
// Use `node tests/musescore-runtime.js --write-fixtures <dir>` to dump them as .musicxml files
// that can be opened in MuseScore.
"use strict";

const { Q, E, S, H, W, n, rest, score } = require("./musicxml");

const mk = (pitches, d, extra) => pitches.map(p => n(p, d, extra));

// 4 measures. RH: ascending then descending C major scale. LH: quarter-note arpeggios.
function scale4() {
    return score([
        { s1: [mk(["C4", "D4", "E4", "F4"], Q)], s2: [mk(["C3", "E3", "G3", "E3"], Q)] },
        { s1: [mk(["G4", "A4", "B4", "C5"], Q)], s2: [mk(["G2", "B2", "D3", "B2"], Q)] },
        { s1: [mk(["C5", "B4", "A4", "G4"], Q)], s2: [mk(["C3", "E3", "G3", "E3"], Q)] },
        { s1: [mk(["F4", "E4", "D4", "C4"], Q)], s2: [mk(["F2", "A2", "C3", "A2"], Q)] },
    ]);
}

// scale4 with an existing plain fingering "5" on E4 (an unusual choice that should steer the neighbours).
function scaleWithAnchor() {
    return score([
        { s1: [[n("C4", Q), n("D4", Q), n("E4", Q, { finger: "5" }), n("F4", Q)]], s2: [mk(["C3", "E3", "G3", "E3"], Q)] },
        { s1: [mk(["G4", "A4", "B4", "C5"], Q)], s2: [mk(["G2", "B2", "D3", "B2"], Q)] },
        { s1: [mk(["C5", "B4", "A4", "G4"], Q)], s2: [mk(["C3", "E3", "G3", "E3"], Q)] },
        { s1: [mk(["F4", "E4", "D4", "C4"], Q)], s2: [mk(["F2", "A2", "C3", "A2"], Q)] },
    ]);
}

// Pre-existing fingerings: "3" (plain, an anchor), "1-2" (custom text, must never be replaced).
function existingFingerings() {
    return score([
        {
            s1: [[n("C4", Q, { finger: "3" }), n("D4", Q, { finger: "1-2" }), n("E4", Q), n("F4", Q)]],
            s2: [[n("C3", W)]],
        },
        { s1: [mk(["G4", "A4", "B4", "C5"], Q)], s2: [[n("G2", W)]] },
    ]);
}

// Chords, rests, ties, a grace note, tuplets, and a unison between two voices.
function richNotation() {
    return score([
        // m1: chord, rest, two eighths, quarter
        { s1: [[n(["C4", "E4", "G4"], Q), rest(Q), n("D4", E), n("E4", E), n("F4", Q)]], s2: [[n("C3", W)]] },
        // m2: tied G4 (two quarters), grace note before A4, B4
        {
            s1: [[n("G4", Q, { tie: "start" }), n("G4", Q, { tie: "stop" }),
                  n("B4", 0, { grace: true, type: "eighth" }), n("A4", Q), n("B4", Q)]],
            s2: [mk(["C3", "G2", "C3", "G2"], Q)],
        },
        // m3: two eighth triplets around a quarter
        {
            s1: [[n("C4", 4, { tuplet: { actual: 3, normal: 2, pos: "start" } }),
                  n("D4", 4, { tuplet: { actual: 3, normal: 2 } }),
                  n("E4", 4, { tuplet: { actual: 3, normal: 2, pos: "stop" } }),
                  n("F4", Q),
                  n("G4", 4, { tuplet: { actual: 3, normal: 2, pos: "start" } }),
                  n("A4", 4, { tuplet: { actual: 3, normal: 2 } }),
                  n("B4", 4, { tuplet: { actual: 3, normal: 2, pos: "stop" } }),
                  n("C5", Q)]],
            s2: [[n("C3", W)]],
        },
        // m4: two voices on the right-hand staff; E4 at beat 1 is a unison between the voices
        {
            s1: [mk(["E4", "F4", "G4", "E4"], Q), [n("E4", H), n("C4", H)]],
            s2: [[n("C3", W)]],
        },
    ]);
}

// 8 measures of quarter notes, both hands, for selection tests.
function eightMeasures() {
    const rh = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
    const lh = ["C3", "G2", "E3", "G2", "C3", "D3", "E3", "D3"];
    const ms = [];
    for (let m = 0; m < 8; m++) {
        const pick = (arr) => [0, 1, 2, 3].map(i => arr[(m * 3 + i) % 8]);
        ms.push({ s1: [mk(pick(rh), Q)], s2: [mk(pick(lh), Q)] });
    }
    return score(ms);
}

// Notes 3 and 4 of the right-hand voice are displayed on the left-hand staff (cross-staff).
function crossStaff() {
    return score([{
        s1: [[n("C4", Q), n("B3", Q, { staff: 2 }), n("A3", Q, { staff: 2 }), n("C4", Q)]],
        s2: [[n("C3", W)]],
    }]);
}

function restsOnly() {
    return score([{ s1: [[rest(W)]], s2: [[rest(W)]] }, { s1: [[rest(W)]], s2: [[rest(W)]] }]);
}

function withPercussion() {
    return score([
        { s1: [mk(["C4", "D4", "E4", "F4"], Q)], s2: [[n("C3", W)]] },
        { s1: [mk(["G4", "A4", "B4", "C5"], Q)], s2: [[n("G2", W)]] },
    ], { percussion: true });
}

// Larger score: 64 measures, 16th notes in the RH and eighth notes in the LH (1536 notes).
// A seeded random walk keeps it deterministic and playable.
function stress() {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const names = ["C", "D", "E", "F", "G", "A", "B"];
    const nameOf = step => names[step % 7] + Math.floor(step / 7);   // step = diatonic steps above C0
    const walk = (cur, lo, hi) => {
        const move = Math.round((rnd() - 0.5) * 4) || 1;
        return Math.min(hi, Math.max(lo, cur + move));
    };
    let rh = 35, lh = 21;   // C5 and C3
    const ms = [];
    for (let m = 0; m < 64; m++) {
        const r = [], l = [];
        for (let i = 0; i < 16; i++) { rh = walk(rh, 28, 41); r.push(n(nameOf(rh), S)); }   // C4..B5
        for (let i = 0; i < 8; i++) { lh = walk(lh, 14, 27); l.push(n(nameOf(lh), E)); }    // C2..B3
        ms.push({ s1: [r], s2: [l] });
    }
    return score(ms);
}

// Repeated-note pedal (after Tchaikovsky, Morning Prayer op. 39 no. 1, bars 16-21): a G2 pedal
// in eighth notes (voice 6) under a held / moving voice (voice 5), with a simple right hand.
function repeatedPedal() {
    const pedal = () => mk(Array(8).fill("G2"), E);
    return score([
        { s1: [mk(["G4", "B4", "A4", "G4"], Q)], s2: [[n("D3", H), n("Eb3", H)], pedal()] },
        { s1: [mk(["C5", "B4", "A4", "G4"], Q)], s2: [[n("D3", Q), n("C3", Q), n("B2", H)], pedal()] },
        { s1: [mk(["G4", "B4", "A4", "G4"], Q)], s2: [[n("D3", H), n("Eb3", H)], pedal()] },
        { s1: [mk(["F#4", "A4", "G4", "D4"], Q)], s2: [[n("Bb2", H), n("A2", H)], pedal()] },
    ]);
}

module.exports = {
    repeatedPedal: repeatedPedal,
    scale4: scale4, scaleWithAnchor: scaleWithAnchor, existingFingerings: existingFingerings, richNotation: richNotation,
    eightMeasures: eightMeasures, crossStaff: crossStaff, restsOnly: restsOnly,
    withPercussion: withPercussion, stress: stress,
};
