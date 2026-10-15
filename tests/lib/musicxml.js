// Minimal MusicXML builder (to create test scores) and parser (to read what MuseScore exports).
// Only what the runtime tests need: pitched grand-staff parts, voices, chords, ties, grace notes,
// tuplets, existing fingerings, cross-staff notes, and an unpitched percussion part.
"use strict";

const DIVISIONS = 12;   // per quarter note: allows eighth triplets (4) and 16ths (3)
const TYPE_BY_DURATION = { 48: "whole", 24: "half", 12: "quarter", 6: "eighth", 3: "16th" };

// Event helpers. d = duration in divisions of a quarter note (DIVISIONS = 12).
const Q = 12, E = 6, S = 3, H = 24, W = 48;
const n = (p, d, o) => Object.assign({ p: p, d: d }, o || {});
const rest = d => ({ r: true, d: d });

function pitchXml(p) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(p);
    if (!m) { throw new Error("bad pitch " + p); }
    const alter = m[2] ? "<alter>" + (m[2] === "#" ? 1 : -1) + "</alter>" : "";
    return "<pitch><step>" + m[1] + "</step>" + alter + "<octave>" + m[3] + "</octave></pitch>";
}

function noteXml(ev, voice, staff, isChordMember, pitch, fingerText) {
    let x = "<note>";
    if (ev.grace) { x += "<grace/>"; }
    if (isChordMember) { x += "<chord/>"; }
    x += ev.r ? "<rest/>" : pitchXml(pitch);
    if (!ev.grace) { x += "<duration>" + ev.d + "</duration>"; }
    const tie = ev.r ? null : ev.tie;
    if (tie === "start" || tie === "both") { x += '<tie type="start"/>'; }
    if (tie === "stop" || tie === "both") { x += '<tie type="stop"/>'; }
    x += "<voice>" + voice + "</voice><type>" + (ev.type || TYPE_BY_DURATION[ev.d] || "quarter") + "</type>";
    if (ev.tuplet) {
        x += "<time-modification><actual-notes>" + ev.tuplet.actual + "</actual-notes><normal-notes>" +
            ev.tuplet.normal + "</normal-notes></time-modification>";
    }
    x += "<staff>" + (ev.staff || staff) + "</staff>";
    let nt = "";
    if (tie === "start" || tie === "both") { nt += '<tied type="start"/>'; }
    if (tie === "stop" || tie === "both") { nt += '<tied type="stop"/>'; }
    if (ev.tuplet && ev.tuplet.pos) { nt += '<tuplet type="' + ev.tuplet.pos + '"/>'; }
    if (fingerText) { nt += "<technical><fingering>" + fingerText + "</fingering></technical>"; }
    if (nt) { x += "<notations>" + nt + "</notations>"; }
    return x + "</note>";
}

function voiceXml(events, voice, staff) {
    let x = "", total = 0;
    for (const ev of events) {
        const pitches = ev.r ? [null] : [].concat(ev.p);
        pitches.forEach((p, i) => {
            // ev.finger: a string for single notes, an array (one per chord member) for chords
            const f = Array.isArray(ev.finger) ? ev.finger[i] : (i === 0 ? ev.finger : undefined);
            x += noteXml(ev, voice, staff, i > 0, p, f);
        });
        if (!ev.grace) { total += ev.d; }
    }
    return { x: x, total: total };
}

// measure = { s1: [voice, voice...], s2: [voice...] } where a voice is an array of events.
function pianoMeasure(number, m, first) {
    let x = '<measure number="' + number + '">';
    if (first) {
        x += "<attributes><divisions>" + DIVISIONS + "</divisions><key><fifths>0</fifths></key>" +
            "<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>" +
            '<clef number="1"><sign>G</sign><line>2</line></clef>' +
            '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
    }
    let pending = 0;
    const emit = (voices, firstVoiceNumber, staff) => voices.forEach((v, i) => {
        if (pending) { x += "<backup><duration>" + pending + "</duration></backup>"; }
        const r = voiceXml(v, firstVoiceNumber + i, staff);
        x += r.x;
        pending = r.total;
    });
    emit(m.s1 || [], 1, 1);
    emit(m.s2 || [], 5, 2);
    return x + "</measure>";
}

function percussionPartXml(id, measureCount) {
    let x = '<part id="' + id + '">';
    for (let i = 1; i <= measureCount; i++) {
        x += '<measure number="' + i + '">';
        if (i === 1) { x += "<attributes><divisions>" + DIVISIONS + "</divisions><clef><sign>percussion</sign></clef></attributes>"; }
        for (let k = 0; k < 4; k++) {
            x += '<note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched>' +
                '<duration>12</duration><instrument id="' + id + '-I1"/><voice>1</voice><type>quarter</type></note>';
        }
        x += "</measure>";
    }
    return x + "</part>";
}

// options.percussion: add a percussion part (4 quarter notes per measure) after the piano.
function score(measures, options) {
    const o = options || {};
    let partList = '<score-part id="P1"><part-name>Piano</part-name></score-part>';
    if (o.percussion) {
        partList += '<score-part id="P2"><part-name>Drums</part-name>' +
            '<score-instrument id="P2-I1"><instrument-name>Snare</instrument-name></score-instrument>' +
            '<midi-instrument id="P2-I1"><midi-channel>10</midi-channel><midi-program>1</midi-program>' +
            "<midi-unpitched>39</midi-unpitched></midi-instrument></score-part>";
    }
    let x = '<?xml version="1.0" encoding="UTF-8"?>' +
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">' +
        '<score-partwise version="3.1"><work><work-title>' + (o.title || "SPF test") + "</work-title></work>" +
        "<part-list>" + partList + '</part-list><part id="P1">' +
        measures.map((m, i) => pianoMeasure(i + 1, m, i === 0)).join("") + "</part>";
    if (o.percussion) { x += percussionPartXml("P2", measures.length); }
    return x + "</score-partwise>";
}

// ------------------------------------------------------------------ parser
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Returns the notes of an exported MusicXML in document order:
// { part, measure, staff (1-based, global across parts), voice, onset (divisions), midi,
//   rest, grace, chord, tieStart, tieStop, fingers: [text...] }
function parseNotes(xml) {
    const notes = [];
    let staffOffset = 0;
    const partRe = /<part id="([^"]*)">([\s\S]*?)<\/part>/g;
    let pm;
    while ((pm = partRe.exec(xml)) !== null) {
        const partId = pm[1];
        const staves = Number((/<staves>(\d+)<\/staves>/.exec(pm[2]) || [0, 1])[1]);
        const measureRe = /<measure number="([^"]*)"[^>]*>([\s\S]*?)<\/measure>/g;
        let mm;
        while ((mm = measureRe.exec(pm[2])) !== null) {
            let pos = 0, lastOnset = 0;
            const tokenRe = /<(note|backup|forward)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g;
            let tm;
            while ((tm = tokenRe.exec(mm[2])) !== null) {
                const body = tm[2] || "";
                const dur = Number((/<duration>(\d+)<\/duration>/.exec(body) || [0, 0])[1]);
                if (tm[1] === "backup") { pos -= dur; continue; }
                if (tm[1] === "forward") { pos += dur; continue; }
                const grace = /<grace\b/.test(body);
                const chord = /<chord\b/.test(body);
                const isRest = /<rest\b/.test(body);
                const onset = chord ? lastOnset : pos;
                const p = /<pitch>[\s\S]*?<step>([A-G])<\/step>(?:<alter>(-?\d+(?:\.\d+)?)<\/alter>)?[\s\S]*?<octave>(-?\d+)<\/octave>/.exec(body);
                const midi = p ? 12 * (Number(p[3]) + 1) + STEP[p[1]] + (p[2] ? Math.round(Number(p[2])) : 0) : null;
                const fingers = [];
                const fre = /<fingering\b[^>]*>([^<]*)<\/fingering>/g;
                let fm;
                while ((fm = fre.exec(body)) !== null) { fingers.push(fm[1].trim()); }
                notes.push({
                    part: partId, measure: Number(mm[1]), onset: onset,
                    staff: staffOffset + Number((/<staff>(\d+)<\/staff>/.exec(body) || [0, 1])[1]),
                    voice: Number((/<voice>(\d+)<\/voice>/.exec(body) || [0, 1])[1]),
                    midi: midi, rest: isRest, grace: grace, chord: chord,
                    tieStart: /<tie type="start"/.test(body), tieStop: /<tie type="stop"/.test(body),
                    fingers: fingers,
                });
                if (!chord) { lastOnset = onset; }
                if (!chord && !grace) { pos += dur; }
            }
        }
        staffOffset += staves;
    }
    return notes;
}

// Metadata written by the test hook (see lib/harness.js).
function readStatus(xml) { return (/<work-number>([^<]*)<\/work-number>/.exec(xml) || [])[1] || ""; }

module.exports = { DIVISIONS, Q, E, S, H, W, n, rest, score, parseNotes, readStatus };
