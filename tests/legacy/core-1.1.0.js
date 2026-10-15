// Snapshot of the fingering core of Smart Piano Fingering 1.1.0 (GPL-3.0-only).
// Kept ONLY to compare the old and the new algorithm (tests/compare-legacy.js).
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


module.exports = createSmartPianoFingeringCore;
