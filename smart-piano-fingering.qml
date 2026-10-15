//=============================================================================
//  MuseScore
//  Music Composition & Notation
//
//  Smart Piano Fingering Plugin
//
//  Copyright (C) 2026 Emanuele Merlo (emanuele.merlo@gmail.com)
//  SPDX-License-Identifier: GPL-3.0-only
//
//  This file is part of Smart Piano Fingering. It is distributed under the
//  GNU General Public License version 3 only. See the LICENSE file in the
//  repository root for the complete license text.
//  This program comes with ABSOLUTELY NO WARRANTY.
//
//  The fingering algorithm was originally derived from PianoPlayer by Marco Musy
//  (MIT License) and has since been substantially modified and extended.
//
//=============================================================================

import QtQuick 2.9
import QtQuick.Controls 2.2
import QtQuick.Layouts 1.3
import MuseScore 3.0

MuseScore {
    version: "2.0.0"
    description: qsTr("Inserts piano fingering (1-5) for the right and left hand into the open score.")
    menuPath: "Plugins.SmartPianoFingering"   // MuseScore 3 only; ignored by MuseScore 4
    title: "Smart Piano Fingering"
    categoryCode: "Piano fingering"
    thumbnailName: "smart-piano-fingering.png"
    pluginType: "dialog"
    requiresScore: true
    width: 400
    height: 400

    Component.onCompleted: {
        if (mscoreMajorVersion > 4 || (mscoreMajorVersion === 4 && mscoreMinorVersion >= 4)) {
            title = qsTr("Smart Piano Fingering");
            categoryCode = "composing-arranging-tools";
        }
    }

    property var handSizes: ["XXS", "XS", "S", "M", "L", "XL", "XXL"]
    property bool hasSelection: false
    property bool busy: false
    property bool cancelRequested: false
    property var runCtx: null

    // Dynamic SystemPalette: adapts colors to MuseScore's active theme (Light/Dark)
    SystemPalette {
        id: activePalette
        colorGroup: SystemPalette.Active
    }

    SystemPalette {
        id: disabledPalette
        colorGroup: SystemPalette.Disabled
    }

    // Keep "Selection only" in sync when the (non-modal) dialog stays open
    onScoreStateChanged: {
        if (state && state.selectionChanged) { hasSelection = selectionRange() !== null; }
    }

    function selectionRange() {
        try {
            var sel = curScore.selection;
            if (sel && sel.isRange && sel.startSegment) {
                var to = sel.endSegment ? sel.endSegment.tick : 0x7fffffff;
                var n = curScore.nstaves;
                var sFrom = (sel.startStaff !== undefined) ? sel.startStaff : 0;
                var sTo = (sel.endStaff !== undefined) ? sel.endStaff : n;
                return { from: sel.startSegment.tick, to: to, staffFrom: sFrom, staffTo: sTo };
            }
        } catch (e) { }
        return null;
    }

    onRun: {
        var n = curScore ? curScore.nstaves : 0;
        rhStaff.to = Math.max(1, n);
        lhStaff.to = n;
        lhStaff.value = n >= 2 ? 2 : 0;
        hasSelection = selectionRange() !== null;
        onlySelection.checked = hasSelection;
        status.text = n === 0 ? qsTr("No open score found.") : qsTr("Staves in score: ") + n;
    }

    // ---------------------------------------------------------------- run control
    // The calculation runs in short slices driven by a Timer so that the dialog stays responsive,
    // shows progress and can be stopped. Nothing is written to the score until all slices are done.

    Timer {
        id: worker
        interval: 1
        repeat: true
        running: false
        onTriggered: runSlice()
    }

    function failRun(err) {
        worker.stop();
        if (runCtx) {
            for (var j = 0; j < runCtx.jobs.length; j++) {
                try { runCtx.jobs[j].gen.finish(); } catch (e) { }
            }
        }
        runCtx = null;
        busy = false;
        status.text = qsTr("Error: ") + err;
        console.log("SmartPianoFingering error: " + err + (err && err.stack ? "\n" + err.stack : ""));
    }

    function applyFingering() {
        if (busy) { return; }
        if (!curScore) { status.text = qsTr("No open score found."); return; }
        try {
            var core = createSmartPianoFingeringCore();
            var adapter = createMuseScoreAdapter({
                score: curScore, Element: Element, Cursor: Cursor,
                division: division, newElement: newElement
            });
            var size = handSizes[sizeBox.currentIndex];
            var keep = keepExisting.checked;
            var div = division > 0 ? division : 480;

            var range = null;
            if (onlySelection.checked) {
                range = selectionRange();   // re-read now: the dialog is non-modal
                if (!range) { status.text = qsTr("No range selection found."); return; }
            }

            var hands = [["right", rhStaff.value - 1], ["left", lhStaff.value - 1]];
            var targets = [];
            var notes = [];
            for (var h = 0; h < hands.length; h++) {
                var idx = hands[h][1];
                if (idx < 0) { continue; }
                if (h === 1 && idx === hands[0][1]) { continue; }
                if (range && (idx < range.staffFrom || idx >= range.staffTo)) {
                    notes.push(qsTr("staff ") + (idx + 1) + qsTr(" is outside the selection"));
                    continue;
                }
                if (!adapter.isPitchedStaff(idx)) {
                    notes.push(qsTr("staff ") + (idx + 1) + qsTr(" is a percussion staff"));
                    continue;
                }
                targets.push({ side: hands[h][0], idx: idx });
            }
            if (!targets.length) {
                status.text = qsTr("Nothing to do") + (notes.length ? " (" + notes.join("; ") + ")" : "") + ".";
                return;
            }

            // With a selection, only the selected region plus some musical context is processed.
            var win = null;
            if (range) {
                var margin = 12 * div;
                win = { from: Math.max(0, range.from - margin), to: range.to + margin };
            }

            var staffList = [];
            for (var t = 0; t < targets.length; t++) { staffList.push(targets[t].idx); }
            var data = adapter.readStaves(staffList, keep, win);

            var jobs = [];
            var total = 0;
            for (var k = 0; k < targets.length; k++) {
                var d = data[targets[k].idx];
                if (!d || !d.items.length) { continue; }
                var seq = core.buildSequence(d.items, 0.05);
                // createGenerator runs the musical analysis of the whole staff once (cached on the notes).
                jobs.push({ seq: seq, refs: d.refs, gen: core.createGenerator(seq, targets[k].side, size) });
                total += seq.length;
            }
            if (!jobs.length) { status.text = qsTr("No notes found."); return; }

            runCtx = { adapter: adapter, keep: keep, range: range, jobs: jobs,
                       jobIndex: 0, done: 0, total: total, notes: notes };
            cancelRequested = false;
            progress.value = 0;
            status.text = qsTr("Calculating...");
            busy = true;
            worker.start();
        } catch (err) {
            failRun(err);
        }
    }

    function runSlice() {
        if (!runCtx) { worker.stop(); return; }
        try {
            if (cancelRequested) {
                failRun(qsTr("stopped by user"));
                status.text = qsTr("Stopped. Nothing was written.");
                return;
            }
            var t0 = Date.now();
            while (Date.now() - t0 < 30) {
                var job = runCtx.jobs[runCtx.jobIndex];
                if (!job) { break; }
                if (!job.gen.step()) { runCtx.jobIndex++; }
                runCtx.done++;
            }
            progress.value = runCtx.total > 0 ? runCtx.done / runCtx.total : 1;
            if (runCtx.jobIndex >= runCtx.jobs.length) {
                worker.stop();
                commitRun();
            }
        } catch (err) {
            failRun(err);
        }
    }

    // Warnings that mean "the result needs a human look": an existing fingering that contradicts a
    // held finger or the previous finger, a chord wider than the hand, held notes released.
    function countConflicts(warnings) {
        var c = 0;
        if (!warnings) { return 0; }
        for (var i = 0; i < warnings.length; i++) {
            var w = warnings[i].reason;
            if (w === "anchor-held" || w === "anchor-transition" || w === "span-relaxed" ||
                w === "held-released" || w === "transition") { c++; }
        }
        return c;
    }

    function commitRun() {
        var ctx = runCtx;
        var written = 0, skipped = 0;
        var cmdOpen = false;
        try {
            curScore.startCmd();
            cmdOpen = true;
            var conflicts = 0;
            for (var j = 0; j < ctx.jobs.length; j++) {
                var r = ctx.adapter.writeFingerings(ctx.jobs[j].seq, ctx.jobs[j].refs, ctx.keep, ctx.range);
                written += r.written;
                skipped += r.skipped;
                conflicts += countConflicts(ctx.jobs[j].gen.warnings);
            }
            curScore.endCmd();
            cmdOpen = false;
        } catch (err) {
            if (cmdOpen) { try { curScore.endCmd(true); } catch (e2) { } }
            failRun(err);
            return;
        }
        var msg = qsTr("Done: ") + written + qsTr(" fingerings inserted (undo with Ctrl+Z).");
        if (skipped > 0) { msg += " " + skipped + qsTr(" note(s) with custom fingerings left untouched."); }
        if (conflicts > 0) {
            msg += " " + conflicts + qsTr(" place(s) could not satisfy every physical constraint (existing fingering, held note or chord too wide): please check them.");
        }
        if (ctx.notes.length) { msg += " (" + ctx.notes.join("; ") + ")"; }
        runCtx = null;
        busy = false;
        status.text = msg;
    }

    Rectangle {
        anchors.fill: parent
        color: activePalette.window // Use the active theme's window background

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Label { 
                text: qsTr("Smart Piano Fingering");
                font.bold: true; 
                font.pixelSize: 16; 
                color: activePalette.windowText 
            }

            GridLayout {
                columns: 2
                columnSpacing: 12
                rowSpacing: 8
                Layout.fillWidth: true

                Label { text: qsTr("Right hand: staff"); color: activePalette.windowText }
                SpinBox { id: rhStaff; from: 1; to: 2; value: 1; editable: true }

                Label { text: qsTr("Left hand: staff (0 = none)"); color: activePalette.windowText }
                SpinBox { id: lhStaff; from: 0; to: 2; value: 2; editable: true }

                Label { text: qsTr("Hand size"); color: activePalette.windowText }
                ComboBox { id: sizeBox; model: handSizes; currentIndex: 3 }
            }

			CheckBox {
                id: keepExisting
                text: qsTr("Keep existing fingerings")
                checked: true
                contentItem: Text {
                    text: keepExisting.text
                    color: activePalette.windowText
                    leftPadding: keepExisting.indicator.width + keepExisting.spacing
                    verticalAlignment: Text.AlignVCenter
                }
            }
            CheckBox {
                id: onlySelection
                text: qsTr("Selection only")
                enabled: hasSelection
                contentItem: Text {
                    text: onlySelection.text
                    color: onlySelection.enabled ? activePalette.windowText : disabledPalette.text
                    leftPadding: onlySelection.indicator.width + onlySelection.spacing
                    verticalAlignment: Text.AlignVCenter
                }
            }

            Label {
                id: status
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                color: activePalette.windowText
                text: ""
            }

            ProgressBar {
                id: progress
                Layout.fillWidth: true
                from: 0; to: 1; value: 0
                visible: busy
            }

            Item { Layout.fillHeight: true }

            RowLayout {
                Layout.alignment: Qt.AlignRight
                spacing: 8
                Button { text: qsTr("Stop"); visible: busy; onClicked: cancelRequested = true }
                Button { text: qsTr("Close"); onClicked: quit() }
                Button { text: qsTr("Apply"); enabled: !busy; highlighted: true; onClicked: applyFingering() }
            }
        }
    }

    // ---------------------------------------------------------------- embedded JavaScript
    // Smart Piano Fingering core (algorithm version 2: hybrid musical + biomechanical)
    //
    // The core is plain ES5 JavaScript (no let/const/arrow functions) so that it runs in the QML
    // JavaScript engine of MuseScore 4 and, unchanged, in Node for the automated tests.

    function createSmartPianoFingeringCore() {
        // =========================================================================================
        //  ARCHITECTURE
        //
        //  The fingering is computed in four layers:
        //
        //   A. MUSICAL ANALYSIS (analyzeSequence, run ONCE per staff, before the search; results are
        //      cached on the notes). The sequence is split into "lines" (successions of single notes)
        //      and chord groups. Lines are scanned for: diatonic scales (major and the three minor
        //      forms), chromatic runs, pentatonic runs, five-finger positions, arpeggios, broken
        //      chords (Alberti and similar), repeated notes and leaps. Every recognised pattern
        //      proposes a finger for each of its notes together with a CONFIDENCE in [0, 1].
        //
        //   B. PIANISTIC RULES -> CONSTRAINTS AND PENALTIES (buildUnaryCosts)
        //        confidence >= highConfidence : interior notes of the pattern are LOCKED to the
        //                                       canonical finger (hard constraint of the first
        //                                       search profile, relaxed only if infeasible);
        //        minConfidence <= c < high    : soft penalty for deviating, proportional to c;
        //        c < minConfidence            : the pattern is ignored (generic engine).
        //      Context-dependent black-key penalties and melodic penalties are added as per-note
        //      ("unary") costs, cached in note.uc[1..5].
        //
        //   C. SEARCH (planWindow -> searchDP / searchDFS). Receding-horizon optimisation over a
        //      window of up to MAX_DEPTH notes PLUS the previous note, whose finger is already fixed.
        //      Because the previous note belongs to the window, every transition of the final result
        //      has been evaluated by the search; chord members are planned together and committed
        //      atomically, so no post-processing step can invalidate the optimum (version 1 used
        //      enforceChordConsistency() after the search, which could leave transitions that had
        //      never been costed).
        //
        //   D. BIOMECHANICS (transitionCost: the original geometric model of finger rest positions,
        //      key distance, time and finger strength). It chooses among musically acceptable
        //      candidates; it is replaced by dedicated models for thumb passages, repeated notes
        //      and leaps, where pure key distance gives musically wrong answers.
        //
        //  HARD CONSTRAINTS (skip(), forbidden fingers, options of the search):
        //   H1 notes of one chord: distinct fingers, ordered with pitch (RH 1..5 low->high,
        //      LH 5..1), finger-pair spans within THRESHOLDS scaled by the hand size;
        //   H2 a finger holding a sounding note cannot play another key (forbiddenFingers, heldPairs);
        //   H3 the same finger on two different keys in a legato succession (allowed on leaps,
        //      staccato notes and long notes, where the finger has time to lift and move);
        //   H4 crossing of two long fingers (e.g. 3 over 4) in a succession (allowed on leaps);
        //   H5 user anchors (existing plain fingerings) - never changed on the note itself; inside
        //      the look-ahead they are relaxed only when no solution exists;
        //   H6 locks of high-confidence patterns (first profile only).
        //  When no solution satisfies them, constraints are relaxed in a fixed order
        //  (H6 -> H5 look-ahead -> span -> long held notes -> all held notes) and the relaxation is
        //  reported in the generator's warnings.
        //
        //  SOFT COSTS (all coefficients in DEFAULT_PARAMS, overridable through options.params):
        //      totalCost = sum over transitions of
        //            biomechanical cost (transitionCost)       ordinary in-position movement
        //          | crossingCost                              thumb under / finger over the thumb
        //          | repetitionCost                            same key played again
        //          | leapCost                                  hand repositioning
        //        + sum over notes of the unary cost note.uc[f] =
        //            pattern deviation (scale / arpeggio / chromatic / pentatonic / chord /
        //                               five-finger / broken chord), weighted by confidence
        //          + context-dependent black-key penalty
        //          + melodic penalty (5th finger inside a line)
        // =========================================================================================

        var SIZE_FACTORS = { XXS: 0.33, XS: 0.46, S: 0.64, M: 0.82, L: 1.0, XL: 1.1, XXL: 1.2 };
        // Hand factor of the "M" preset. Semitone limits in this file are stated for an M hand and
        // multiplied by sizeScale = hf / REF_HF for other sizes.
        var REF_HF = 0.82;
        var OCTAVE_CM = 16.5;
        var WHITE_KEY_CM = OCTAVE_CM / 7.0;
        var PITCHCLASS_LAYOUT = [0.5, 1.0, 1.5, 2.0, 2.5, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5];
        var FINGERS = [1, 2, 3, 4, 5];
        var MAX_DEPTH = 9;           // notes looked at after the current one (as in version 1)
        // Maximum span (cm, M hand after the 0.8/hf normalisation) between two fingers of a chord.
        var THRESHOLDS = {
            "3,4": 5, "4,5": 5, "2,3": 6, "2,4": 7, "3,5": 8,
            "2,5": 11, "1,2": 12, "1,3": 14, "1,4": 16, "1,5": 17
        };
        var BLACK_PC = [false, true, false, true, false, false, true, false, true, false, true, false];

        // -----------------------------------------------------------------------------------------
        //  PARAMETERS
        //  Every value is EMPIRICAL (calibrated on the reference suite in tests/), except where a
        //  comment says CANONICAL. Costs are in the same unit as transitionCost(), where moving one
        //  finger to the neighbouring white key in an eighth note costs about 0.1-2.
        // -----------------------------------------------------------------------------------------
        var DEFAULT_PARAMS = {
            // Confidence thresholds (spec section 17).
            highConfidence: 0.8,   // pattern becomes a hard (relaxable) constraint
            minConfidence: 0.5,    // below this the pattern is ignored

            // Global weights of the cost families.
            wBio: 1.0, wCross: 1.0, wRepeat: 1.0, wLeap: 1.0,
            wPattern: 1.0, wBlack: 1.0, wMelodic: 1.0,

            // Cost of NOT using the finger proposed by a pattern, multiplied by its confidence.
            // Scales are the most codified fingerings of piano technique, then arpeggios; chord
            // shapes and five-finger positions are only habits and are kept weak.
            patternDev: { scale: 25, arpeggio: 18, chromatic: 12, pentatonic: 10, chord: 8, five: 6, broken: 6 },
            // A finger listed by the pattern as an accepted variant costs this fraction of patternDev.
            altFactor: 0.25,

            // Black-key penalty by musical context, indexed by finger (index 0 unused).
            // Thumb and fifth finger are short and sit low; on a black key they force the hand forward.
            // In scales and chromatic runs this breaks the evenness of the passage (strong penalty);
            // in chords, arpeggios on black-key triads and five-finger positions on black keys it is
            // normal technique (weak penalty). Fingers 2, 3 and 4 are never penalised on black keys.
            blackKey: {
                scale:      [0, 12, 0, 0, 0, 6],
                pentatonic: [0, 8, 0, 0, 0, 4],
                chromatic:  [0, 8, 0, 0, 0, 4],
                arpeggio:   [0, 6, 0, 0, 0, 2],
                five:       [0, 2, 0, 0, 0, 1],
                chord:      [0, 2, 0, 0, 0, 1],
                broken:     [0, 3, 0, 0, 0, 1],
                leap:       [0, 3, 0, 0, 0, 1],
                repeat:     [0, 3, 0, 0, 0, 2],
                free:       [0, 5, 0, 0, 0, 3]
            },

            // Thumb passage (thumb under a finger / finger over the thumb), by crossing finger.
            // 3 and 4 are the standard crossing fingers; 2 is used for short distances (it cramps the
            // hand); crossing with 5 is not part of legato technique.
            crossBase: [0, 0, 4.0, 3.0, 3.5, 15.0],
            crossReach: [0, 0, 2, 4, 5, 2],   // semitones crossed comfortably (M hand)
            crossStretch: 2.5,                // per semitone beyond crossReach
            crossThumbBlack: 8.0,             // thumb lands on / leaves a black key, other finger on white
            crossBothBlack: 3.0,              // both keys black (black-key arpeggios, pentatonics)
            crossBlackBonus: 0.5,             // finger on black, thumb on white: the classic easy passage
            crossSpeed: 0.3,                  // extra difficulty at short inter-onset times

            // Repeated notes. Fast repetitions are played by changing fingers (3-2-1, 4-3-2-1, 2-1);
            // slow repetitions keep the finger.
            repSame: 6.0, repChange: 1.5, repOrder: 0.8, repSpread: 0.5,
            repFifth: 1.0,      // the 5th finger is too weak for repeated-note articulation
            repFastIOI: 0.25,   // inter-onset interval (beats) at or below which a repetition is "fast"
            repSlowIOI: 0.75,   // at or above which it is "slow"

            // Leaps: beyond leapSemis (M hand) the hand must be repositioned; distance between fingers
            // no longer matters and the landing finger is chosen by what follows.
            leapSemis: 12, leapBase: 2.0, leapSpeed: 0.3, leapSameFinger: 0.2,

            // 5th finger on a note inside a line (not a local extreme of the melody).
            fifthInterior: 2.0,

            // Movement cost multiplier for transitions that follow a recognised pattern.
            trainedFactor: 0.4,
            // Legato crossing of two long fingers between a chord and the next note.
            chordCrossing: 6.0,
            // Weight of the geometric spread cost between members of one chord (see stepCost).
            chordSpreadWeight: 0.4,

            lineGap: 1.0,          // a rest longer than this (beats) splits a line
            chordLookahead: 3,     // notes after a chord included in its search window
            heldReleaseBeats: 2.0  // notes held longer than this may be released if nothing else works
        };

        function mergeParams(over) {
            var p = {}, k, j;
            for (k in DEFAULT_PARAMS) {
                if (!DEFAULT_PARAMS.hasOwnProperty(k)) { continue; }
                var v = DEFAULT_PARAMS[k];
                if (v && typeof v === "object" && !(v instanceof Array)) {
                    p[k] = {};
                    for (j in v) { if (v.hasOwnProperty(j)) { p[k][j] = v[j]; } }
                } else {
                    p[k] = v;
                }
            }
            if (over) {
                for (k in over) {
                    if (!over.hasOwnProperty(k)) { continue; }
                    if (p[k] && typeof p[k] === "object" && !(p[k] instanceof Array) && typeof over[k] === "object") {
                        for (j in over[k]) { if (over[k].hasOwnProperty(j)) { p[k][j] = over[k][j]; } }
                    } else {
                        p[k] = over[k];
                    }
                }
            }
            return p;
        }

        // ------------------------------------------------------------------ geometry
        function pcOf(midi) { return ((Math.round(midi) % 12) + 12) % 12; }

        function keyPosition(midi) {
            var m = Math.round(midi);
            var octave = Math.floor(m / 12);
            var pc = ((m % 12) + 12) % 12;
            return OCTAVE_CM * (octave - 1) + PITCHCLASS_LAYOUT[pc] * WHITE_KEY_CM;
        }

        function isBlackKey(midi) { return BLACK_PC[pcOf(midi)]; }

        function makeHand(side, size, options) {
            var hf = SIZE_FACTORS[size] !== undefined ? SIZE_FACTORS[size] : SIZE_FACTORS.M;
            var frest = [null, -7.0, -2.8, 0.0, 2.8, 5.6];
            for (var i = 1; i <= 5; i++) {
                if (frest[i]) { frest[i] *= hf; }
            }
            return {
                side: side,
                hf: hf,
                sizeScale: hf / REF_HF,
                frest: frest,
                weights: [null, 1.1, 1.0, 1.1, 0.9, 0.8],
                bfactor: [null, 0.3, 1.0, 1.1, 0.8, 0.7],
                params: mergeParams(options && options.params),
                context: []
            };
        }

        // =========================================================================================
        //  MUSICAL KNOWLEDGE
        // =========================================================================================

        // ---- Scales -------------------------------------------------------------------------------
        // CANONICAL one-octave fingerings (tonic to tonic, ascending), as printed in the standard
        // method books (Hanon, ABRSM, Czerny school), indexed by the pitch class of the tonic.
        // In the standard system each scale degree keeps its finger in both directions; what
        // changes with direction is the mechanics of the passage (thumb UNDER ascending in the RH /
        // descending in the LH, finger OVER the thumb in the other direction) and the outer
        // extreme. The DESCENDING tables are therefore derived explicitly (scaleTable) and are
        // tested separately; the melodic minor is the case where they really differ (raised 6th and
        // 7th ascending, natural form descending).
        var MAJOR_TABLE = {
            right: [
                [1, 2, 3, 1, 2, 3, 4, 5],  // C
                [2, 3, 1, 2, 3, 4, 1, 2],  // Db / C#
                [1, 2, 3, 1, 2, 3, 4, 5],  // D
                [3, 1, 2, 3, 4, 1, 2, 3],  // Eb
                [1, 2, 3, 1, 2, 3, 4, 5],  // E
                [1, 2, 3, 4, 1, 2, 3, 4],  // F
                [2, 3, 4, 1, 2, 3, 1, 2],  // Gb / F#
                [1, 2, 3, 1, 2, 3, 4, 5],  // G
                [3, 4, 1, 2, 3, 1, 2, 3],  // Ab
                [1, 2, 3, 1, 2, 3, 4, 5],  // A
                [4, 1, 2, 3, 1, 2, 3, 4],  // Bb
                [1, 2, 3, 1, 2, 3, 4, 5]   // B
            ],
            left: [
                [5, 4, 3, 2, 1, 3, 2, 1],  // C
                [3, 2, 1, 4, 3, 2, 1, 3],  // Db
                [5, 4, 3, 2, 1, 3, 2, 1],  // D
                [3, 2, 1, 4, 3, 2, 1, 3],  // Eb
                [5, 4, 3, 2, 1, 3, 2, 1],  // E
                [5, 4, 3, 2, 1, 3, 2, 1],  // F
                [4, 3, 2, 1, 3, 2, 1, 4],  // Gb / F#
                [5, 4, 3, 2, 1, 3, 2, 1],  // G
                [3, 2, 1, 4, 3, 2, 1, 3],  // Ab
                [5, 4, 3, 2, 1, 3, 2, 1],  // A
                [3, 2, 1, 4, 3, 2, 1, 3],  // Bb
                [4, 3, 2, 1, 4, 3, 2, 1]   // B
            ]
        };
        // CANONICAL harmonic minor fingerings, indexed by the pitch class of the minor tonic.
        var HARMONIC_TABLE = {
            right: [
                [1, 2, 3, 1, 2, 3, 4, 5],  // c
                [3, 4, 1, 2, 3, 1, 2, 3],  // c#
                [1, 2, 3, 1, 2, 3, 4, 5],  // d
                [3, 1, 2, 3, 4, 1, 2, 3],  // eb / d#
                [1, 2, 3, 1, 2, 3, 4, 5],  // e
                [1, 2, 3, 4, 1, 2, 3, 4],  // f
                [3, 4, 1, 2, 3, 1, 2, 3],  // f#
                [1, 2, 3, 1, 2, 3, 4, 5],  // g
                [3, 4, 1, 2, 3, 1, 2, 3],  // g#
                [1, 2, 3, 1, 2, 3, 4, 5],  // a
                [4, 1, 2, 3, 1, 2, 3, 4],  // bb
                [1, 2, 3, 1, 2, 3, 4, 5]   // b
            ],
            left: [
                [5, 4, 3, 2, 1, 3, 2, 1],  // c
                [3, 2, 1, 4, 3, 2, 1, 3],  // c#
                [5, 4, 3, 2, 1, 3, 2, 1],  // d
                [2, 1, 4, 3, 2, 1, 3, 2],  // eb / d#
                [5, 4, 3, 2, 1, 3, 2, 1],  // e
                [5, 4, 3, 2, 1, 3, 2, 1],  // f
                [4, 3, 2, 1, 3, 2, 1, 4],  // f#
                [5, 4, 3, 2, 1, 3, 2, 1],  // g
                [3, 2, 1, 3, 2, 1, 4, 3],  // g#
                [5, 4, 3, 2, 1, 3, 2, 1],  // a
                [2, 1, 3, 2, 1, 4, 3, 2],  // bb
                [4, 3, 2, 1, 4, 3, 2, 1]   // b
            ]
        };
        var FORMS = {
            major:    [0, 2, 4, 5, 7, 9, 11],
            harmonic: [0, 2, 3, 5, 7, 8, 11],
            melodic:  [0, 2, 3, 5, 7, 9, 11],   // ascending form
            natural:  [0, 2, 3, 5, 7, 8, 10]    // also the descending melodic minor
        };
        var FORM_NAMES = { major: "major", harmonic: "harmonic minor", melodic: "melodic minor", natural: "natural minor" };
        var PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
        // Key signatures (number of sharps > 0 / flats < 0) of each MAJOR tonic.
        var MAJOR_SIGS = [[0], [7, -5], [2], [-3], [4], [-1], [6, -6], [1], [-4], [3], [-2], [5, -7]];

        // Cyclic finger of every pitch class of a scale (0 = not in the scale), from an 8-note table.
        // RH: degree 0 takes table[0] (the thumb side is the start); table[7] is the top extreme.
        // LH: degree 0 takes table[7] (the thumb side is the top); table[0] is the bottom extreme.
        function cyclicFromTable(tonic, steps, table, side) {
            var cyc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (var d = 0; d < steps.length; d++) {
                var pc = (tonic + steps[d]) % 12;
                cyc[pc] = side === "right" ? table[d] : (d === 0 ? table[7] : table[d]);
            }
            return cyc;
        }

        // RULE-BASED generator of a cyclic scale fingering, used where no canonical table exists
        // (natural / melodic minor when the harmonic fingering would put a thumb on a black key,
        // pentatonic scales). It encodes the principles from which the canonical tables are built:
        //  - the fingers form groups (1-2-3 and 1-2-3-4 for 7-note scales; 1-2 and 1-2-3 for
        //    pentatonic scales) separated by thumb passages;
        //  - the thumb plays white keys (hard, unless the scale has no white key);
        //  - the thumb passage is easiest from a black key (RH: thumb after a black key ascending;
        //    LH: thumb before a black key ascending) (+2 per thumb);
        //  - the 4th finger preferably lies on a black key (+1);
        //  - a white tonic is preferably taken by the thumb (+3).
        // tests/ checks how many of the 48 canonical tables it reproduces (it is not used for them).
        function generateCyclic(tonic, steps, side, groupSizes) {
            var N = steps.length;
            var pcs = [];
            var i;
            for (i = 0; i < N; i++) { pcs.push((tonic + steps[i]) % 12); }
            var anyWhite = false;
            for (i = 0; i < N; i++) { if (!BLACK_PC[pcs[i]]) { anyWhite = true; } }
            var best = null, bestScore = -Infinity;

            function evaluate(sizes) {
                for (var o = 0; o < N; o++) {
                    var f = [];
                    var thumbs = [];
                    var k, pos = o;
                    for (k = 0; k < N; k++) { f.push(0); }
                    for (var g = 0; g < sizes.length; g++) {
                        var s = sizes[g];
                        for (k = 0; k < s; k++) {
                            f[(pos + k) % N] = side === "right" ? k + 1 : s - k;
                        }
                        thumbs.push(side === "right" ? pos % N : (pos + s - 1) % N);
                        pos += s;
                    }
                    var score = 0, ok = true;
                    for (k = 0; k < thumbs.length; k++) {
                        var t = thumbs[k];
                        if (BLACK_PC[pcs[t]]) {
                            if (anyWhite) { ok = false; break; }
                            score -= 3;
                        }
                        var neighbour = side === "right" ? pcs[(t - 1 + N) % N] : pcs[(t + 1) % N];
                        if (BLACK_PC[neighbour]) { score += 2; }
                        if (t === 0 && !BLACK_PC[pcs[0]]) { score += 3; }
                    }
                    if (!ok) { continue; }
                    for (k = 0; k < N; k++) { if (f[k] === 4 && BLACK_PC[pcs[k]]) { score += 1; } }
                    if (score > bestScore) { bestScore = score; best = f; }
                }
            }
            function rec(sizes, total) {
                if (total === N) { evaluate(sizes); return; }
                for (var g = 0; g < groupSizes.length; g++) {
                    if (total + groupSizes[g] <= N) { rec(sizes.concat([groupSizes[g]]), total + groupSizes[g]); }
                }
            }
            rec([], 0);
            var cyc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            if (best) { for (i = 0; i < N; i++) { cyc[pcs[i]] = best[i]; } }
            return cyc;
        }

        var scaleCache = {};
        // Cyclic fingering of a diatonic scale. Returns { cyc, source } where source is
        // "canonical" (table), "derived" (harmonic-minor fingering kept on the altered degrees
        // because no thumb falls on a black key) or "generated" (generateCyclic).
        function scaleFingering(tonic, form, side) {
            var key = tonic + ":" + form + ":" + side;
            if (scaleCache[key]) { return scaleCache[key]; }
            var steps = FORMS[form];
            var res;
            if (form === "major") {
                res = { cyc: cyclicFromTable(tonic, steps, MAJOR_TABLE[side][tonic], side), source: "canonical" };
            } else if (form === "harmonic") {
                res = { cyc: cyclicFromTable(tonic, steps, HARMONIC_TABLE[side][tonic], side), source: "canonical" };
            } else {
                // Natural and melodic minor: same finger per degree as the harmonic form, unless an
                // altered degree would then be a black key under the thumb.
                var cyc = cyclicFromTable(tonic, steps, HARMONIC_TABLE[side][tonic], side);
                var bad = false;
                for (var pc = 0; pc < 12; pc++) { if (cyc[pc] === 1 && BLACK_PC[pc]) { bad = true; } }
                res = bad ? { cyc: generateCyclic(tonic, steps, side, [3, 4]), source: "generated" }
                          : { cyc: cyc, source: "derived" };
            }
            scaleCache[key] = res;
            return res;
        }

        // One-octave table (8 notes, tonic to tonic) in the requested direction, for documentation,
        // diagnostics and tests. Descending tables list the fingers from the top tonic downwards.
        function scaleTable(tonic, form, side, direction) {
            var steps = FORMS[form];
            var pitches = [];
            for (var d = 0; d < 7; d++) { pitches.push(60 + tonic + steps[d]); }
            pitches.push(72 + tonic);
            if (direction === "down") { pitches.reverse(); }
            var cyc = scaleFingering(tonic, form, side).cyc;
            return runFingers(pitches, function (pc) { return cyc[pc]; }, side, "scale");
        }

        // Applies a cyclic fingering to a run of pitches and adjusts the OUTER extremes (the top for
        // the RH, the bottom for the LH): where the cycle would put the thumb there, the hand has no
        // further note to pass to, so the next finger of the group is used (C major RH: ...3 4 5 on
        // the top C; F major RH: ...2 3 4 on the top F). Arpeggios always end on the 5th finger.
        // before / after: pitches of the line notes just outside the run (undefined if none): a run
        // end is an extreme only if the melody does not continue beyond it in the same direction.
        function runFingers(pitches, cycFn, side, mode, before, after) {
            var m = pitches.length, f = [], k;
            for (k = 0; k < m; k++) { f.push(cycFn(pcOf(pitches[k]))); }
            if (m < 2) { return f; }
            for (k = 0; k < m; k++) {
                var prevP = k > 0 ? pitches[k - 1] : before, nextP = k < m - 1 ? pitches[k + 1] : after;
                var isTop = (prevP === undefined || prevP < pitches[k]) && (nextP === undefined || nextP < pitches[k]);
                var isBot = (prevP === undefined || prevP > pitches[k]) && (nextP === undefined || nextP > pitches[k]);
                var outer = side === "right" ? isTop : isBot;
                if (outer && f[k] === 1) {
                    if (mode === "arpeggio") {
                        f[k] = 5;
                    } else {
                        var nb = k > 0 ? cycFn(pcOf(pitches[k - 1])) : cycFn(pcOf(pitches[k + 1]));
                        f[k] = Math.min(5, nb + 1);
                    }
                }
            }
            if (mode === "arpeggio") {
                // Start of an arpeggio from the inner side on a black key: the canonical start uses
                // the 2nd finger before the first thumb passage (Db major RH: 2 1 2 4 ...).
                var innerStart = side === "right" ? pitches[1] > pitches[0] : pitches[1] < pitches[0];
                if (innerStart && (f[0] === 3 || f[0] === 4) && f[1] === 1) { f[0] = 2; }
                // ...and symmetrically at the inner end (the descending RH arpeggio ends 4 1 2).
                var innerEnd = side === "right" ? pitches[m - 2] > pitches[m - 1] : pitches[m - 2] < pitches[m - 1];
                if (innerEnd && (f[m - 1] === 3 || f[m - 1] === 4) && f[m - 2] === 1) { f[m - 1] = 2; }
            }
            return f;
        }

        // ---- Chromatic scale ------------------------------------------------------------------------
        // CANONICAL fingering (the "1-3" system): 3 on every black key, thumb on white keys, 2 on the
        // second of two adjacent white keys (RH: F and C; LH: E and B), identical in both directions.
        function chromaticFinger(pc, side) {
            if (BLACK_PC[pc]) { return 3; }
            if (side === "right") { return (pc === 5 || pc === 0) ? 2 : 1; }
            return (pc === 4 || pc === 11) ? 2 : 1;
        }

        // ---- Chords and arpeggios ------------------------------------------------------------------
        var CHORD_QUALITIES = [
            { name: "major", iv: [0, 4, 7] }, { name: "minor", iv: [0, 3, 7] },
            { name: "diminished", iv: [0, 3, 6] }, { name: "augmented", iv: [0, 4, 8] },
            { name: "dominant 7th", iv: [0, 4, 7, 10] }, { name: "major 7th", iv: [0, 4, 7, 11] },
            { name: "minor 7th", iv: [0, 3, 7, 10] }, { name: "diminished 7th", iv: [0, 3, 6, 9] },
            { name: "half-diminished 7th", iv: [0, 3, 6, 10] }
        ];
        var CHORDS = [];
        (function () {
            for (var r = 0; r < 12; r++) {
                for (var q = 0; q < CHORD_QUALITIES.length; q++) {
                    var mask = 0, pcs = [];
                    for (var k = 0; k < CHORD_QUALITIES[q].iv.length; k++) {
                        var pc = (r + CHORD_QUALITIES[q].iv[k]) % 12;
                        mask |= (1 << pc);
                        pcs.push(pc);
                    }
                    CHORDS.push({ root: r, quality: CHORD_QUALITIES[q].name, mask: mask, size: pcs.length,
                                  pcs: pcs.slice().sort(function (a, b) { return a - b; }) });
                }
            }
        })();

        // Arpeggio cyclic fingering (RULE-BASED, consistent with the canonical C major tables):
        //  - the thumb takes the chord tone on which the arpeggio starts (the inversion), or, when that
        //    tone is black, the next white chord tone above it; if all tones are black the start tone;
        //  - triads: RH thumb, 2, then the crossing finger; LH thumb, crossing finger, 2;
        //    the crossing finger is 4 when the thumb passage spans a third, 3 when it spans a fourth
        //    (C major root position RH 1 2 3 5, LH 5 4 2 1; 1st inversion RH 1 2 4 5, LH 5 4 2 1;
        //    2nd inversion RH 1 2 4 5, LH 5 3 2 1; RH 1 2 3 5 is an accepted variant there);
        //  - seventh chords (4 tones per octave): RH 1 2 3 4, LH 1 4 3 2 from the thumb tone.
        function arpeggioFingering(chordPcs, startPc, side) {
            var tones = chordPcs.slice().sort(function (a, b) { return a - b; });
            var m = tones.length, s = 0, k;
            for (k = 0; k < m; k++) { if (tones[k] === startPc) { s = k; } }
            var rot = [];
            for (k = 0; k < m; k++) { rot.push(tones[(s + k) % m]); }
            var allBlack = true;
            for (k = 0; k < m; k++) { if (!BLACK_PC[rot[k]]) { allBlack = false; } }
            var t = 0;
            if (!allBlack) { while (BLACK_PC[rot[t]]) { t++; } }
            var cyc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            function tone(j) { return rot[(t + j + m) % m]; }
            function iv(a, b) { return (b - a + 12) % 12; }
            if (m === 3) {
                if (side === "right") {
                    cyc[tone(0)] = 1; cyc[tone(1)] = 2;
                    cyc[tone(2)] = iv(tone(2), tone(0)) <= 4 ? 4 : 3;
                } else {
                    cyc[tone(0)] = 1;
                    cyc[tone(1)] = iv(tone(0), tone(1)) <= 4 ? 4 : 3;
                    cyc[tone(2)] = 2;
                }
            } else {
                for (k = 0; k < m; k++) { cyc[tone(k)] = side === "right" ? k + 1 : (k === 0 ? 1 : 5 - k); }
            }
            return { cyc: cyc, allBlack: allBlack };
        }

        // Comfortable span (semitones, M hand) of two fingers of the same hand position.
        var COMFORT = {
            "1,2": [1, 5], "1,3": [3, 7], "1,4": [5, 9], "1,5": [7, 12], "2,3": [1, 3],
            "2,4": [3, 5], "2,5": [4, 8], "3,4": [1, 2], "3,5": [2, 5], "4,5": [1, 3]
        };
        function comfortDev(h, f1, f2, semis) {
            var r = COMFORT[Math.min(f1, f2) + "," + Math.max(f1, f2)];
            if (!r) { return 0; }
            var mx = r[1] * (h ? h.sizeScale : 1);
            if (semis < r[0]) { return r[0] - semis; }
            if (semis > mx) { return semis - mx; }
            return 0;
        }

        function pcsMask(pitches) {
            var m = 0;
            for (var k = 0; k < pitches.length; k++) { m |= (1 << pcOf(pitches[k])); }
            return m;
        }
        function bitCount(x) { var c = 0; while (x) { c += x & 1; x >>= 1; } return c; }

        function identifyChord(pitches) {
            var mask = pcsMask(pitches);
            for (var c = 0; c < CHORDS.length; c++) { if (CHORDS[c].mask === mask) { return CHORDS[c]; } }
            return null;
        }

        // Standard hand shape of simultaneous (or broken) notes, pitches sorted low -> high.
        // Returns { fingers (one per pitch), conf, label } or null when no shape is clearly better.
        //  - Triads within an octave (CANONICAL): RH 1-3-5 / 1-2-5 / 1-3-5 (root, 1st, 2nd
        //    inversion), LH 5-3-1 / 5-3-1 / 5-2-1: the 2nd finger goes to the side of the fourth.
        //  - Other shapes: every increasing finger assignment is scored by how far each adjacent pair
        //    is from its comfortable span (COMFORT, scaled by hand size); 1 and 5 on the outer notes
        //    are preferred when the shape spans a sixth or more; ties give no preference at all.
        function chordShape(pitches, side, h) {
            var k = pitches.length;
            if (k < 2 || k > 5) { return null; }
            var span = pitches[k - 1] - pitches[0];
            var chord = identifyChord(pitches);
            if (k === 3 && span <= 12 && chord && chord.size === 3) {
                var g1 = pitches[1] - pitches[0], g2 = pitches[2] - pitches[1];
                var fing = side === "right" ? [1, g2 >= 5 ? 2 : 3, 5] : [5, g1 >= 5 ? 2 : 3, 1];
                var lim = 12 * (h ? h.sizeScale : 1);
                return { fingers: fing, conf: span <= lim ? 0.75 : 0.55,
                         label: PC_NAMES[chord.root] + " " + chord.quality + " triad" };
            }
            var best = null, bestCost = Infinity, second = Infinity;
            function rec(start, acc) {
                if (acc.length === k) {
                    var f = side === "right" ? acc : acc.slice().reverse();
                    var cost = 0;
                    for (var j = 1; j < k; j++) { cost += comfortDev(h, f[j - 1], f[j], pitches[j] - pitches[j - 1]); }
                    if (span >= 9 && k >= 2) {
                        var lo = side === "right" ? f[0] : f[k - 1], hi = side === "right" ? f[k - 1] : f[0];
                        if (lo !== 1) { cost += 1; }
                        if (hi !== 5) { cost += 1; }
                    }
                    for (j = 0; j < k; j++) { if (f[j] === 4) { cost += 0.2; } }
                    if (cost < bestCost - 1e-9) { second = bestCost; bestCost = cost; best = f.slice(); }
                    else if (cost < second) { second = cost; }
                    return;
                }
                for (var x = start; x <= 5; x++) { rec(x + 1, acc.concat([x])); }
            }
            rec(1, []);
            if (!best || second - bestCost < 0.5) { return null; }
            var label = chord ? PC_NAMES[chord.root] + " " + chord.quality : (k === 2 ? "interval" : "chord");
            return { fingers: best, conf: second - bestCost >= 1 ? 0.6 : 0.5, label: label };
        }

        // =========================================================================================
        //  SEQUENCE BUILDING
        // =========================================================================================
        // raw: [{ pitch, start, end, anchor, id, voice, keySig?, staccato? }] for ONE hand/staff,
        // times in quarter-note beats. Simultaneous notes (chords and voices colliding on the same
        // onset) become chord groups, ordered low->high, each member slightly staggered in time.
        function buildSequence(raw, stagger) {
            var st = stagger === undefined ? 0.05 : Math.max(0, stagger);
            var groups = {};
            var order = [];
            var i;
            for (i = 0; i < raw.length; i++) {
                var key = String(Math.round(raw[i].start * 1e6));
                if (!groups[key]) { groups[key] = []; order.push(key); }
                groups[key].push(raw[i]);
            }
            order.sort(function (a, b) { return Number(a) - Number(b); });

            var seq = [];
            var chordId = 0;
            for (var g = 0; g < order.length; g++) {
                var members = groups[order[g]].slice();
                members.sort(function (a, b) {
                    return (a.pitch - b.pitch) || ((a.voice || 0) - (b.voice || 0)) || (a.id - b.id);
                });
                // Same pitch twice at the same onset (e.g. unison in two voices): keep one.
                // Members are sorted by (pitch, voice), so the primary note is the lowest voice;
                // the others are recorded in dups and receive NO fingering of their own.
                var uniq = [];
                for (i = 0; i < members.length; i++) {
                    var last = uniq.length ? uniq[uniq.length - 1] : null;
                    if (last && last.pitch === members[i].pitch) {
                        if (members[i].end > last.end) { last.end = members[i].end; }
                        last.dups.push(members[i].id);
                        if (!last.anchor && members[i].anchor) { last.anchor = members[i].anchor; }
                    } else {
                        uniq.push({
                            pitch: members[i].pitch, start: members[i].start, end: members[i].end,
                            anchor: members[i].anchor || 0, id: members[i].id, dups: [],
                            keySig: members[i].keySig, staccato: !!members[i].staccato
                        });
                    }
                }
                var count = uniq.length;
                for (var j = 0; j < count; j++) {
                    var u = uniq[j];
                    var chord = count > 1;
                    var base = u.end - u.start;
                    seq.push({
                        id: u.id, dups: u.dups, pitch: u.pitch, x: keyPosition(u.pitch),
                        isBlack: isBlackKey(u.pitch), start: u.start, end: u.end,
                        time: chord ? u.start - st * (count - j - 1) : u.start,
                        duration: chord ? base + st * (count - 1) : base,
                        isChord: chord, chordID: chord ? chordId : 0,
                        chordnr: chord ? j : 0, NinChord: chord ? count : 0,
                        anchor: u.anchor, finger: 0,
                        keySig: u.keySig, staccato: u.staccato
                    });
                }
                if (count > 1) { chordId += 1; }
            }
            return seq;
        }

        // =========================================================================================
        //  LAYER A - MUSICAL ANALYSIS
        // =========================================================================================

        // Is every key strictly between a and b outside the pitch-class mask? (Adjacent degrees.)
        function adjacentIn(mask, a, b) {
            var lo = Math.min(a, b), hi = Math.max(a, b);
            for (var x = lo + 1; x < hi; x++) { if (mask & (1 << pcOf(x))) { return false; } }
            return true;
        }

        var SCALE_CANDS = [];
        (function () {
            var forms = ["major", "harmonic", "melodic", "natural"];
            for (var t = 0; t < 12; t++) {
                for (var f = 0; f < forms.length; f++) {
                    var mask = 0;
                    for (var d = 0; d < 7; d++) { mask |= (1 << ((t + FORMS[forms[f]][d]) % 12)); }
                    var sigs = forms[f] === "major" ? MAJOR_SIGS[t] : MAJOR_SIGS[(t + 3) % 12];
                    SCALE_CANDS.push({ tonic: t, form: forms[f], mask: mask, sigs: sigs,
                                       prior: forms[f] === "major" ? 0.3 : (forms[f] === "harmonic" ? 0.2 : (forms[f] === "melodic" ? 0.15 : 0.1)) });
                }
            }
        })();

        function majorityKeySig(seq, idxs) {
            var counts = {}, best = null, bestN = 0;
            for (var k = 0; k < idxs.length; k++) {
                var s = seq[idxs[k]].keySig;
                if (s === undefined || s === null) { continue; }
                counts[s] = (counts[s] || 0) + 1;
                if (counts[s] > bestN) { bestN = counts[s]; best = s; }
            }
            return best;
        }

        // Evidence that a candidate key is the one in use: tonic at the start/end/bottom of the run,
        // key signature from the score, small prior favouring major and harmonic minor.
        function keyEvidence(cand, pitches, keySig) {
            var ev = cand.prior;
            var m = pitches.length, low = pitches[0];
            for (var k = 1; k < m; k++) { if (pitches[k] < low) { low = pitches[k]; } }
            if (pcOf(pitches[0]) === cand.tonic) { ev += 1.0; }
            if (pcOf(pitches[m - 1]) === cand.tonic) { ev += 1.0; }
            if (pcOf(low) === cand.tonic) { ev += 0.5; }
            if (keySig !== null && keySig !== undefined) {
                for (var s = 0; s < cand.sigs.length; s++) { if (cand.sigs[s] === keySig) { ev += 2.0; } }
            }
            return ev;
        }

        function analyzeSequence(seq, h) {
            var P = h.params, side = h.side, n = seq.length;
            var guides = [];
            var patterns = [];
            var i, k;
            for (i = 0; i < n; i++) {
                guides.push(null);
                seq[i].repLen = 1;
                seq[i].isPeak = false;
                seq[i].isValley = false;
                seq[i].ctx = seq[i].isChord ? "chord" : "free";
            }

            // claim(): a pattern proposes `finger` for note idx. The most confident proposal wins;
            // a note proposed different fingers by two patterns (typically the junction of two
            // patterns) is marked contested and is never locked.
            function claim(idx, finger, conf, kind, opts) {
                if (!(finger >= 1 && finger <= 5) || conf < P.minConfidence) { return; }
                var g = guides[idx];
                var o = opts || {};
                // Only a disagreement between two STRONG patterns blocks the lock: a weak competing
                // reading (e.g. a five-finger window overlapping a scale) does not.
                var clash = !!(g && g.finger !== finger && Math.min(g.conf, conf) >= P.highConfidence);
                if (g) {
                    if (clash) { g.contested = true; }
                    if (g.conf >= conf) { return; }
                }
                guides[idx] = { finger: finger, conf: conf, kind: kind, alts: o.alts || [],
                                lockable: !!o.lockable, allBlack: !!o.allBlack,
                                contested: clash || !!(g && g.contested) };
            }
            function addPattern(kind, label, conf, idxs, fingers, extra) {
                var p = { kind: kind, label: label, conf: Math.round(conf * 100) / 100,
                          from: idxs[0], to: idxs[idxs.length - 1], fingers: fingers.slice(),
                          strength: conf >= P.highConfidence ? "strong" : (conf >= P.minConfidence ? "preference" : "ignored") };
                if (extra) { for (var e in extra) { if (extra.hasOwnProperty(e)) { p[e] = extra[e]; } } }
                patterns.push(p);
            }

            // ---- 1. chord groups: standard shapes as weak preferences (never locked)
            i = 0;
            while (i < n) {
                if (!seq[i].isChord) { i++; continue; }
                var j = i;
                while (j + 1 < n && seq[j + 1].isChord && seq[j + 1].chordID === seq[i].chordID) { j++; }
                var cp = [];
                for (k = i; k <= j; k++) { cp.push(seq[k].pitch); }
                var shape = chordShape(cp, side, h);
                if (shape) {
                    var cidx = [];
                    for (k = i; k <= j; k++) { claim(k, shape.fingers[k - i], shape.conf, "chord"); cidx.push(k); }
                    addPattern("chord", shape.label, shape.conf, cidx, shape.fingers);
                }
                i = j + 1;
            }

            // ---- 2. lines: successions of single notes not separated by long rests
            var lines = [], cur = [];
            for (i = 0; i < n; i++) {
                var nt = seq[i];
                if (nt.isChord) { if (cur.length) { lines.push(cur); } cur = []; continue; }
                if (cur.length) {
                    var pv = seq[cur[cur.length - 1]];
                    if (nt.start - pv.end > P.lineGap || nt.start - pv.start > 4) { lines.push(cur); cur = []; }
                }
                cur.push(i);
            }
            if (cur.length) { lines.push(cur); }


            // Pitches of the line notes just before and after a run (undefined at the line ends).
            var lineOf = {};
            for (var lj = 0; lj < lines.length; lj++) {
                for (var lk = 0; lk < lines[lj].length; lk++) { lineOf[lines[lj][lk]] = { line: lines[lj], pos: lk }; }
            }
            function outside(idxs) {
                var a0 = lineOf[idxs[0]], a1 = lineOf[idxs[idxs.length - 1]];
                return {
                    before: a0 && a0.pos > 0 ? seq[a0.line[a0.pos - 1]].pitch : undefined,
                    after: a1 && a1.pos < a1.line.length - 1 ? seq[a1.line[a1.pos + 1]].pitch : undefined
                };
            }

            function pitchesOf(idxs) {
                var r = [];
                for (var q = 0; q < idxs.length; q++) { r.push(seq[idxs[q]].pitch); }
                return r;
            }

            for (var li = 0; li < lines.length; li++) { analyzeLine(lines[li]); }

            function analyzeLine(L) {
                var p = pitchesOf(L), m = L.length, a, b;
                // melodic shape and repeated-note runs
                for (a = 0; a < m; a++) {
                    seq[L[a]].isPeak = (a === 0 || p[a - 1] <= p[a]) && (a === m - 1 || p[a + 1] <= p[a]);
                    seq[L[a]].isValley = (a === 0 || p[a - 1] >= p[a]) && (a === m - 1 || p[a + 1] >= p[a]);
                }
                a = 0;
                while (a < m) {
                    b = a;
                    while (b + 1 < m && p[b + 1] === p[a]) { b++; }
                    for (var r = a; r <= b; r++) {
                        seq[L[r]].repLen = b - a + 1;
                        if (b > a) { seq[L[r]].ctx = "repeat"; }
                    }
                    if (b - a + 1 >= 3) {
                        addPattern("repeat", "repeated " + PC_NAMES[pcOf(p[a])] + " x" + (b - a + 1), 1, L.slice(a, b + 1), []);
                    }
                    a = b + 1;
                }
                // leaps
                for (a = 0; a + 1 < m; a++) {
                    if (Math.abs(p[a + 1] - p[a]) > P.leapSemis * h.sizeScale) {
                        if (seq[L[a]].ctx === "free") { seq[L[a]].ctx = "leap"; }
                        if (seq[L[a + 1]].ctx === "free") { seq[L[a + 1]].ctx = "leap"; }
                    }
                }
                // stepwise runs (steps of 1..3 semitones; a repetition ends the run)
                a = 0;
                while (a < m - 1) {
                    b = a;
                    while (b + 1 < m && Math.abs(p[b + 1] - p[b]) >= 1 && Math.abs(p[b + 1] - p[b]) <= 3) { b++; }
                    if (b - a + 1 >= 3) { analyzeStepRun(L.slice(a, b + 1)); }
                    a = b > a ? b : a + 1;
                }
                analyzePositions(L);
                analyzeArpeggios(L);
                analyzeBroken(L);
            }

            // ---- five-finger positions: windows of 4-5 adjacent keys within a fifth, in any order
            // (neighbour-note figures, Czerny-style patterns), played without moving the hand.
            function analyzePositions(L) {
                var p = pitchesOf(L), m = L.length, a = 0;
                while (a < m - 3) {
                    var b = a, lo = p[a], hi = p[a], set = {}, nd = 1;
                    set[p[a]] = true;
                    while (b + 1 < m) {
                        var q = p[b + 1];
                        var nlo = Math.min(lo, q), nhi = Math.max(hi, q);
                        if (nhi - nlo > 7 || (!set[q] && nd >= 5)) { break; }
                        if (!set[q]) { set[q] = true; nd++; }
                        lo = nlo; hi = nhi; b++;
                    }
                    // A monotone window is a fragment of a run, left to the scale analysis: a
                    // position is recognised by the melody turning inside it.
                    var turns = 0, lastDir = 0;
                    for (var t2 = a + 1; t2 <= b; t2++) {
                        var dd = p[t2] - p[t2 - 1];
                        if (dd !== 0) { if (lastDir && (dd > 0) !== (lastDir > 0)) { turns++; } lastDir = dd; }
                    }
                    if (b - a + 1 >= 4 && nd >= 4 && turns > 0) {
                        var keys = [], k;
                        for (k in set) { if (set.hasOwnProperty(k)) { keys.push(Number(k)); } }
                        keys.sort(function (x, y) { return x - y; });
                        var adjacent = true;
                        for (k = 1; k < keys.length; k++) { if (keys[k] - keys[k - 1] > 3) { adjacent = false; } }
                        if (adjacent) { applyFive(L.slice(a, b + 1), p.slice(a, b + 1), nd); }
                    }
                    a = b > a ? b : a + 1;
                }
            }

            // ---- stepwise runs: chromatic portions, then diatonic / pentatonic / five-finger
            function analyzeStepRun(R) {
                var p = pitchesOf(R), m = R.length, a = 0, b, q;
                var chromInterior = [];
                for (q = 0; q < m; q++) { chromInterior.push(false); }
                while (a < m - 1) {
                    b = a;
                    var dir = p[a + 1] - p[a];
                    while (b + 1 < m && Math.abs(p[b + 1] - p[b]) === 1 && (p[b + 1] - p[b]) === dir) { b++; }
                    if (b - a + 1 >= 3) {
                        applyChromatic(R.slice(a, b + 1));
                        for (q = a + 1; q < b; q++) { chromInterior[q] = true; }
                    }
                    a = b > a ? b : a + 1;
                }
                // diatonic pieces = maximal parts not inside a chromatic run
                var piece = [];
                for (q = 0; q < m; q++) {
                    if (chromInterior[q]) { if (piece.length >= 4) { analyzeDiatonic(piece); } piece = []; continue; }
                    piece.push(R[q]);
                }
                if (piece.length >= 4) { analyzeDiatonic(piece); }
            }

            function applyChromatic(C) {
                var p = pitchesOf(C), m = C.length, f = [];
                // CONFIDENCE: two semitones in a row already exclude diatonic scales, but short runs are
                // often chromatic passing notes inside a melody, so only long runs become strong.
                var conf = m >= 7 ? 0.9 : (m >= 5 ? 0.8 : (m === 4 ? 0.65 : 0.5));
                for (var q = 0; q < m; q++) {
                    var pc = pcOf(p[q]);
                    f.push(chromaticFinger(pc, side));
                    // The 2nd finger on F/C (RH) or E/B (LH) exists only to follow the thumb on the
                    // adjacent white key (E-F, B-C); without that neighbour in the run the thumb is used.
                    if (f[q] === 2) {
                        var partner = side === "right" ? p[q] - 1 : p[q] + 1;
                        if (!((q > 0 && p[q - 1] === partner) || (q < m - 1 && p[q + 1] === partner))) { f[q] = 1; }
                    }
                    var alts = BLACK_PC[pc] ? [2, 4] : [f[q] === 1 ? 2 : 1];
                    claim(C[q], f[q], conf, "chromatic", { alts: alts, lockable: q > 0 && q < m - 1 });
                }
                addPattern("chromatic", "chromatic run " + (p[1] > p[0] ? "up" : "down"), conf, C, f);
            }

            function analyzeDiatonic(S) {
                if (diatonicCore(S)) { return; }
                // A run mixing two forms (e.g. melodic minor up, natural minor down) is analysed per
                // direction; the turning note belongs to both halves.
                var p = pitchesOf(S), a = 0;
                while (a < S.length - 1) {
                    var b = a;
                    var dir = p[a + 1] > p[a];
                    while (b + 1 < S.length && (p[b + 1] > p[b]) === dir) { b++; }
                    if (b - a + 1 >= 4) { diatonicCore(S.slice(a, b + 1)); }
                    a = b > a ? b : a + 1;
                }
            }

            function diatonicCore(S) {
                var p = pitchesOf(S), m = S.length, q;
                var distinct = {}, nd = 0, lo = p[0], hi = p[0];
                for (q = 0; q < m; q++) {
                    if (!distinct[p[q]]) { distinct[p[q]] = true; nd++; }
                    if (p[q] < lo) { lo = p[q]; }
                    if (p[q] > hi) { hi = p[q]; }
                }
                var span = hi - lo;
                // FIVE-FINGER POSITION: at most five keys within a fifth are played without any thumb
                // passage (C D E F G F E D C -> RH 1 2 3 4 5 4 3 2 1). Applying a scale fingering here
                // would add pointless crossings.
                if (nd <= 5 && span <= 7) {
                    if (nd >= 4) { applyFive(S, p, nd); }
                    return true;
                }
                if (nd >= 6) {
                    var ctxOut = outside(S);
                    var mask = pcsMask(p);
                    var keySig = majorityKeySig(seq, S);
                    var cands = [];
                    for (var c = 0; c < SCALE_CANDS.length; c++) {
                        var cd = SCALE_CANDS[c];
                        if ((mask & cd.mask) !== mask) { continue; }
                        var ok = true;
                        for (q = 1; q < m && ok; q++) { ok = adjacentIn(cd.mask, p[q - 1], p[q]); }
                        if (!ok) { continue; }
                        var cyc = scaleFingering(cd.tonic, cd.form, side).cyc;
                        var fing = runFingers(p, (function (cc) { return function (pc) { return cc[pc]; }; })(cyc), side, "scale",
                                              ctxOut.before, ctxOut.after);
                        cands.push({ cand: cd, ev: keyEvidence(cd, p, keySig), fingers: fing, key: fing.join("") });
                    }
                    if (cands.length) { applyScale(S, p, nd, cands); return true; }
                    if (applyPentatonic(S, p, nd)) { return true; }
                }
                return false;
            }

            function applyFive(S, p, nd) {
                var sorted = [], q, x, set = pitchesSet(p);
                for (x in set) { if (set.hasOwnProperty(x)) { sorted.push(Number(x)); } }
                sorted.sort(function (a, b) { return a - b; });
                var offsets = [];
                for (var o = 0; o <= 5 - nd; o++) { offsets.push(o); }
                // RH: thumb on the lowest key of the position; LH: thumb on the highest. With four keys
                // the position may be shifted by one finger; the shift that keeps the thumb off a black
                // key is preferred.
                function fingerOf(pitch, o) {
                    var r = sorted.indexOf(pitch);
                    return side === "right" ? r + 1 + o : nd - r + o;
                }
                var best = 0;
                var thumbPitch = side === "right" ? sorted[0] : sorted[nd - 1];
                if (BLACK_PC[pcOf(thumbPitch)] && nd < 5) { best = 1; }
                var f = [];
                for (q = 0; q < S.length; q++) {
                    var alts = [];
                    for (var oo = 0; oo < offsets.length; oo++) { if (offsets[oo] !== best) { alts.push(fingerOf(p[q], offsets[oo])); } }
                    f.push(fingerOf(p[q], best));
                    claim(S[q], f[q], nd === 5 ? 0.7 : 0.55, "five", { alts: alts });
                }
                addPattern("five", "five-finger position", nd === 5 ? 0.7 : 0.55, S, f);
            }

            function pitchesSet(p) {
                var s = {};
                for (var q = 0; q < p.length; q++) { s[p[q]] = true; }
                return s;
            }

            function applyScale(S, p, nd, cands) {
                cands.sort(function (a, b) { return b.ev - a.ev; });
                var best = cands[0];
                var agree = true, margin = Infinity;
                for (var c = 1; c < cands.length; c++) {
                    if (cands[c].key !== best.key) {
                        agree = false;
                        margin = Math.min(margin, best.ev - cands[c].ev);
                    }
                }
                // CONFIDENCE of a scale: a full octave of degrees is unmistakable; six degrees are only a
                // preference (a sixth-wide melodic fragment is often played in position with one
                // extension rather than with scale crossings); ambiguity between keys that would be fingered differently (e.g. G major vs E
                // natural minor on a run from A to A) lowers it unless the tonic or the key
                // signature decides. Very slow "scales" are melodies more than technical runs.
                var conf = nd >= 7 ? (S.length >= 8 ? 0.95 : 0.9) : 0.6;
                if (!agree) { conf *= margin >= 1.5 ? 0.9 : 0.65; }
                var ioi = (seq[S[S.length - 1]].start - seq[S[0]].start) / (S.length - 1);
                if (ioi > 1.5) { conf *= 0.85; }
                var m = S.length, q;
                var unlock = [];
                for (q = 0; q < m; q++) { unlock.push(q === 0 || q === m - 1); }
                // Inner turning points (RH bottom, LH top) of a scale are where pianists most often
                // depart from the cycle (e.g. RH F-E-F as 2-1-2 instead of 1-3-1): never locked.
                for (q = 1; q < m - 1; q++) {
                    var inner = side === "right" ? (p[q - 1] > p[q] && p[q + 1] > p[q]) : (p[q - 1] < p[q] && p[q + 1] < p[q]);
                    if (inner) { unlock[q - 1] = true; unlock[q] = true; unlock[q + 1] = true; }
                }
                // The first and last notes are where the scale meets its context (entry and exit
                // fingers legitimately vary), so their proposal is weaker.
                for (q = 0; q < m; q++) {
                    var cq = (q === 0 || q === m - 1) ? conf * 0.8 : conf;
                    claim(S[q], best.fingers[q], cq, "scale", { lockable: !unlock[q] });
                }
                var src = scaleFingering(best.cand.tonic, best.cand.form, side).source;
                addPattern("scale", PC_NAMES[best.cand.tonic] + " " + FORM_NAMES[best.cand.form], conf, S, best.fingers,
                           { source: src, candidates: cands.length, agree: agree });
            }

            function applyPentatonic(S, p, nd) {
                var mask = pcsMask(p), m = S.length, q;
                if (bitCount(mask) !== 5) { return false; }
                var found = null;
                for (var t = 0; t < 12 && !found; t++) {
                    var pm = 0, iv = [0, 2, 4, 7, 9];
                    for (q = 0; q < 5; q++) { pm |= (1 << ((t + iv[q]) % 12)); }
                    if (pm !== mask) { continue; }
                    var ok = true;
                    for (q = 1; q < m && ok; q++) { ok = adjacentIn(pm, p[q - 1], p[q]); }
                    if (ok) { found = { tonic: t, steps: iv }; }
                }
                if (!found) { return false; }
                // The major-pentatonic tonic and its relative minor share the fingering cycle only if
                // the generator picks the same thumbs; the tonic heard at the ends decides.
                var tonic = found.tonic;
                var rel = (tonic + 9) % 12;
                if ((pcOf(p[0]) === rel || pcOf(p[m - 1]) === rel) && pcOf(p[0]) !== tonic) {
                    var ivm = [0, 3, 5, 7, 10];
                    var cycm = generateCyclic(rel, ivm, side, [2, 3]);
                    return finishPenta(S, p, cycm, PC_NAMES[rel] + " minor pentatonic");
                }
                return finishPenta(S, p, generateCyclic(tonic, found.steps, side, [2, 3]), PC_NAMES[tonic] + " major pentatonic");
            }
            function finishPenta(S, p, cyc, label) {
                var o = outside(S);
                var f = runFingers(p, function (pc) { return cyc[pc]; }, side, "scale", o.before, o.after);
                var conf = S.length >= 7 ? 0.7 : 0.6;
                for (var q = 0; q < S.length; q++) { claim(S[q], f[q], conf, "pentatonic"); }
                addPattern("pentatonic", label, conf, S, f);
                return true;
            }

            // ---- arpeggios: consecutive notes are adjacent tones of one chord (in either direction)
            function analyzeArpeggios(L) {
                var p = pitchesOf(L), m = L.length, a = 0;
                while (a < m - 2) {
                    var cands = [];
                    var c, b = a;
                    for (c = 0; c < CHORDS.length; c++) { if (CHORDS[c].mask & (1 << pcOf(p[a]))) { cands.push(CHORDS[c]); } }
                    while (b + 1 < m) {
                        var d = p[b + 1] - p[b];
                        if (d === 0 || Math.abs(d) > 9) { break; }
                        var next = [];
                        for (c = 0; c < cands.length; c++) {
                            if ((cands[c].mask & (1 << pcOf(p[b + 1]))) && adjacentIn(cands[c].mask, p[b], p[b + 1])) { next.push(cands[c]); }
                        }
                        if (!next.length) { break; }
                        cands = next;
                        b++;
                    }
                    var len = b - a + 1;
                    if (len >= 4) {
                        var seg = L.slice(a, b + 1), sp = p.slice(a, b + 1);
                        var smask = pcsMask(sp), lo = sp[0], hi = sp[0], big = 0, q;
                        for (q = 0; q < sp.length; q++) { if (sp[q] < lo) { lo = sp[q]; } if (sp[q] > hi) { hi = sp[q]; } }
                        for (q = 1; q < sp.length; q++) { if (Math.abs(sp[q] - sp[q - 1]) >= 3) { big++; } }
                        var chord = null;
                        for (c = 0; c < cands.length; c++) { if (cands[c].mask === smask) { chord = cands[c]; break; } }
                        // An ARPEGGIO needs all chord tones and a range beyond one hand position
                        // (otherwise it is a broken chord played without thumb passages).
                        if (chord && hi - lo > 12 && big >= 0.6 * (sp.length - 1)) { applyArpeggio(seg, sp, chord, lo); }
                    }
                    a = b > a ? b : a + 1;
                }
            }

            function applyArpeggio(seg, sp, chord, lowest) {
                var af = arpeggioFingering(chord.pcs, pcOf(lowest), side);
                var o = outside(seg);
                var f = runFingers(sp, function (pc) { return af.cyc[pc]; }, side, "arpeggio", o.before, o.after);
                var m = seg.length, q;
                // CONFIDENCE grows with the length of the arpeggio.
                var conf = m >= 7 ? 0.9 : (m >= 5 ? 0.8 : 0.65);
                // Hand size: if an in-position step of the canonical fingering is beyond the
                // comfortable span of this hand, the pattern stays a preference (a variant may win).
                for (q = 1; q < m; q++) {
                    var crossing = (f[q] === 1 && f[q - 1] > 1) || (f[q - 1] === 1 && f[q] > 1 &&
                                   ((side === "right") === (sp[q] < sp[q - 1])));
                    if (!crossing && comfortDev(h, f[q - 1], f[q], Math.abs(sp[q] - sp[q - 1])) > 1.5) {
                        conf = Math.min(conf, 0.75);
                    }
                }
                for (q = 0; q < m; q++) {
                    var alts = [];
                    if (f[q] === 3 || f[q] === 4) { alts.push(f[q] === 3 ? 4 : 3); }   // 1-2-3 vs 1-2-4 variants
                    claim(seg[q], f[q], conf, "arpeggio", { alts: alts, lockable: q > 0 && q < m - 1, allBlack: af.allBlack });
                }
                addPattern("arpeggio", PC_NAMES[chord.root] + " " + chord.quality + " arpeggio", conf, seg, f);
            }

            // ---- broken chords inside one hand position (Alberti bass, waltz figures...)
            function analyzeBroken(L) {
                var p = pitchesOf(L), m = L.length, a = 0;
                var maxSpan = 12 * h.sizeScale;
                while (a < m - 2) {
                    var b = a, lo = p[a], hi = p[a];
                    while (b + 1 < m) {
                        var nlo = Math.min(lo, p[b + 1]), nhi = Math.max(hi, p[b + 1]);
                        if (nhi - nlo > maxSpan) { break; }
                        var mask = pcsMask(p.slice(a, b + 2));
                        // A fourth pitch class is accepted only inside the first four notes (a seventh
                        // chord figure); later it means the harmony has changed (C-G-E-G | B-G-D-G).
                        if (bitCount(mask) > 3 && b + 1 - a >= 4) { break; }
                        // A step (1-2 semitones) belongs to a scale or melody, not to a chord figure.
                        if (Math.abs(p[b + 1] - p[b]) <= 2 && p[b + 1] !== p[b]) { break; }
                        var fits = false;
                        for (var c = 0; c < CHORDS.length && !fits; c++) { fits = (CHORDS[c].mask & mask) === mask; }
                        if (!fits) { break; }
                        lo = nlo; hi = nhi; b++;
                    }
                    var len = b - a + 1;
                    if (len >= 3) {
                        var sp = p.slice(a, b + 1), steps = 0, q;
                        for (q = 1; q < len; q++) { if (Math.abs(sp[q] - sp[q - 1]) <= 2) { steps++; } }
                        var dp = [], seen = {};
                        for (q = 0; q < len; q++) { if (!seen[sp[q]]) { seen[sp[q]] = true; dp.push(sp[q]); } }
                        dp.sort(function (x, y) { return x - y; });
                        if (dp.length >= 3 && dp.length <= 5 && steps < 0.5 * (len - 1)) {
                            var shape = chordShape(dp, side, h);
                            if (shape) {
                                var conf = Math.min(shape.conf, 0.65), f = [];
                                for (q = 0; q < len; q++) {
                                    f.push(shape.fingers[dp.indexOf(sp[q])]);
                                    claim(L[a + q], f[q], conf, "broken");
                                }
                                addPattern("broken", "broken chord (" + shape.label + ")", conf, L.slice(a, b + 1), f);
                            }
                        }
                    }
                    a = b > a ? b : a + 1;
                }
            }

            // ---- B. rules -> per-note costs and locks
            for (i = 0; i < n; i++) {
                var nn = seq[i], g = guides[i];
                var uc = [0, 0, 0, 0, 0, 0];
                var bkind = g ? g.kind : nn.ctx;
                for (var f = 1; f <= 5; f++) {
                    if (g && f !== g.finger) {
                        var isAlt = false;
                        for (var q = 0; q < g.alts.length; q++) { if (g.alts[q] === f) { isAlt = true; } }
                        uc[f] += (isAlt ? P.altFactor : 1) * P.patternDev[g.kind] * g.conf * P.wPattern;
                    }
                    if (nn.isBlack) {
                        var bk = P.blackKey[bkind] || P.blackKey.free;
                        var pen = bk[f];
                        if (g && g.kind === "arpeggio" && g.allBlack) { pen = 0; }
                        uc[f] += pen * P.wBlack;
                    }
                    if (!g && !nn.isChord && f === 5) {
                        var interior = side === "right" ? !nn.isPeak : !nn.isValley;
                        if (interior) { uc[f] += P.fifthInterior * P.wMelodic; }
                    }
                }
                nn.uc = uc;
                nn.guide = g;
                nn.lock = (g && g.lockable && !g.contested && g.conf >= P.highConfidence) ? g.finger : 0;
            }
            return { patterns: patterns };
        }

        // =========================================================================================
        //  LAYER C/D - CONSTRAINTS AND COSTS
        // =========================================================================================

        function isLeap(h, na, nb) {
            return Math.abs(nb.pitch - na.pitch) > h.params.leapSemis * h.sizeScale;
        }

        // HARD constraints between two consecutive notes of the search (see H1, H3, H4 above).
        // Version 1 also forbade the thumb passing onto a black key; that is now a context-dependent
        // cost (crossingCost + black-key penalties) because it is correct in chords, black-key
        // arpeggios and some chromatic fingerings.
        function skip(h, fa, fb, na, nb, relaxSpan) {
            if (na === nb) { return false; }  // look-ahead padding
            var xba = nb.x - na.x;
            if (!na.isChord && !nb.isChord) {
                var leap = isLeap(h, na, nb);
                if (fa === fb && xba && !(na.duration >= 4 || leap || na.staccato)) { return true; }
                if (fa > 1 && fb > 1 && (fb - fa) * xba < 0 && !leap) { return true; }
            } else if (na.isChord !== nb.isChord || na.chordID !== nb.chordID) {
                // Chord <-> note or chord <-> chord: H3 only (the hand may shift between the two, so
                // crossings are allowed), and only when the two keys are played legato.
                var legato = na.end >= nb.start - 1e-6;
                if (fa === fb && xba && legato && !(na.duration >= 4 || isLeap(h, na, nb) || na.staccato)) { return true; }
            } else if (na.isChord && nb.isChord && na.chordID === nb.chordID) {
                var axba = Math.abs(xba) * 0.8 / h.hf;
                if (fa === fb) { return true; }
                if (fa < fb && h.side === "left") { return true; }
                if (fa > fb && h.side === "right") { return true; }
                var lo = Math.min(fa, fb), hi = Math.max(fa, fb);
                var threshold = THRESHOLDS[lo + "," + hi];
                if (threshold !== undefined && axba > threshold && !relaxSpan) { return true; }
            }
            return false;
        }

        // BIOMECHANICAL cost (unchanged from version 1): distance between the key and the rest
        // position of the finger relative to the previous one, divided by the available time, and
        // divided by the strength of the finger (and by its ability on black keys).
        function transitionCost(h, fa, fb, na, nb) {
            var fingerPos = (fb === fa) ? na.x : (h.frest[fb] - h.frest[fa]) + na.x;
            var dx = Math.abs(nb.x - fingerPos);
            var dt = Math.abs(nb.time - na.time) + 0.1;
            var v = dx / dt;
            var weight = h.weights[fb] || 1.0;
            if (nb.isBlack) { v /= weight * (h.bfactor[fb] || 1.0); } else { v /= weight; }
            return v;
        }

        // THUMB PASSAGE: thumb under a finger (moving towards the 5th-finger side) or finger over the
        // thumb (moving towards the thumb side). Its difficulty depends on the crossing finger, on
        // the distance, on the keys (black -> white is the natural passage, the thumb on a black
        // key is awkward), on the time available and on the hand size. Version 1 treated it as an
        // ordinary transition, whose geometric cost made every passage look like a big jump.
        function crossingCost(h, fa, fb, na, nb) {
            var P = h.params;
            var other = fa === 1 ? fb : fa;
            var thumbNote = fa === 1 ? na : nb;
            var fingerNote = fa === 1 ? nb : na;
            var dist = Math.abs(nb.pitch - na.pitch) / h.sizeScale;
            var c = P.crossBase[other];
            if (dist > P.crossReach[other]) { c += P.crossStretch * (dist - P.crossReach[other]); }
            if (thumbNote.isBlack) { c += fingerNote.isBlack ? P.crossBothBlack : P.crossThumbBlack; }
            else if (fingerNote.isBlack) { c = Math.max(0, c - P.crossBlackBonus); }
            var dt = Math.abs(nb.time - na.time) + 0.1;
            return c * (1 + P.crossSpeed / dt);
        }

        // REPEATED NOTE. Fast repetitions need a change of finger (normally towards the thumb:
        // 3-2-1, 4-3-2-1, or 2-1 alternation); slow ones are played with the same finger, and
        // changing it there is a needless complication. In between, both are acceptable.
        function repetitionCost(h, fa, fb, na, nb) {
            var P = h.params;
            var ioi = nb.start - na.start;
            var fast = (P.repSlowIOI - ioi) / (P.repSlowIOI - P.repFastIOI);
            fast = Math.max(0, Math.min(1, fast));
            if (fa === fb) { return P.repSame * fast * (nb.repLen >= 3 ? 1 : 0.5); }
            var c = P.repChange * (1 - fast);
            if (fb !== fa - 1) { c += P.repOrder * fast; }
            c += P.repSpread * Math.max(0, Math.abs(fa - fb) - 1);
            if (fa === 5 || fb === 5) { c += P.repFifth; }
            return c;
        }

        // LEAP: the hand is repositioned, so the distance between the two fingers is irrelevant; the
        // cost depends only on the time available. The landing finger is decided by the look-ahead
        // (the following notes) and by the per-note costs (black keys).
        function leapCost(h, fa, fb, na, nb) {
            var P = h.params;
            var dt = Math.abs(nb.time - na.time) + 0.1;
            return P.leapBase * (1 + P.leapSpeed / dt) + (fa === fb ? P.leapSameFinger : 0);
        }

        // Cost of playing nb with fb after na with fa, including the per-note cost of nb; -1 when the
        // transition violates a hard constraint.
        function stepCost(h, fa, fb, na, nb, relaxSpan) {
            if (skip(h, fa, fb, na, nb, relaxSpan)) { return -1; }
            if (na === nb) { return 0; }
            var P = h.params, c;
            if (!na.isChord && !nb.isChord) {
                var d = nb.pitch - na.pitch;
                if (d === 0) { c = P.wRepeat * repetitionCost(h, fa, fb, na, nb); }
                else if (isLeap(h, na, nb)) { c = P.wLeap * leapCost(h, fa, fb, na, nb); }
                else if ((fa > 1 && fb === 1 && nb.x > na.x) || (fa === 1 && fb > 1 && nb.x < na.x)) {
                    c = P.wCross * crossingCost(h, fa, fb, na, nb);
                } else { c = P.wBio * transitionCost(h, fa, fb, na, nb); }
            } else {
                c = P.wBio * transitionCost(h, fa, fb, na, nb);
                // Inside a chord the "time" between members is the artificial stagger of
                // buildSequence (0.05 beat), which inflates the geometric cost about sevenfold and
                // would let the spread of one chord outweigh the whole musical context around it.
                if (na.isChord && nb.isChord && na.chordID === nb.chordID) { c *= P.chordSpreadWeight; }
                // Leaving (or reaching) a chord legato with two long fingers crossing (e.g. 5 on the
                // top note, then 4 above it) is a real crossing only partly excused by the possibility
                // of shifting the hand between the two: soft, not forbidden.
                var sameChord = na.isChord && nb.isChord && na.chordID === nb.chordID;
                if (!sameChord && fa > 1 && fb > 1 && (fb - fa) * (nb.x - na.x) < 0 &&
                    na.end >= nb.start - 1e-6 && !isLeap(h, na, nb)) {
                    c += P.chordCrossing;
                }
            }
            // A movement that follows a recognised pattern (both notes in a pattern of the same kind,
            // both fingers as proposed) is a TRAINED gesture: scale, arpeggio and chromatic fingerings
            // are practised as units, so their raw geometric cost overstates the difficulty
            // (e.g. 1-3 on a semitone in the chromatic scale).
            var ga = na.guide, gb = nb.guide;
            if (ga && gb && ga.kind === gb.kind && fa === ga.finger && fb === gb.finger) { c *= P.trainedFactor; }
            if (nb.uc) { c += nb.uc[fb]; }
            return c;
        }

        function fixedFinger(note) { return note.finger > 0 ? note.finger : note.anchor; }

        // Pairs (j, i) of window notes where j is still sounding when i starts (H2). Pairs whose first
        // note is before `from` are left out: those notes already have a finger and are handled by
        // forbiddenFingers().
        function heldPairs(nseq, depth, from) {
            var pairs = [];
            var f0 = from || 0;
            for (var i = 1; i < depth; i++) {
                for (var j = f0; j < i; j++) {
                    var nj = nseq[j], ni = nseq[i];
                    if (nj === ni || nj.pitch === ni.pitch) { continue; }
                    if (nj.isChord && ni.isChord && nj.chordID === ni.chordID) { continue; }
                    var left = nj.end - ni.start;
                    var simultaneous = Math.abs(ni.start - nj.start) <= 1e-6;
                    if (!simultaneous && left > 1e-6) { pairs.push([j, i]); }
                }
            }
            return pairs;
        }

        // Fingers that are busy, for each window note, because an already fingered note is still
        // sounding (H2). maxAge (beats) ignores notes held for longer than that: the pianist may
        // release them (pedal) - used only by a relaxed profile.
        function forbiddenFingers(h, nseq, depth, maxAge) {
            var busy = [];
            var c;
            for (c = 0; c < h.context.length; c++) {
                if (fixedFinger(h.context[c])) { busy.push(h.context[c]); }
            }
            var forb = [];
            for (var i = 0; i < depth; i++) {
                var set = {};
                for (c = 0; c < busy.length; c++) {
                    var b = busy[c];
                    if (b === nseq[i]) { continue; }
                    if (maxAge !== undefined && nseq[i].start - b.start > maxAge) { continue; }
                    var started = b.start <= nseq[i].start + 1e-6;
                    if (b.pitch !== nseq[i].pitch && started && b.end - nseq[i].start > 1e-6) {
                        set[fixedFinger(b)] = true;
                    }
                }
                forb.push(set);
            }
            return forb;
        }

        // Window cost is additive over adjacent pairs when chords are contiguous and ascending
        // (always true for sequences made by buildSequence), so DP is exact there.
        function dpIsExact(nseq, depth) {
            var groups = {};
            var i;
            for (i = 0; i < depth; i++) {
                if (nseq[i].isChord) {
                    var k = String(nseq[i].chordID);
                    if (!groups[k]) { groups[k] = []; }
                    groups[k].push(i);
                }
            }
            for (var key in groups) {
                if (!groups.hasOwnProperty(key)) { continue; }
                var idxs = groups[key];
                if (idxs[idxs.length - 1] - idxs[0] + 1 !== idxs.length) { return false; }
                for (i = 1; i < idxs.length; i++) {
                    if (nseq[idxs[i]].pitch < nseq[idxs[i - 1]].pitch) { return false; }
                }
            }
            return true;
        }

        // Exact minimum-cost path by backward DP; ties -> lexicographically smallest fingers.
        function searchDP(h, nseq, depth, options, relaxSpan) {
            var steps = [null];
            var lv, a, b, fa, fb;
            for (lv = 1; lv < depth; lv++) {
                var table = {};
                for (a = 0; a < options[lv - 1].length; a++) {
                    fa = options[lv - 1][a];
                    for (b = 0; b < options[lv].length; b++) {
                        fb = options[lv][b];
                        var sc = stepCost(h, fa, fb, nseq[lv - 1], nseq[lv], relaxSpan);
                        if (sc >= 0) { table[fa * 8 + fb] = sc; }
                    }
                }
                steps.push(table);
            }
            var toGo = [];
            for (lv = 0; lv < depth; lv++) { toGo.push({}); }
            for (a = 0; a < options[depth - 1].length; a++) { toGo[depth - 1][options[depth - 1][a]] = 0.0; }
            for (lv = depth - 2; lv >= 0; lv--) {
                for (a = 0; a < options[lv].length; a++) {
                    fa = options[lv][a];
                    var best = Infinity;
                    for (b = 0; b < options[lv + 1].length; b++) {
                        fb = options[lv + 1][b];
                        var step = steps[lv + 1][fa * 8 + fb];
                        if (step === undefined) { continue; }
                        var rest = toGo[lv + 1][fb];
                        if (rest === undefined) { continue; }
                        if (step + rest < best) { best = step + rest; }
                    }
                    toGo[lv][fa] = best;
                }
            }
            var unary0 = function (f) { return nseq[0].uc ? nseq[0].uc[f] : 0; };
            var bestTotal = Infinity;
            for (a = 0; a < options[0].length; a++) {
                var t0 = toGo[0][options[0][a]] + unary0(options[0][a]);
                if (t0 < bestTotal) { bestTotal = t0; }
            }
            if (bestTotal === Infinity) { return null; }
            var tol = 1e-9 * Math.max(1.0, Math.abs(bestTotal));

            var path = [];
            var current = 0;
            for (a = 0; a < options[0].length; a++) {
                var c0 = toGo[0][options[0][a]] + unary0(options[0][a]);
                if (c0 <= bestTotal + tol) { current = options[0][a]; break; }
            }
            path.push(current);
            for (lv = 1; lv < depth; lv++) {
                var target = toGo[lv - 1][current];
                var chosen = 0;
                for (b = 0; b < options[lv].length; b++) {
                    fb = options[lv][b];
                    var s2 = steps[lv][current * 8 + fb];
                    var r2 = toGo[lv][fb];
                    if (s2 !== undefined && r2 !== undefined && s2 + r2 <= target + tol) { chosen = fb; break; }
                }
                current = chosen;
                path.push(current);
            }
            return path;
        }

        // Exhaustive search with branch-and-bound (costs are non-negative) and held-finger rules.
        function searchDFS(h, nseq, depth, options, held, relaxSpan) {
            var heldBefore = {};
            var i;
            for (i = 0; i < held.length; i++) {
                var jj = held[i][0], ii = held[i][1];
                if (!heldBefore[ii]) { heldBefore[ii] = []; }
                heldBefore[ii].push(jj);
            }
            var bestPath = null;
            var minCost = Infinity;
            var candidate = [];
            for (i = 0; i < depth; i++) { candidate.push(0); }

            function backtrack(level, cum) {
                if (level === depth) {
                    if (cum < minCost) { minCost = cum; bestPath = candidate.slice(); }
                    return;
                }
                var choices = options[level];
                for (var c = 0; c < choices.length; c++) {
                    var finger = choices[c];
                    var add;
                    if (level > 0) {
                        add = stepCost(h, candidate[level - 1], finger, nseq[level - 1], nseq[level], relaxSpan);
                        if (add < 0) { continue; }
                    } else {
                        add = nseq[0].uc ? nseq[0].uc[finger] : 0;
                    }
                    if (heldBefore[level]) {
                        var clash = false;
                        for (var q = 0; q < heldBefore[level].length; q++) {
                            if (candidate[heldBefore[level][q]] === finger) { clash = true; break; }
                        }
                        if (clash) { continue; }
                    }
                    var next = cum + add;
                    if (next >= minCost) { continue; }  // cannot beat the best (strict < keeps first)
                    candidate[level] = finger;
                    backtrack(level + 1, next);
                }
            }
            backtrack(0, 0.0);
            return bestPath;
        }

        // Number of notes after position i examined by the search (autodepth of version 1, plus a
        // look-ahead after chords: version 1 looked at the chord only, so a chord could be fingered
        // without knowing where the hand had to go next).
        function chooseDepth(h, seq, i) {
            var n = seq.length, d, first = seq[i];
            if (first.isChord) {
                var rem = 0;
                while (i + rem < n && seq[i + rem].isChord && seq[i + rem].chordID === first.chordID) { rem++; }
                d = Math.min(Math.max(MAX_DEPTH, rem), rem + h.params.chordLookahead);
            } else {
                d = 4;
                for (var k = 4; k <= MAX_DEPTH; k++) {
                    d = k;
                    if (i + k - 1 >= n || seq[i + k - 1].time - first.time > 3.5) { break; }
                }
            }
            d = Math.min(d, n - i);
            // Never cut a chord in half at the end of the window.
            while (i + d < n && d < MAX_DEPTH + 5 && seq[i + d - 1].isChord && seq[i + d].isChord &&
                   seq[i + d - 1].chordID === seq[i + d].chordID) { d++; }
            return d;
        }

        // Plans the window starting at note i. The previous note (already fingered) is level 0 with
        // its finger fixed. Search profiles go from the strictest to the most relaxed; the first one
        // with a solution is used:
        //   0 anchors + pattern locks + held notes + spans   (everything)
        //   1 anchors + held notes + spans                   (patterns become soft only)
        //   2 held notes + spans                             (look-ahead anchors relaxed)
        //   3 held notes, relaxed chord spans
        //   4 notes held longer than heldReleaseBeats may be released (pedal)
        //   5 all held notes released
        //   6 previous note disconnected
        // Anchors of the chord being planned are kept in every profile: they are the user's.
        // Whatever is relaxed, the committed fingers are then verified (createGenerator.verify) and
        // every real violation is reported as a warning ("span-relaxed", "held-released",
        // "transition"), so the plugin can tell the user where to look.
        function planWindow(h, seq, i) {
            var depth = chooseDepth(h, seq, i);
            var hasPrev = i > 0 && seq[i - 1].finger > 0;
            var curChord = seq[i].isChord ? seq[i].chordID : -1;
            var P = h.params;
            var profiles = [
                { anchors: true, locks: true, held: "all", relax: false, prev: true },
                { anchors: true, locks: false, held: "all", relax: false, prev: true },
                { anchors: false, locks: false, held: "all", relax: false, prev: true },
                { anchors: false, locks: false, held: "all", relax: true, prev: true },
                { anchors: false, locks: false, held: "recent", relax: true, prev: true },
                { anchors: false, locks: false, held: "none", relax: true, prev: true },
                { anchors: false, locks: false, held: "none", relax: true, prev: false }
            ];
            for (var p = 0; p < profiles.length; p++) {
                var pr = profiles[p];
                var usePrev = hasPrev && pr.prev;
                var win = (usePrev ? [seq[i - 1]] : []).concat(seq.slice(i, i + depth));
                var L = win.length, off = usePrev ? 1 : 0;
                var forb = pr.held === "none" ? null :
                    forbiddenFingers(h, win, L, pr.held === "recent" ? P.heldReleaseBeats : undefined);
                var held = pr.held === "all" ? heldPairs(win, L, off) : [];
                var options = [];
                var feasible = true;
                for (var lv = 0; lv < L && feasible; lv++) {
                    var nt = win[lv], base;
                    if (lv < off) { base = [nt.finger]; }
                    else if (nt.anchor && (pr.anchors || (nt.isChord && nt.chordID === curChord))) { base = [nt.anchor]; }
                    else if (pr.locks && nt.lock) { base = [nt.lock]; }
                    else { base = FINGERS; }
                    var kept = [];
                    for (var k = 0; k < base.length; k++) {
                        if (lv >= off && forb && forb[lv][base[k]]) { continue; }
                        kept.push(base[k]);
                    }
                    if (!kept.length) { feasible = false; }
                    options.push(kept);
                }
                if (!feasible) { continue; }
                var path = (held.length === 0 && dpIsExact(win, L)) ?
                    searchDP(h, win, L, options, pr.relax) :
                    searchDFS(h, win, L, options, held, pr.relax);
                if (path) { return { fingers: path.slice(off), profile: p }; }
            }
            // Unreachable in practice (profile 6 has no hard constraint left except chord order).
            var fb = [];
            for (var q = 0; q < depth; q++) { fb.push(seq[i + q].anchor || Math.min(5, 1 + (seq[i + q].chordnr || 0))); }
            return { fingers: fb, profile: profiles.length };
        }

        // ------------------------------------------------------------------ generation loop
        // Incremental generator: each step() fingers one note (chords are committed as a whole on
        // their first note; the following steps for that chord just advance), so the caller can
        // interleave work with UI updates. Left-hand keys are mirrored internally and restored by
        // finish() (called automatically after the last step; safe to call again).
        // options: { params: {...overrides of DEFAULT_PARAMS} }
        function createGenerator(seq, side, size, options) {
            var h = makeHand(side, size || "M", options);
            var n = seq.length;
            var originalX = [];
            var i;
            for (i = 0; i < n; i++) {
                originalX.push(seq[i].x);
                if (side === "left") { seq[i].x = -seq[i].x; }
                seq[i].finger = 0;
            }
            var analysis = analyzeSequence(seq, h);
            var warnings = [];
            var stats = {};     // how many windows were solved by each search profile (diagnostics)
            var pos = 0;
            var restored = false;

            function finish() {
                if (restored) { return; }
                restored = true;
                for (var k = 0; k < n; k++) { seq[k].x = originalX[k]; }
            }

            // A user anchor is never changed, but it is checked: an anchor that contradicts the
            // previous finger or a held finger is reported instead of silently producing an
            // impossible sequence around it.
            function checkAnchor(idx) {
                var an = seq[idx];
                if (idx > 0 && seq[idx - 1].finger > 0 && skip(h, seq[idx - 1].finger, an.anchor, seq[idx - 1], an, false)) {
                    warnings.push({ id: an.id, index: idx, reason: "anchor-transition" });
                }
                var forb = forbiddenFingers(h, [an], 1);
                if (forb[0][an.anchor]) { warnings.push({ id: an.id, index: idx, reason: "anchor-held" }); }
            }

            // Reports what the committed result really violates (it never changes it). Relaxed search
            // profiles are only tried when the strict ones have no solution, so a violation found here
            // is a real conflict of the score (chord wider than the hand, held note, ...).
            function verify(idx) {
                var nk = seq[idx];
                if (idx > 0 && seq[idx - 1].finger > 0 && skip(h, seq[idx - 1].finger, nk.finger, seq[idx - 1], nk, false)) {
                    var sameChord = nk.isChord && seq[idx - 1].isChord && seq[idx - 1].chordID === nk.chordID;
                    warnings.push({ id: nk.id, index: idx, reason: sameChord ? "span-relaxed" : "transition" });
                }
                var forb = forbiddenFingers(h, [nk], 1);
                if (forb[0][nk.finger]) { warnings.push({ id: nk.id, index: idx, reason: "held-released" }); }
            }

            function step() {
                if (pos >= n) { finish(); return false; }
                var idx = pos;
                var an = seq[idx];
                h.context = seq.slice(Math.max(0, idx - 64), idx);
                if (an.finger > 0) {
                    // already committed together with its chord
                } else if (an.anchor && !an.isChord) {
                    an.finger = an.anchor;
                    checkAnchor(idx);
                } else {
                    var res = planWindow(h, seq, idx);
                    stats[res.profile] = (stats[res.profile] || 0) + 1;
                    if (an.isChord) {
                        for (var k = 0; idx + k < n && k < res.fingers.length; k++) {
                            var nk = seq[idx + k];
                            if (!nk.isChord || nk.chordID !== an.chordID) { break; }
                            nk.finger = nk.anchor || res.fingers[k];
                            verify(idx + k);
                        }
                    } else {
                        an.finger = res.fingers[0];
                        verify(idx);
                    }
                }
                pos++;
                if (pos >= n) { finish(); return false; }
                return true;
            }

            return { step: step, finish: finish, total: n, warnings: warnings, analysis: analysis, stats: stats,
                     position: function () { return pos; } };
        }

        // Fills seq[i].finger for the whole sequence in one go (kept for tests / scripting).
        function generate(seq, side, size, onProgress, options) {
            var g = createGenerator(seq, side, size, options);
            try {
                while (g.step()) { if (onProgress) { onProgress(g.position(), seq.length); } }
                if (onProgress) { onProgress(seq.length, seq.length); }
            } finally {
                g.finish();
            }
            seq.warnings = g.warnings;
            seq.analysis = g.analysis;
            return seq;
        }

        // Analysis only (diagnostics, tests).
        function analyze(seq, side, size, options) {
            return analyzeSequence(seq, makeHand(side, size || "M", options));
        }

        return {
            keyPosition: keyPosition,
            buildSequence: buildSequence,
            generate: generate,
            createGenerator: createGenerator,
            analyze: analyze,
            sizes: SIZE_FACTORS,
            defaultParams: function () { return mergeParams(null); },
            knowledge: {
                scaleTable: scaleTable, scaleFingering: scaleFingering, chromaticFinger: chromaticFinger,
                arpeggioFingering: arpeggioFingering, chordShape: function (p, side, size) {
                    return chordShape(p, side, makeHand(side, size || "M"));
                },
                generateCyclic: generateCyclic, forms: FORMS, majorTable: MAJOR_TABLE, harmonicTable: HARMONIC_TABLE
            },
            internals: {
                makeHand: makeHand, planWindow: planWindow, searchDP: searchDP, searchDFS: searchDFS,
                heldPairs: heldPairs, dpIsExact: dpIsExact, forbiddenFingers: forbiddenFingers,
                skip: skip, stepCost: stepCost, transitionCost: transitionCost, crossingCost: crossingCost,
                repetitionCost: repetitionCost, leapCost: leapCost
            }
        };
    }

    // MuseScore adapter for SmartPianoFingering: reads one staff into raw notes and writes fingerings back.
    //
    // The MuseScore API objects are passed in (api.score, api.Element, api.Cursor, api.division,
    // api.newElement) so this logic can be unit-tested in Node with a mock score.

    function createMuseScoreAdapter(api) {
        var VOICES = 4;

        // Duration of a chord in ticks. Whether chord.duration already includes the tuplet ratio is
        // not guaranteed across MuseScore versions, so for tuplet chords the value is validated
        // against the distance to the next element of the same voice (and the outcome is remembered).
        var tupletScaled = null;

        function nominalTicks(chord) {
            var ticks = 0;
            try {
                ticks = chord.duration.ticks;
                if (!(ticks > 0)) {
                    ticks = chord.duration.numerator / chord.duration.denominator * 4 * api.division;
                }
            } catch (e) {
                ticks = 0;
            }
            return ticks > 0 ? ticks : 0;
        }

        function chordTicks(chord, delta) {
            var nominal = nominalTicks(chord);
            if (!(nominal > 0)) { return 0; }
            var tup = null;
            try { tup = chord.tuplet; } catch (e) { tup = null; }
            if (!(tup && tup.actualNotes > 0 && tup.normalNotes > 0)) { return nominal; }
            var scaled = nominal * tup.normalNotes / tup.actualNotes;
            if (delta > 0) {
                var dn = Math.abs(delta - nominal);
                var ds = Math.abs(delta - scaled);
                if (Math.min(dn, ds) <= 2 && Math.abs(dn - ds) > 2) { tupletScaled = ds < dn; }
            }
            return tupletScaled === false ? nominal : scaled;
        }

        function fingeringElements(note) {
            var found = [];
            var els = note.elements;
            if (!els) { return found; }
            for (var i = 0; i < els.length; i++) {
                if (els[i] && els[i].type === api.Element.FINGERING) { found.push(els[i]); }
            }
            return found;
        }

        // Returns 1..5 when an existing fingering text is a plain finger number, else 0.
        function parseFinger(text) {
            if (text === undefined || text === null) { return 0; }
            var plain = String(text).replace(/<[^>]*>/g, "").replace(/\s+/g, "");
            return /^[1-5]$/.test(plain) ? parseInt(plain, 10) : 0;
        }

        // Key signature at the cursor (sharps > 0, flats < 0). Used by the musical analysis only as
        // evidence to choose between keys; null when the API does not provide it.
        function readKeySig(cursor) {
            try {
                var k = cursor.keySignature;
                if (typeof k === "number" && k >= -7 && k <= 7) { return k; }
            } catch (e) { }
            return null;
        }

        // Staccato-like articulation on a chord (the finger has time to lift, so the same finger may
        // play two different keys in a row). Read defensively: the articulation list and its
        // properties are not exposed in the same way by every MuseScore version.
        function isStaccato(chord) {
            try {
                var arts = chord.articulations;
                if (!arts) { return false; }
                for (var i = 0; i < arts.length; i++) {
                    var a = arts[i], name = "";
                    try { name = String(a.symbol !== undefined ? a.symbol : ""); } catch (e1) { name = ""; }
                    try { if (!name && a.subtypeName) { name = String(a.subtypeName()); } } catch (e2) { }
                    if (/stacc/i.test(name)) { return true; }
                }
            } catch (e) { }
            return false;
        }

        function isPitchedStaff(idx) {
            try {
                var st = api.score.staves[idx];
                if (st && st.part && st.part.hasDrumStaff === true) { return false; }
            } catch (e) { }
            return true;
        }

        function partKey(idx) {
            try {
                var st = api.score.staves[idx];
                if (st && st.part && st.part.startTrack !== undefined) { return st.part.startTrack; }
            } catch (e) { }
            return null;
        }

        // Reads the target staves in one pass. Chords are assigned to the staff where they are
        // DISPLAYED (cross-staff notes follow chord.staffMove), so they get the right hand.
        // Tied continuations are merged into the note that starts the tie. Voice is recorded so
        // unisons between voices can be fingered once, on the lowest voice.
        // win = { from, to } in ticks (to exclusive) limits what is read; null = whole staff.
        // Returns { <staffIdx>: { items, refs } } with refs[id] = { note, tick }.
        function readStaves(targets, keepExisting, win) {
            var division = api.division > 0 ? api.division : 480;
            var nst = api.score.nstaves;
            var res = {};
            var sources = {};
            var t, d, s;
            for (t = 0; t < targets.length; t++) {
                res[targets[t]] = { items: [], refs: [] };
                var pk = partKey(targets[t]);
                for (d = -1; d <= 1; d++) {
                    s = targets[t] + d;
                    if (s < 0 || s >= nst) { continue; }
                    // cross-staff moves only happen inside one part
                    if (d !== 0 && pk !== null && partKey(s) !== null && partKey(s) !== pk) { continue; }
                    sources[s] = true;
                }
            }

            for (var key in sources) {
                if (!sources.hasOwnProperty(key)) { continue; }
                s = parseInt(key, 10);
                for (var voice = 0; voice < VOICES; voice++) {
                    var cursor = api.score.newCursor();
                    cursor.staffIdx = s;
                    cursor.voice = voice;
                    cursor.rewind(api.Cursor.SCORE_START);
                    var els = [];
                    while (cursor.segment) {
                        var el = cursor.element;
                        if (el && (el.type === api.Element.CHORD || el.type === api.Element.REST)) {
                            els.push({ tick: cursor.tick, el: el, keySig: readKeySig(cursor) });
                        }
                        if (win && cursor.tick > win.to) { break; }
                        if (!cursor.next()) { break; }
                    }

                    for (var e = 0; e < els.length; e++) {
                        var item = els[e];
                        if (item.el.type !== api.Element.CHORD) { continue; }
                        var dest = s + (item.el.staffMove || 0);
                        if (!res.hasOwnProperty(dest)) { continue; }
                        var tick = item.tick;
                        if (win && (tick < win.from || tick >= win.to)) { continue; }
                        var delta = (e + 1 < els.length) ? els[e + 1].tick - tick : 0;
                        var base = chordTicks(item.el, delta);
                        var notes = item.el.notes;
                        var out = res[dest];
                        for (var k = 0; k < notes.length; k++) {
                            var note = notes[k];
                            if (note.tieBack) { continue; }  // continuation of an earlier note
                            var ticks = base;
                            var guard = 0;
                            var tie = note.tieForward;
                            while (tie && tie.endNote && guard < 64) {
                                ticks += chordTicks(tie.endNote.parent, 0);
                                tie = tie.endNote.tieForward;
                                guard++;
                            }
                            if (!(ticks > 0)) { continue; }
                            var anchor = 0;
                            if (keepExisting) {
                                var fs = fingeringElements(note);
                                for (var q = 0; q < fs.length && !anchor; q++) { anchor = parseFinger(fs[q].text); }
                            }
                            var id = out.refs.length;
                            out.refs.push({ note: note, tick: tick });
                            out.items.push({
                                id: id, pitch: note.pitch, start: tick / division,
                                end: (tick + ticks) / division, anchor: anchor, voice: voice,
                                keySig: item.keySig, staccato: isStaccato(item.el)
                            });
                        }
                    }
                }
            }
            return res;
        }

        // Adds the computed fingerings. range = { from, to } in ticks (to exclusive) or null.
        // Unison groups (same pitch and onset in several voices) get ONE fingering, on the lowest
        // voice. A note whose group already has a fingering is never touched when keepExisting is
        // on. When replacing, plain finger numbers (1-5) are replaced; groups carrying any other
        // fingering text (e.g. "1-2" substitutions) are left alone and counted as skipped.
        // Returns { written, skipped }.
        function writeFingerings(seq, refs, keepExisting, range) {
            var res = { written: 0, skipped: 0 };
            for (var i = 0; i < seq.length; i++) {
                var n = seq[i];
                if (!(n.finger >= 1 && n.finger <= 5)) { continue; }
                var ids = [n.id].concat(n.dups || []);
                var primary = refs[n.id];
                if (range && (primary.tick < range.from || primary.tick >= range.to)) { continue; }

                var numeric = [];
                var custom = 0;
                for (var d = 0; d < ids.length; d++) {
                    var note = refs[ids[d]].note;
                    var fe = fingeringElements(note);
                    for (var x = 0; x < fe.length; x++) {
                        if (parseFinger(fe[x].text) > 0) { numeric.push({ note: note, el: fe[x] }); }
                        else { custom++; }
                    }
                }
                if (numeric.length + custom > 0) {
                    if (keepExisting) { continue; }
                    if (custom > 0) { res.skipped++; continue; }
                    for (var e = 0; e < numeric.length; e++) { numeric[e].note.remove(numeric[e].el); }
                }
                var fingering = api.newElement(api.Element.FINGERING);
                fingering.text = String(n.finger);
                primary.note.add(fingering);
                res.written++;
            }
            return res;
        }

        return { readStaves: readStaves, writeFingerings: writeFingerings, parseFinger: parseFinger,
                 isPitchedStaff: isPitchedStaff };
    }
}