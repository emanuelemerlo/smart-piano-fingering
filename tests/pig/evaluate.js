#!/usr/bin/env node
// Compares the plugin's fingering with the PIG Dataset (Nakamura, Saito, Yoshii 2020).
//
//   PIG_DATASET=/path/to/PianoFingeringDataset_v1.2 node tests/pig/evaluate.js [options]
//
//   --set test|train|all   test = the 30 pieces with >= 4 pianists (the paper's test set, default)
//                          train = the other 120 pieces; all = both
//   --sizes woman,man      hand profiles to run (default: small,woman,man,large)
//   --beat 0.5             seconds per beat used to convert the dataset's times (default 0.5)
//   --out file.md          write the aggregate report (numbers only, no notes or fingerings)
//   --details dir          write per-note disagreements for local study (contains dataset
//                          content: keep it OUT of the repository)
//   --pieces 001,002       restrict to some pieces
//
// Without PIG_DATASET the script runs a self-test on a hand-written file and exits 0, so it is
// harmless in CI. The dataset itself is never stored in this repository.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("../lib.js");
const pig = require("./pig.js");

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : null; };

function selfTest() {
    const a = pig.parseFingering("//Version\n0 0.0 0.2 C4 64 80 0 1\n1 0.25 0.45 D4 64 80 0 2_1\n2 0.0 0.5 C3 64 80 1 -5\n");
    const b = pig.parseFingering("0 0.0 0.2 C4 64 80 0 1\n1 0.25 0.45 D4 64 80 0 3\n2 0.0 0.5 C3 64 80 1 -5\n");
    const ok = (c, m) => { if (!c) { throw new Error("self-test: " + m); } };
    ok(a.length === 3 && a[1].finger === 2 && a[1].sub && a[2].hand === "left" && a[2].finger === 5, "parse");
    ok(a[0].pitch === 60 && a[2].pitch === 48, "pitch");
    const m = pig.metrics(a, [a, b]);
    ok(Math.abs(m.gen - 5 / 6) < 1e-9 && m.high === 1 && m.soft === 1, "metrics " + JSON.stringify(m));
    const h = pig.humanMetrics([a, b]);
    ok(Math.abs(h.gen - 2 / 3) < 1e-9, "human");
    const { items } = pig.handItems(a, "right", 0.5);
    ok(items.length === 2 && items[1].start === 0.5, "items");
    console.log("PIG self-test ok");
}

// ------------------------------------------------------------------ context of a note (for the analysis)
function contexts(notes) {
    const ctx = notes.map(() => []);
    ["right", "left"].forEach(hand => {
        const idx = notes.map((n, i) => i).filter(i => notes[i].hand === hand);
        const onsets = {};
        idx.forEach(i => { const k = notes[i].on.toFixed(3); (onsets[k] = onsets[k] || []).push(i); });
        const keys = Object.keys(onsets).sort((x, y) => x - y);
        const single = keys.map(k => onsets[k]).map(g => (g.length === 1 ? g[0] : null));
        keys.forEach((k, j) => {
            const g = onsets[k];
            if (g.length > 1) { g.forEach(i => ctx[i].push("chord")); return; }
            const i = g[0];
            const prev = j > 0 ? single[j - 1] : null, next = j + 1 < keys.length ? single[j + 1] : null;
            const d1 = prev !== null ? notes[i].pitch - notes[prev].pitch : null;
            const d2 = next !== null ? notes[next].pitch - notes[i].pitch : null;
            const black = lib.isBlack(notes[i].pitch);
            if (d1 === 0 || d2 === 0) { ctx[i].push("repeated"); }
            const step = d => d !== null && d !== 0 && Math.abs(d) <= 2;
            const third = d => d !== null && Math.abs(d) >= 3 && Math.abs(d) <= 5;
            if (step(d1) && step(d2) && Math.sign(d1) === Math.sign(d2)) { ctx[i].push("scale run"); }
            else if (third(d1) && third(d2) && Math.sign(d1) === Math.sign(d2)) { ctx[i].push("arpeggio"); }
            else if ((d1 !== null && Math.abs(d1) > 7) || (d2 !== null && Math.abs(d2) > 7)) { ctx[i].push("leap"); }
            else if (d1 !== null && d2 !== null && Math.sign(d1) !== Math.sign(d2) && d1 && d2) { ctx[i].push("turn"); }
            else { ctx[i].push("other single"); }
            if (black) { ctx[i].push("black key"); }
        });
    });
    return ctx;
}

function main() {
    selfTest();
    const root = process.env.PIG_DATASET;
    if (!root) { console.log("PIG_DATASET not set: dataset evaluation skipped."); return; }

    const set = opt("set") || "test";
    const sizes = (opt("sizes") || "small,woman,man,large").split(",");
    const beat = Number(opt("beat") || 0.5);
    const only = opt("pieces") ? opt("pieces").split(",") : null;
    let pieces = pig.listPieces(root);
    pieces = pieces.filter(p => (only ? only.includes(p.id) :
        set === "all" ? true : set === "test" ? p.files.length >= 4 : p.files.length < 4));
    if (!pieces.length) { throw new Error("no pieces selected"); }

    const core = lib.loadQml().Core();
    const t0 = Date.now();
    const res = {};          // size -> [{ piece, metrics }]
    const human = [];
    const cat = {};          // size -> category -> { n, soft, gen }
    const catHuman = {};
    const details = opt("details");
    if (details) { fs.mkdirSync(details, { recursive: true }); }

    for (const p of pieces) {
        const { notes, gts } = pig.loadPiece(root, p);
        const ctx = contexts(notes);
        const hm = pig.humanMetrics(gts);
        if (hm) {
            human.push({ piece: p, m: hm });
            gts.forEach((g, k) => {
                const others = gts.filter((_, j) => j !== k);
                g.forEach((x, i) => ctx[i].forEach(c => {
                    const s = (catHuman[c] = catHuman[c] || { n: 0, soft: 0, gen: 0 });
                    s.n++; if (others.some(o => o[i].hand === x.hand && o[i].finger === x.finger)) { s.soft++; }
                    s.gen += others.filter(o => o[i].hand === x.hand && o[i].finger === x.finger).length / others.length;
                }));
            });
        }
        for (const size of sizes) {
            const est = notes.map(n => ({ hand: n.hand, finger: 0 }));
            for (const hand of ["right", "left"]) {
                const { items, idx } = pig.handItems(notes, hand, beat);
                if (!items.length) { continue; }
                const r = lib.run(core, items, hand, size);
                r.fingers.forEach((f, k) => { est[idx[k]].finger = f; });
            }
            const m = pig.metrics(est, gts);
            (res[size] = res[size] || []).push({ piece: p, m: m });
            const cs = (cat[size] = cat[size] || {});
            notes.forEach((n, i) => ctx[i].forEach(c => {
                const s = (cs[c] = cs[c] || { n: 0, soft: 0, gen: 0 });
                const hits = gts.filter(g => g[i].hand === est[i].hand && g[i].finger === est[i].finger).length;
                s.n++; if (hits) { s.soft++; } s.gen += hits / gts.length;
            }));
            if (details && size === (opt("detail-size") || "woman")) {
                const lines = ["id\tonset\tpitch\thand\tplugin\tpianists\tcontext"];
                notes.forEach((n, i) => {
                    const gt = gts.map(g => g[i].finger).join(",");
                    if (!gts.some(g => g[i].finger === est[i].finger)) {
                        lines.push([n.id, n.on.toFixed(3), n.name, n.hand, est[i].finger, gt, ctx[i].join("+")].join("\t"));
                    }
                });
                fs.writeFileSync(path.join(details, p.id + ".tsv"), lines.join("\n") + "\n");
            }
        }
        process.stderr.write(".");
    }
    process.stderr.write("\n");

    const pct = x => (100 * x).toFixed(1);
    const mean = (rows, k) => rows.reduce((a, r) => a + r.m[k], 0) / rows.length;
    const sd = (rows, k) => { const mu = mean(rows, k); return Math.sqrt(rows.reduce((a, r) => a + (r.m[k] - mu) ** 2, 0) / rows.length); };
    const out = [];
    out.push("# Smart Piano Fingering vs PIG Dataset");
    out.push("");
    out.push("Set: **" + set + "** (" + pieces.length + " pieces, " +
        pieces.reduce((a, p) => a + p.files.length, 0) + " fingerings). Beat = " + beat + " s. " +
        "Hands as annotated in the first fingering of each piece. Mean over pieces (SD).");
    out.push("");
    out.push("| | M_gen | M_high | M_soft |");
    out.push("|---|---|---|---|");
    if (human.length) {
        out.push("| Pianists vs each other (ceiling) | " + pct(mean(human, "gen")) + " (" + pct(sd(human, "gen")) + ") | " +
            pct(mean(human, "high")) + " | " + pct(mean(human, "soft")) + " |");
    }
    sizes.forEach(s => {
        const rows = res[s];
        out.push("| Plugin, " + s + " | " + pct(mean(rows, "gen")) + " (" + pct(sd(rows, "gen")) + ") | " +
            pct(mean(rows, "high")) + " | " + pct(mean(rows, "soft")) + " |");
    });
    out.push("");
    out.push("Reference (paper, test set): 3rd-order HMM 64.5 / 71.0 / 85.5; Human 71.4 / 79.1 / 90.8.");
    out.push("");
    out.push("## By context (note-level, " + sizes[sizes.indexOf("woman") >= 0 ? sizes.indexOf("woman") : 0] + " profile)");
    out.push("");
    const ref = sizes.indexOf("woman") >= 0 ? "woman" : sizes[0];
    out.push("| context | notes | plugin gen | plugin soft | pianists gen | pianists soft |");
    out.push("|---|---|---|---|---|---|");
    Object.keys(cat[ref]).sort((a, b) => cat[ref][b].n - cat[ref][a].n).forEach(c => {
        const s = cat[ref][c], h = catHuman[c];
        out.push("| " + c + " | " + s.n + " | " + pct(s.gen / s.n) + " | " + pct(s.soft / s.n) + " | " +
            (h ? pct(h.gen / h.n) : "–") + " | " + (h ? pct(h.soft / h.n) : "–") + " |");
    });
    out.push("");
    out.push("## By piece (" + ref + ")");
    out.push("");
    out.push("| piece | composer | notes | pianists | plugin gen | plugin soft | pianists gen |");
    out.push("|---|---|---|---|---|---|---|");
    res[ref].forEach((r, k) => {
        const h = human.find(x => x.piece.id === r.piece.id);
        out.push("| " + r.piece.id + " | " + (r.piece.composer || "") + " | " + r.m.n + " | " + r.piece.files.length + " | " +
            pct(r.m.gen) + " | " + pct(r.m.soft) + " | " + (h ? pct(h.m.gen) : "–") + " |");
    });
    out.push("");
    out.push("_" + ((Date.now() - t0) / 1000).toFixed(0) + " s. Dataset: Nakamura, Saito, Yoshii, Information Sciences 517 (2020)._");
    const text = out.join("\n") + "\n";
    if (opt("out")) { fs.writeFileSync(opt("out"), text); }
    console.log(text);
}

main();
