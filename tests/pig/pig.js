// Reader and metrics for the PIG Dataset (Piano Fingering Dataset).
//
//   E. Nakamura, Y. Saito, K. Yoshii, "Statistical Learning and Estimation of Piano Fingering",
//   Information Sciences 517, pp. 68-85, 2020. arXiv:1904.10237
//   https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/
//
// The dataset is NOT part of this repository (nonprofit academic use only, distributed by its
// authors on request). Point PIG_DATASET at the folder that contains List.csv and FingeringFiles/.
//
// File format (README.pdf of the dataset): one note per line, whitespace separated
//   id  onset(s)  offset(s)  spelled-pitch  onset-vel  offset-vel  channel(0=RH,1=LH)  finger
// finger > 0 right hand, < 0 left hand; "3_1" = substitution (we keep the first finger, as the
// paper does). Lines starting with "//" are comments.
"use strict";
const fs = require("fs");
const path = require("path");
const { midi } = require("../lib.js");

function parseFingering(text) {
    const notes = [];
    text.split(/\r?\n/).forEach((line, n) => {
        const s = line.trim();
        if (!s || s.startsWith("//")) { return; }
        const p = s.split(/\s+/);
        if (p.length < 8) { throw new Error("line " + (n + 1) + ": expected 8 fields, got " + p.length); }
        const raw = p[7];
        const first = Number(raw.split("_")[0]);
        if (!Number.isInteger(first) || first === 0 || Math.abs(first) > 5) {
            throw new Error("line " + (n + 1) + ": bad finger " + raw);
        }
        notes.push({
            id: Number(p[0]), on: Number(p[1]), off: Number(p[2]), name: p[3], pitch: midi(p[3]),
            hand: p[6] === "0" ? "right" : "left", finger: Math.abs(first), sub: raw.indexOf("_") >= 0
        });
    });
    return notes;
}

// List.csv -> [{ id: "001", composer, piece, files: ["001-1_fingering.txt", ...] }]
function listPieces(root) {
    const dir = path.join(root, "FingeringFiles");
    if (!fs.existsSync(dir)) { throw new Error("FingeringFiles/ not found in " + root); }
    const files = fs.readdirSync(dir).filter(f => /^\d{3}-\d+_fingering\.txt$/.test(f)).sort();
    const meta = {};
    const csv = path.join(root, "List.csv");
    if (fs.existsSync(csv)) {
        fs.readFileSync(csv, "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).forEach(l => {
            const m = /^(\d{3}),([^,]*),("(?:[^"]|"")*"|[^,]*)/.exec(l);
            if (m) { meta[m[1]] = { composer: m[2], piece: m[3].replace(/^"|"$/g, "") }; }
        });
    }
    const by = {};
    files.forEach(f => { const id = f.slice(0, 3); (by[id] = by[id] || []).push(f); });
    return Object.keys(by).sort().map(id => Object.assign({ id: id, files: by[id] }, meta[id] || {}));
}

function loadPiece(root, piece) {
    const gts = piece.files.map(f => parseFingering(fs.readFileSync(path.join(root, "FingeringFiles", f), "utf8")));
    const ref = gts[0];
    gts.forEach((g, k) => {
        if (g.length !== ref.length || g.some((x, i) => x.pitch !== ref[i].pitch || Math.abs(x.on - ref[i].on) > 1e-3)) {
            throw new Error(piece.files[k] + ": note list differs from " + piece.files[0]);
        }
    });
    return { notes: ref, gts: gts };
}

// Items for the core, one hand. Seconds -> beats with a fixed beat length (default 0.5 s, i.e. the
// plugin's beat thresholds are read as if every piece were at quarter = 120). Returns items and the
// indexes (into the note list) they come from.
function handItems(notes, hand, beatSec) {
    const b = beatSec || 0.5;
    const idx = [], items = [];
    notes.forEach((n, i) => {
        if (n.hand !== hand) { return; }
        idx.push(i);
        items.push({ id: items.length, pitch: n.pitch, start: Math.round(n.on / b * 1e4) / 1e4,
                     end: Math.round(Math.max(n.off, n.on + 0.01) / b * 1e4) / 1e4, anchor: 0, voice: 0 });
    });
    return { items, idx };
}

// est: array of { hand, finger } per note. gts: arrays of notes with { hand, finger }.
// A note matches a ground truth when both hand and finger agree (the dataset's signed finger).
const same = (a, b) => a.hand === b.hand && a.finger === b.finger;

function matchRate(est, gt) {
    let m = 0;
    for (let i = 0; i < gt.length; i++) { if (same(est[i], gt[i])) { m++; } }
    return gt.length ? m / gt.length : 0;
}

// Metrics of Nakamura et al. 2020 for one piece: M_gen (mean over ground truths), M_high (best
// ground truth), M_soft (note matches at least one ground truth).
function metrics(est, gts) {
    const rates = gts.map(g => matchRate(est, g));
    let soft = 0;
    const n = gts[0].length;
    for (let i = 0; i < n; i++) { if (gts.some(g => same(est[i], g[i]))) { soft++; } }
    return { gen: rates.reduce((a, b) => a + b, 0) / rates.length, high: Math.max.apply(null, rates),
             soft: n ? soft / n : 0, n: n };
}

// Inter-annotator ceiling: every annotator against all the others (the paper's "Human" row).
function humanMetrics(gts) {
    if (gts.length < 2) { return null; }
    const per = gts.map((g, k) => metrics(g, gts.filter((_, j) => j !== k)));
    const avg = key => per.reduce((a, r) => a + r[key], 0) / per.length;
    return { gen: avg("gen"), high: avg("high"), soft: avg("soft"), n: gts[0].length };
}

module.exports = { parseFingering, listPieces, loadPiece, handItems, matchRate, metrics, humanMetrics };
