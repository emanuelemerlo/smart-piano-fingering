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
    version: "1.1.0"
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

    function commitRun() {
        var ctx = runCtx;
        var written = 0, skipped = 0;
        var cmdOpen = false;
        try {
            curScore.startCmd();
            cmdOpen = true;
            for (var j = 0; j < ctx.jobs.length; j++) {
                var r = ctx.adapter.writeFingerings(ctx.jobs[j].seq, ctx.jobs[j].refs, ctx.keep, ctx.range);
                written += r.written;
                skipped += r.skipped;
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
    // Smart Piano Fingering core
    //
 
    function createSmartPianoFingeringCore() {
        var SIZE_FACTORS = { XXS: 0.33, XS: 0.46, S: 0.64, M: 0.82, L: 1.0, XL: 1.1, XXL: 1.2 };
        var OCTAVE_CM = 16.5;
        var WHITE_KEY_CM = OCTAVE_CM / 7.0;
        var PITCHCLASS_LAYOUT = [0.5, 1.0, 1.5, 2.0, 2.5, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5];
        var FINGERS = [1, 2, 3, 4, 5];
        var THRESHOLDS = {
            "3,4": 5, "4,5": 5, "2,3": 6, "2,4": 7, "3,5": 8,
            "2,5": 11, "1,2": 12, "1,3": 14, "1,4": 16, "1,5": 17
        };

        // ------------------------------------------------------------------ geometry
        function keyPosition(midi) {
            var m = Math.round(midi);
            var octave = Math.floor(m / 12);
            var pc = ((m % 12) + 12) % 12;
            return OCTAVE_CM * (octave - 1) + PITCHCLASS_LAYOUT[pc] * WHITE_KEY_CM;
        }

        function isBlackKey(midi) {
            var pc = ((midi % 12) + 12) % 12;
            return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
        }

        function makeHand(side, size) {
            var hf = SIZE_FACTORS[size] !== undefined ? SIZE_FACTORS[size] : SIZE_FACTORS.M;
            var frest = [null, -7.0, -2.8, 0.0, 2.8, 5.6];
            for (var i = 1; i <= 5; i++) {
                if (frest[i]) { frest[i] *= hf; }
            }
            return {
                side: side,
                hf: hf,
                frest: frest,
                weights: [null, 1.1, 1.0, 1.1, 0.9, 0.8],
                bfactor: [null, 0.3, 1.0, 1.1, 0.8, 0.7],
                depth: 9,
                autodepth: true,
                chordAware: false,
                startIsAnchor: false,
                context: []
            };
        }

        // ------------------------------------------------------------------ sequence building
        // raw: [{ pitch, start, end, anchor, id }] for ONE hand/staff, times in quarter-note beats.
        // Simultaneous notes (chords and voices colliding on the same onset) become chord groups,
        // ordered low->high, each member slightly staggered in time (see Python noteseq_from_part).
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
                            anchor: members[i].anchor || 0, id: members[i].id, dups: []
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
                        anchor: u.anchor, finger: 0
                    });
                }
                if (count > 1) { chordId += 1; }
            }
            return seq;
        }

        // ------------------------------------------------------------------ constraints & cost
        function skip(h, fa, fb, na, nb, relaxSpan) {
            if (na === nb) { return false; }  // look-ahead padding
            var xba = nb.x - na.x;
            if (!na.isChord && !nb.isChord) {
                if (fa === fb && xba && na.duration < 4) { return true; }
                if (fa > 1) {
                    if (fb > 1 && (fb - fa) * xba < 0) { return true; }
                    if (fb === 1 && nb.isBlack && xba > 0) { return true; }
                } else if (na.isBlack && xba < 0 && fb > 1 && na.duration < 2) {
                    return true;
                }
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

        function transitionCost(h, fa, fb, na, nb) {
            var fingerPos = (fb === fa) ? na.x : (h.frest[fb] - h.frest[fa]) + na.x;
            var dx = Math.abs(nb.x - fingerPos);
            var dt = Math.abs(nb.time - na.time) + 0.1;
            var v = dx / dt;
            var weight = h.weights[fb] || 1.0;
            if (nb.isBlack) { v /= weight * (h.bfactor[fb] || 1.0); } else { v /= weight; }
            return v;
        }

        function fixedFinger(note) { return note.finger > 0 ? note.finger : note.anchor; }

        function heldPairs(nseq, depth) {
            var pairs = [];
            for (var i = 1; i < depth; i++) {
                for (var j = 0; j < i; j++) {
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

        function forbiddenFingers(h, nseq, depth) {
            var busy = [];
            var c;
            for (c = 0; c < h.context.length; c++) {
                var f = fixedFinger(h.context[c]);
                if (f) { busy.push(h.context[c]); }
            }
            var forb = [];
            for (var i = 0; i < depth; i++) {
                var set = {};
                for (c = 0; c < busy.length; c++) {
                    var b = busy[c];
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

        function buildOptions(uStart, anchors, depth, forbidden) {
            var options = [uStart.slice()];
            var lv;
            for (lv = 1; lv < depth; lv++) {
                options.push(anchors[lv] ? [anchors[lv]] : FINGERS.slice());
            }
            if (forbidden) {
                for (lv = 0; lv < depth; lv++) {
                    var kept = [];
                    for (var k = 0; k < options[lv].length; k++) {
                        if (!forbidden[lv][options[lv][k]]) { kept.push(options[lv][k]); }
                    }
                    options[lv] = kept;
                    if (!kept.length) { return null; }
                }
            }
            return options;
        }

        // Exact minimum-cost path by backward DP; ties -> lexicographically smallest fingers.
        function searchDP(h, nseq, depth, uStart, anchors, relaxSpan, forbidden) {
            var options = buildOptions(uStart, anchors, depth, forbidden);
            if (!options) { return null; }
            var steps = [null];
            var lv, a, b, fa, fb;
            for (lv = 1; lv < depth; lv++) {
                var table = {};
                for (a = 0; a < options[lv - 1].length; a++) {
                    fa = options[lv - 1][a];
                    for (b = 0; b < options[lv].length; b++) {
                        fb = options[lv][b];
                        if (skip(h, fa, fb, nseq[lv - 1], nseq[lv], relaxSpan)) { continue; }
                        table[fa * 8 + fb] = transitionCost(h, fa, fb, nseq[lv - 1], nseq[lv]);
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
            var bestTotal = Infinity;
            for (a = 0; a < options[0].length; a++) {
                var t0 = toGo[0][options[0][a]];
                if (t0 !== undefined && t0 < bestTotal) { bestTotal = t0; }
            }
            if (bestTotal === Infinity) { return null; }
            var tol = 1e-9 * Math.max(1.0, Math.abs(bestTotal));

            var path = [];
            var current = 0;
            for (a = 0; a < options[0].length; a++) {
                var c0 = toGo[0][options[0][a]];
                if (c0 !== undefined && c0 <= bestTotal + tol) { current = options[0][a]; break; }
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
        function searchDFS(h, nseq, depth, uStart, anchors, held, relaxSpan, forbidden) {
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
                var choices;
                if (level === 0) { choices = uStart; }
                else if (anchors[level]) { choices = [anchors[level]]; }
                else { choices = FINGERS; }
                for (var c = 0; c < choices.length; c++) {
                    var finger = choices[c];
                    if (forbidden && forbidden[level][finger]) { continue; }
                    var add = 0;
                    if (level > 0) {
                        if (skip(h, candidate[level - 1], finger, nseq[level - 1], nseq[level], relaxSpan)) { continue; }
                        add = transitionCost(h, candidate[level - 1], finger, nseq[level - 1], nseq[level]);
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

        function optimizeSeq(h, nseq, istart) {
            var i;
            if (h.autodepth) {
                if (nseq[0].isChord) {
                    h.depth = Math.max(3, nseq[0].NinChord - nseq[0].chordnr + 1);
                } else {
                    var tn0 = nseq[0].time;
                    for (i = 4; i <= 9; i++) {
                        h.depth = i;
                        if (nseq[i - 1].time - tn0 > 3.5) { break; }
                    }
                }
            }
            // Never cut a chord in half (also in the tail, where autodepth is switched off).
            while ((h.autodepth || h.chordAware) && h.depth < 9 &&
                   nseq[h.depth - 1].isChord && nseq[h.depth].isChord &&
                   nseq[h.depth - 1].chordID === nseq[h.depth].chordID) {
                h.depth += 1;
            }

            var depth = h.depth;
            var uStart = istart === 0 ? FINGERS.slice() : [istart];
            var anchors = [0];
            for (i = 1; i < depth; i++) { anchors.push(nseq[i].anchor || 0); }
            var anyAnchor = false;
            for (i = 0; i < anchors.length; i++) { if (anchors[i]) { anyAnchor = true; } }

            var held = heldPairs(nseq, depth);
            var forb = forbiddenFingers(h, nseq, depth);
            var noAnchors = [];
            for (i = 0; i < depth; i++) { noAnchors.push(0); }
            var freeStart = FINGERS.slice();
            var lastStart = h.startIsAnchor ? uStart : freeStart;

            // [anchors, held, forbidden, relaxSpan, start]  (strictest first)
            var profiles = [[anchors, held, forb, false, uStart]];
            if (anyAnchor) { profiles.push([noAnchors, held, forb, false, uStart]); }
            if (istart && !h.startIsAnchor) { profiles.push([noAnchors, held, forb, false, freeStart]); }
            profiles.push([noAnchors, held, forb, true, lastStart]);
            profiles.push([noAnchors, [], null, true, lastStart]);

            var exact = dpIsExact(nseq, depth);
            var path = null;
            for (var p = 0; p < profiles.length; p++) {
                var pr = profiles[p];
                if (exact && pr[1].length === 0) {
                    path = searchDP(h, nseq, depth, pr[4], pr[0], pr[3], pr[2]);
                } else {
                    path = searchDFS(h, nseq, depth, pr[4], pr[0], pr[1], pr[3], pr[2]);
                }
                if (path) { break; }
            }

            var out = [];
            if (path) {
                out = path.slice();
                while (out.length < 9) { out.push(0); }
                return out;
            }
            var fallback = uStart.length ? uStart[0] : 3;
            for (i = 0; i < 9; i++) { out.push(fallback); }
            return out;
        }

        function enforceChordConsistency(h, seq, index, finger) {
            if (!(finger >= 1 && finger <= 5)) { return finger; }
            var note = seq[index];
            if (!note.isChord) { return finger; }
            var peers = [];
            var used = {};
            for (var k = 0; k < index; k++) {
                var prev = seq[k];
                if (prev.isChord && prev.chordID === note.chordID && prev.finger >= 1 && prev.finger <= 5) {
                    peers.push([prev.pitch, prev.finger]);
                    used[prev.finger] = true;
                }
            }
            if (!peers.length) { return finger; }
            var candidates = [];
            for (var f = 1; f <= 5; f++) { if (!used[f]) { candidates.push(f); } }
            if (!candidates.length) { candidates = [finger]; }
            var best = null;
            for (var c = 0; c < candidates.length; c++) {
                var cand = candidates[c];
                var penalty = 0;
                for (var q = 0; q < peers.length; q++) {
                    var pp = peers[q][0], pf = peers[q][1];
                    if (h.side === "right") {
                        if (note.pitch > pp && cand <= pf) { penalty += 100 + (pf - cand); }
                        else if (note.pitch < pp && cand >= pf) { penalty += 100 + (cand - pf); }
                    } else {
                        if (note.pitch > pp && cand >= pf) { penalty += 100 + (cand - pf); }
                        else if (note.pitch < pp && cand <= pf) { penalty += 100 + (pf - cand); }
                    }
                }
                var key = [penalty, Math.abs(cand - finger), cand];
                if (best === null || key[0] < best[0] ||
                    (key[0] === best[0] && (key[1] < best[1] || (key[1] === best[1] && key[2] < best[2])))) {
                    best = key;
                }
            }
            return best[2];
        }

        // ------------------------------------------------------------------ generation loop
        // Fills seq[i].finger for the whole sequence. Left-hand keys are mirrored internally.
        // Incremental version of the generation loop: each step() fingers one note, so the caller
        // can interleave work with UI updates. Left-hand keys are mirrored internally and restored
        // by finish() (called automatically after the last step; safe to call again).
        function createGenerator(seq, side, size) {
            var h = makeHand(side, size || "M");
            var n = seq.length;
            var originalX = [];
            var i;
            for (i = 0; i < n; i++) {
                originalX.push(seq[i].x);
                if (side === "left") { seq[i].x = -seq[i].x; }
                seq[i].finger = 0;
            }
            h.chordAware = h.autodepth;
            var pos = 0;
            var startFinger = 0;
            var out = [];
            var restored = false;

            function finish() {
                if (restored) { return; }
                restored = true;
                for (var k = 0; k < n; k++) { seq[k].x = originalX[k]; }
            }

            function step() {
                if (pos >= n) { finish(); return false; }
                var i = pos;
                var an = seq[i];
                if (i > n - 11 && h.autodepth) {
                    h.autodepth = false;
                    h.depth = Math.max(3, Math.min(9, n - i));
                }
                var window = seq.slice(i, i + 9);
                while (window.length < 9) { window.push(window[window.length - 1]); }

                h.context = seq.slice(Math.max(0, i - 64), i);

                if (an.anchor) {
                    an.finger = an.anchor;
                    h.startIsAnchor = true;
                    out = optimizeSeq(h, window, an.anchor);
                    h.startIsAnchor = false;
                    startFinger = out.length > 1 ? out[1] : an.anchor;
                } else {
                    var best = 0;
                    if (i > n - 9) {
                        if (out.length > 1) {
                            best = out.splice(1, 1)[0];
                            out[0] = best;
                            startFinger = out.length > 1 ? out[1] : best;
                        } else {
                            out = optimizeSeq(h, window, startFinger);
                            best = out[0];
                            startFinger = out.length > 1 ? out[1] : out[0];
                        }
                    } else {
                        out = optimizeSeq(h, window, startFinger);
                        best = out[0];
                        startFinger = out.length > 1 ? out[1] : out[0];
                    }
                    best = enforceChordConsistency(h, seq, i, best);
                    out[0] = best;
                    an.finger = best;
                }
                pos++;
                if (pos >= n) { finish(); return false; }
                return true;
            }

            return { step: step, finish: finish, total: n, position: function () { return pos; } };
        }

        // Fills seq[i].finger for the whole sequence in one go (kept for tests / scripting).
        function generate(seq, side, size, onProgress) {
            var g = createGenerator(seq, side, size);
            try {
                while (g.step()) { if (onProgress) { onProgress(g.position(), seq.length); } }
                if (onProgress) { onProgress(seq.length, seq.length); }
            } finally {
                g.finish();
            }
            return seq;
        }

        return {
            keyPosition: keyPosition,
            buildSequence: buildSequence,
            generate: generate,
            createGenerator: createGenerator,
            sizes: SIZE_FACTORS,
            internals: {
                makeHand: makeHand, optimizeSeq: optimizeSeq, searchDP: searchDP, searchDFS: searchDFS,
                heldPairs: heldPairs, dpIsExact: dpIsExact, forbiddenFingers: forbiddenFingers
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
                            els.push({ tick: cursor.tick, el: el });
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
                                end: (tick + ticks) / division, anchor: anchor, voice: voice
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