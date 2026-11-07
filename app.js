const API_BASE_URL = String(window.CHORDSCOPE_API_BASE || "").replace(/\/+$/, "");
const ANALYZE_URL = `${API_BASE_URL}/api/analyze`;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TRACK_SECONDS = 15 * 60;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|oga|flac|aif|aiff|opus|webm)$/i;
const $ = (id) => document.getElementById(id);
const ui = {
  dropzone: $("dropzone"),
  fileInput: $("file-input"),
  choose: $("choose-file"),
  dropTitle: $("drop-title"),
  dropSubtitle: $("drop-subtitle"),
  trackRow: $("track-row"),
  trackName: $("track-name"),
  trackMeta: $("track-meta"),
  remove: $("remove-track"),
  analyze: $("analyze-button"),
  analyzeLabel: $("analyze-label"),
  cancel: $("cancel-analysis"),
  progress: $("analysis-progress"),
  progressLabel: $("progress-label"),
  progressPercent: $("progress-percent"),
  progressFill: $("progress-fill"),
  notice: $("notice"),
  playerDock: $("player-dock"),
  playerTitle: $("player-title"),
  playerSubtitle: $("player-subtitle"),
  audio: $("audio-player"),
  speed: $("playback-speed"),
  results: $("results"),
};
const state = {
  file: null,
  objectUrl: null,
  duration: 0,
  metadataReady: false,
  durationTooShort: false,
  durationLimitExceeded: false,
  chords: [],
  key: null,
  bpm: null,
  analysisSeconds: null,
  request: null,
  busy: false,
  active: -1,
  view: "simple",
  transpose: 0,
};
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const NOTE_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
function mod(value, base) { return ((value % base) + base) % base; }
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function setNotice(message, isError = false) {
  ui.notice.textContent = message || "";
  ui.notice.hidden = !message;
  ui.notice.classList.toggle("is-error", isError);
}
function setBusy(busy) {
  state.busy = busy;
  ui.analyze.disabled = busy || !state.file || !state.metadataReady || state.durationTooShort || state.durationLimitExceeded;
  ui.analyzeLabel.textContent = busy ? "Analyzing…" : "Analyze track";
  ui.cancel.hidden = !busy;
  ui.choose.disabled = busy;
  ui.remove.disabled = busy;
  ui.dropzone.setAttribute("aria-disabled", String(busy));
  ui.progress.hidden = !busy;
  if (!busy) {
    ui.progress.classList.remove("is-processing");
    ui.progressPercent.textContent = "";
    ui.progressFill.style.width = "0%";
  }
}
function clearAnalysis() {
  state.chords = [];
  state.key = null;
  state.bpm = null;
  state.analysisSeconds = null;
  state.active = -1;
  ui.results.hidden = true;
  ui.results.innerHTML = "";
}
function clearTrack() {
  if (state.request) {
    state.request.abort();
    state.request = null;
  }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.file = null;
  state.objectUrl = null;
  state.duration = 0;
  state.metadataReady = false;
  state.durationTooShort = false;
  state.durationLimitExceeded = false;
  ui.fileInput.value = "";
  ui.audio.pause();
  ui.audio.removeAttribute("src");
  ui.audio.load();
  ui.audio.hidden = true;
  ui.playerDock.hidden = true;
  document.body.classList.remove("has-player");
  ui.trackRow.hidden = true;
  ui.dropTitle.textContent = "Drop your audio here";
  ui.dropSubtitle.textContent = "or choose a file from your device";
  ui.choose.innerHTML = "Choose audio <span aria-hidden=\"true\">↗</span>";
  ui.playerTitle.textContent = "No track selected";
  ui.playerSubtitle.textContent = "Choose a track to begin";
  ui.speed.value = "1";
  ui.audio.playbackRate = 1;
  setBusy(false);
  setNotice("");
  clearAnalysis();
}
function acceptFile(file) {
  if (!file) return;
  const looksLikeAudio = file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name);
  if (!looksLikeAudio) {
    setNotice("That file does not look like audio. Choose an audio recording to continue.", true);
    return;
  }
  if (file.size === 0) {
    setNotice("That audio file is empty. Choose another recording to continue.", true);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setNotice("This file is larger than 100 MB. Choose a smaller audio file to continue.", true);
    return;
  }
  if (state.request) {
    state.request.abort();
    state.request = null;
  }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  clearAnalysis();
  setBusy(false);
  setNotice("");
  state.file = file;
  state.duration = 0;
  state.metadataReady = false;
  state.durationTooShort = false;
  state.durationLimitExceeded = false;
  state.objectUrl = URL.createObjectURL(file);
  ui.audio.src = state.objectUrl;
  ui.audio.hidden = false;
  ui.audio.load();
  ui.audio.playbackRate = 1;
  ui.speed.value = "1";
  ui.playerDock.hidden = false;
  document.body.classList.add("has-player");
  ui.trackRow.hidden = false;
  ui.trackName.textContent = file.name;
  ui.trackMeta.textContent = `${formatSize(file.size)} · Reading track length…`;
  ui.playerTitle.textContent = file.name;
  ui.playerSubtitle.textContent = "Ready to analyze";
  ui.dropTitle.textContent = "Track ready to analyze";
  ui.dropSubtitle.textContent = "Choose another file to switch tracks";
  ui.choose.innerHTML = "Change audio <span aria-hidden=\"true\">↗</span>";
  ui.analyze.disabled = true;
}
function parseTime(value) {
  if (Number.isFinite(value)) return value >= 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const pieces = value.trim().split(":");
  if (pieces.length === 1 && /^\d+(\.\d+)?$/.test(pieces[0])) return Number(pieces[0]);
  if (pieces.length > 3 || pieces.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  return pieces.reduce((sum, part) => sum * 60 + Number(part), 0);
}
function normalizeChords(raw) {
  if (!Array.isArray(raw)) return [];
  const chords = raw.map((item, index) => {
    const label = typeof item === "string"
      ? item
      : item && (item.chord ?? item.name ?? item.label ?? item.symbol);
    const time = typeof item === "string"
      ? null
      : parseTime(item?.time ?? item?.start ?? item?.start_time ?? item?.timestamp);
    if (label == null || !String(label).trim()) return null;
    return {
      label: String(label).trim(),
      time,
      duration: Number.isFinite(item?.duration) && item.duration >= 0 ? item.duration : null,
      confidence: Number.isFinite(item?.confidence) ? Math.max(0, Math.min(1, item.confidence)) : null,
      index,
    };
  }).filter(Boolean);
  if (chords.some((chord) => chord.time !== null)) {
    chords.sort((a, b) => a.time === null ? 1 : b.time === null ? -1 : a.time - b.time || a.index - b.index);
  }
  return chords;
}
function parseNote(note) {
  const match = String(note).trim().match(/^([A-Ga-g])([#b♯♭]?)(.*)$/);
  if (!match) return null;
  let pitch = NOTE_PITCH[match[1].toUpperCase()];
  if (match[2] === "#" || match[2] === "♯") pitch += 1;
  if (match[2] === "b" || match[2] === "♭") pitch -= 1;
  return { pitch: mod(pitch, 12), letter: match[1].toUpperCase(), accidental: match[2], rest: match[3] };
}
function parseChord(symbol) {
  const match = String(symbol).trim().match(/^([A-Ga-g][#b♯♭]?)(.*)$/);
  if (!match) return null;
  const note = parseNote(match[1]);
  if (!note) return null;
  const suffix = match[2].split("/")[0].toLowerCase();
  const quality = /(dim|°|ø|m7b5)/.test(suffix) ? "diminished"
    : /(aug|\+)/.test(suffix) ? "augmented"
      : /^(m(?!aj)|min|-)/.test(suffix) ? "minor" : "major";
  return { pitch: note.pitch, quality };
}
function correlation(left, right) {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0, leftPower = 0, rightPower = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] - leftMean, b = right[i] - rightMean;
    numerator += a * b;
    leftPower += a * a;
    rightPower += b * b;
  }
  const denominator = Math.sqrt(leftPower * rightPower);
  return denominator ? numerator / denominator : 0;
}
function estimateKey(chords) {
  const parsed = chords.map((chord) => ({ ...parseChord(chord.label), duration: chord.duration || 1 }))
    .filter((chord) => chord.pitch !== undefined);
  if (!parsed.length) return null;
  const energy = Array(12).fill(0);
  const totalDuration = parsed.reduce((sum, chord) => sum + chord.duration, 0);
  parsed.forEach((chord) => {
    const intervals = chord.quality === "minor" ? [0, 3, 7]
      : chord.quality === "diminished" ? [0, 3, 6]
        : chord.quality === "augmented" ? [0, 4, 8] : [0, 4, 7];
    intervals.forEach((interval, index) => {
      const strength = [1.4, 1.05, 0.8][index];
      energy[mod(chord.pitch + interval, 12)] += chord.duration * strength;
    });
  });
  for (let i = 0; i < 12; i += 1) energy[i] /= totalDuration;
  const profiles = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  };
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
  };
  const expected = {
    major: ["major", "minor", "minor", "major", "major", "minor", "diminished"],
    minor: ["minor", "diminished", "major", "minor", "minor", "major", "major"],
  };
  const candidates = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const mode of ["major", "minor"]) {
      const rotated = Array.from({ length: 12 }, (_, pc) => profiles[mode][mod(pc - tonic, 12)]);
      const tonalFit = correlation(energy, rotated);
      let harmonyFit = 0;
      parsed.forEach((chord) => {
        const degree = scales[mode].indexOf(mod(chord.pitch - tonic, 12));
        let fit = degree < 0 ? -0.24 : 0.28;
        if (degree >= 0) {
          if (chord.quality === expected[mode][degree]) fit += 0.28;
          else if (mode === "minor" && degree === 4 && chord.quality === "major") fit += 0.12;
          else fit -= chord.quality === "augmented" ? 0.12 : 0.08;
          if (degree === 0) fit += 0.12;
          if (degree === 4 && chord.quality === "major") fit += 0.06;
        }
        harmonyFit += fit * chord.duration / totalDuration;
      });
      candidates.push({ tonic, mode, score: tonalFit * 0.72 + harmonyFit * 0.28 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const margin = best.score - candidates[1].score;
  const confidence = new Set(parsed.map((chord) => chord.pitch)).size < 2
    ? "limited"
    : margin >= 0.075 ? "strong" : margin >= 0.035 ? "moderate" : "exploratory";
  return {
    tonic: best.tonic,
    mode: best.mode,
    confidence,
    rootCount: new Set(parsed.map((chord) => chord.pitch)).size,
    notes: (best.mode === "major" ? scales.major : scales.minor).map((step) => mod(best.tonic + step, 12)),
  };
}
function normalizeKey(raw, chords) {
  const source = typeof raw === "string" ? raw.match(/^([A-G][#b♯♭]?)\s+(major|minor)$/i) : null;
  const tonicValue = raw && typeof raw === "object" ? raw.tonic ?? raw.root : source?.[1];
  const modeValue = raw && typeof raw === "object" ? raw.mode : source?.[2];
  const note = Number.isInteger(tonicValue) ? { pitch: mod(tonicValue, 12) } : parseNote(tonicValue || "");
  if (!note || !/^(major|minor|maj|min)$/i.test(String(modeValue || ""))) return estimateKey(chords);
  const mode = /^min/i.test(String(modeValue)) ? "minor" : "major";
  const confidenceValue = raw && typeof raw === "object" ? raw.confidence : null;
  const confidence = typeof confidenceValue === "string"
    ? confidenceValue.toLowerCase()
    : Number.isFinite(confidenceValue) ? confidenceValue >= 0.18 ? "strong" : confidenceValue >= 0.08 ? "moderate" : "exploratory"
      : "moderate";
  return {
    tonic: note.pitch,
    mode,
    confidence,
    rootCount: raw?.root_count ?? new Set(chords.map((chord) => parseChord(chord.label)?.pitch).filter(Number.isInteger)).size,
    notes: (mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10])
      .map((step) => mod(note.pitch + step, 12)),
  };
}
function transposeNote(note) {
  const parsed = parseNote(note);
  if (!parsed) return note;
  if (state.transpose === 0) return parsed.letter + parsed.accidental.replace("♭", "b").replace("♯", "#") + parsed.rest;
  return NOTE_NAMES[mod(parsed.pitch + state.transpose, 12)] + parsed.rest;
}
function displayChord(chord) {
  const [rootPart, bassPart] = chord.label.split("/");
  const match = rootPart.match(/^([A-Ga-g][#b♯♭]?)(.*)$/);
  if (!match) return chord.label;
  const quality = parseChord(chord.label)?.quality || "major";
  const simpleSuffix = /sus[24]|5/i.test(match[2]) ? match[2]
    : quality === "minor" ? "m" : quality === "diminished" ? "dim" : quality === "augmented" ? "+" : "";
  const suffix = state.view === "simple" ? simpleSuffix : match[2];
  return transposeNote(match[1]) + suffix + (bassPart ? `/${transposeNote(bassPart)}` : "");
}
function chordNotes(chord) {
  const root = parseChord(chord.label);
  if (!root) return "";
  const suffix = chord.label.split("/")[0].replace(/^[A-G][#b♯♭]?/i, "").toLowerCase();
  const intervals = /^(m7b5|ø)/.test(suffix) ? [0, 3, 6, 10]
    : /^(dim7|°7)/.test(suffix) ? [0, 3, 6, 9]
      : /^m7/.test(suffix) ? [0, 3, 7, 10]
        : /^(maj7|ma7|Δ)/.test(suffix) ? [0, 4, 7, 11]
          : /^7/.test(suffix) ? [0, 4, 7, 10]
            : /^(sus2)/.test(suffix) ? [0, 2, 7]
              : /^(sus4|sus)/.test(suffix) ? [0, 5, 7]
                : /^(5)$/.test(suffix) ? [0, 7]
                  : root.quality === "minor" ? [0, 3, 7]
                    : root.quality === "diminished" ? [0, 3, 6]
                      : root.quality === "augmented" ? [0, 4, 8] : [0, 4, 7];
  return intervals.map((interval) => NOTE_NAMES[mod(root.pitch + interval + state.transpose, 12)]).join(" · ");
}
function romanNumeral(chord, key) {
  const root = parseChord(chord.label);
  if (!root || !key) return "—";
  const scale = key.mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const degree = scale.indexOf(mod(root.pitch - key.tonic, 12));
  if (degree < 0) return "—";
  let name = ["I", "II", "III", "IV", "V", "VI", "VII"][degree];
  if (root.quality === "minor" || (root.quality === "diminished" && key.mode === "major")) name = name.toLowerCase();
  if (root.quality === "diminished") name += "°";
  if (root.quality === "augmented") name += "+";
  return name;
}
function withDurations(chords) {
  return chords.map((chord, index) => {
    if (chord.duration !== null) return chord;
    const next = chords.slice(index + 1).find((item) => item.time !== null && chord.time !== null && item.time > chord.time);
    const end = next ? next.time : state.duration;
    return { ...chord, duration: chord.time !== null && end > chord.time ? end - chord.time : null };
  });
}
function confidenceText(key) {
  if (key.confidence === "limited") return "Early hint · limited chord changes";
  if (key.confidence === "strong" || key.confidence === "high") return "Strong match in this recording";
  if (key.confidence === "moderate" || key.confidence === "medium") return "Moderate match in this recording";
  return "Close alternatives · treat as a guide";
}
function renderKey(chords, key) {
  if (!key) return `<div class="empty-results">The analyzer could not determine a key from this track. The chord progression is still available below.</div>`;
  const tonic = NOTE_NAMES[mod(key.tonic + state.transpose, 12)];
  const relativePitch = mod(key.tonic + (key.mode === "major" ? 9 : 3) + state.transpose, 12);
  const confidenceClass = key.confidence === "moderate" || key.confidence === "medium"
    ? "is-moderate" : key.confidence === "strong" || key.confidence === "high" ? "" : "is-limited";
  const notes = key.notes.map((pitch) =>
    `<span class="scale-note${pitch === key.tonic ? " is-tonic" : ""}">${NOTE_NAMES[mod(pitch + state.transpose, 12)]}</span>`
  ).join("");
  const unique = new Set(chords.map((chord) => chord.label)).size;
  const bpmValue = Number.isFinite(state.bpm) && state.bpm > 0 ? `${Math.round(state.bpm)} BPM` : "—";
  const analyzed = Number.isFinite(state.analysisSeconds) ? `${state.analysisSeconds.toFixed(1)} sec analysis` : "Audio analysis";
  return `<div class="key-layout">
    <article class="key-card"><div class="card-overline">KEY ESTIMATE · FROM AUDIO</div>
      <div class="key-content"><div class="key-mark">${escapeHtml(tonic)}<small>${key.mode === "major" ? "maj" : "min"}</small></div>
        <div class="key-copy"><div class="key-name"><strong>${escapeHtml(tonic)} ${key.mode}</strong></div>
          <div class="confidence ${confidenceClass}"><span class="confidence-dot"></span>${escapeHtml(confidenceText(key))}</div></div></div>
      <div class="scale-wrap"><div class="scale-label">SCALE NOTES</div><div class="scale-notes">${notes}</div></div>
    </article>
    <article class="insight-card"><div><div class="card-overline">TRACK AT A GLANCE</div>
      <div class="insight-main"><strong>${chords.length} chord changes</strong><span>${unique} unique chords · ${escapeHtml(analyzed)}</span></div></div>
      <div><div class="insight-divider"></div><div class="insight-foot"><span>Tempo</span><strong>${escapeHtml(bpmValue)}</strong></div>
        <div class="insight-foot" style="margin-top:9px"><span>Relative key</span><strong>${NOTE_NAMES[relativePitch]} ${key.mode === "major" ? "minor" : "major"}</strong></div>
        <div class="insight-foot" style="margin-top:9px"><span>Track length</span><strong>${escapeHtml(formatTime(state.duration))}</strong></div></div>
    </article></div>`;
}
function renderProgression(chords, key) {
  const tokens = chords.map((chord, index) =>
    `<button class="strip-chord${index === state.active ? " is-active" : ""}" type="button" data-index="${index}" aria-current="${index === state.active ? "time" : "false"}" aria-label="Jump to ${escapeHtml(displayChord(chord))} at ${escapeHtml(formatTime(chord.time))}"><strong>${escapeHtml(displayChord(chord))}</strong><span>${escapeHtml(formatTime(chord.time))}</span></button>`
  ).join("");
  const rows = chords.map((chord, index) =>
    `<button class="chord-row${index === state.active ? " is-active" : ""}" type="button" data-index="${index}" aria-current="${index === state.active ? "time" : "false"}" aria-label="Play ${escapeHtml(displayChord(chord))} from ${escapeHtml(formatTime(chord.time))}">
      <span class="chord-main"><span class="degree">${escapeHtml(romanNumeral(chord, key))}</span><span class="chord-symbol">${escapeHtml(displayChord(chord))}</span></span>
      <span class="chord-start">${escapeHtml(formatTime(chord.time))}</span>
      <span class="chord-duration">${chord.duration === null ? "—" : escapeHtml(formatTime(chord.duration))}</span>
      <span class="chord-play" aria-hidden="true"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.1 3.6c0-.5.55-.8.98-.53l6.05 4.02a1.1 1.1 0 0 1 0 1.82l-6.05 4.02c-.43.28-.98-.03-.98-.54V3.6Z"/></svg></span>
    </button>`
  ).join("");
  const activeChord = state.active >= 0 ? state.chords[state.active] : null;
  return `<article class="progression-card"><div class="progression-top"><div class="progression-title"><h3>Follow the chords</h3><span>${chords.length} EVENTS</span></div>
    <div class="live-chord"><span class="live-state" id="live-state">${activeChord ? "SELECTED" : "READY"}</span>
      <strong id="live-chord-name">${activeChord ? escapeHtml(displayChord(activeChord)) : "—"}</strong>
      <span id="live-chord-time">${activeChord ? escapeHtml(formatTime(activeChord.time)) : "Press play"}</span>
      <small id="live-chord-notes">${activeChord ? escapeHtml(chordNotes(activeChord)) : ""}</small></div></div>
    <div class="progression-strip" aria-label="Chord timeline">${tokens}</div>
    <div class="chord-table-head"><span>CHORD</span><span>START</span><span>LENGTH</span><span></span></div>
    <div class="chord-list" id="chord-list">${rows}</div></article>`;
}
function renderResults() {
  const chords = withDurations(state.chords);
  ui.results.hidden = false;
  const trackName = state.file?.name || "Track analysis";
  ui.results.innerHTML = `<div class="results-heading"><div class="results-heading-copy"><div class="results-label">02 / HARMONY REPORT</div>
    <h2 title="${escapeHtml(trackName)}">${escapeHtml(trackName)}</h2></div><div class="result-actions">
    <button class="button button-small" type="button" data-action="export"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4 13.5v2A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>Export CSV</button>
    <button class="button button-small" type="button" data-action="new">New track</button></div></div>
    <div class="practice-toolbar"><div class="chord-view-toggle" role="group" aria-label="Chord detail">
      <button class="${state.view === "simple" ? "is-active" : ""}" type="button" data-action="view-simple" aria-pressed="${state.view === "simple"}">Simple</button>
      <button class="${state.view === "full" ? "is-active" : ""}" type="button" data-action="view-full" aria-pressed="${state.view === "full"}">Full</button>
    </div><div class="transpose-control"><span>Transpose display</span>
      <button type="button" data-action="transpose-down" aria-label="Transpose down one semitone">−</button>
      <strong id="transpose-value">${state.transpose > 0 ? "+" : ""}${state.transpose} st</strong>
      <button type="button" data-action="transpose-up" aria-label="Transpose up one semitone">+</button>
    </div></div>
    ${renderKey(chords, state.key)}${chords.length ? renderProgression(chords, state.key) : `<div class="empty-results">No chord changes were returned for this track. Try a clearer recording with less background noise.</div>`}`;
  if (state.active >= 0) setActive(state.active);
  else syncActive();
}
function setActive(index) {
  if (!state.chords.length) return;
  state.active = index < 0 ? -1 : Math.max(0, Math.min(index, state.chords.length - 1));
  ui.results.querySelectorAll("[data-index]").forEach((element) => {
    const isActive = Number(element.dataset.index) === state.active;
    element.classList.toggle("is-active", isActive);
    element.setAttribute("aria-current", isActive ? "time" : "false");
  });
  updateLiveChord();
  if (state.active < 0) return;
  const strip = ui.results.querySelector(".progression-strip");
  const token = strip?.querySelector(`[data-index="${state.active}"]`);
  if (strip && token) {
    const tokenBox = token.getBoundingClientRect(), stripBox = strip.getBoundingClientRect();
    const left = strip.scrollLeft + tokenBox.left - stripBox.left - (strip.clientWidth - token.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }
  const list = ui.results.querySelector("#chord-list");
  const row = list?.querySelector(`.chord-row[data-index="${state.active}"]`);
  if (list && row) {
    const rowBox = row.getBoundingClientRect(), listBox = list.getBoundingClientRect();
    const top = list.scrollTop + rowBox.top - listBox.top - (list.clientHeight - row.clientHeight) / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }
}
function updateLiveChord() {
  const stateLabel = ui.results.querySelector("#live-state");
  const chordLabel = ui.results.querySelector("#live-chord-name");
  const time = ui.results.querySelector("#live-chord-time");
  if (!stateLabel || !chordLabel || !time) return;
  const chord = state.active >= 0 ? state.chords[state.active] : null;
  stateLabel.textContent = ui.audio.paused ? (chord ? "SELECTED" : "READY") : "NOW PLAYING";
  chordLabel.textContent = chord ? displayChord(chord) : "—";
  time.textContent = chord ? formatTime(chord.time) : "Press play";
  const notes = ui.results.querySelector("#live-chord-notes");
  if (notes) notes.textContent = chord ? chordNotes(chord) : "";
}
function syncActiveChord() {
  if (!state.chords.length || !Number.isFinite(ui.audio.currentTime)) return;
  const timed = state.chords.map((chord, index) => ({ chord, index })).filter((item) => item.chord.time !== null);
  if (!timed.length) return;
  let active = -1;
  for (const item of timed) {
    if (item.chord.time <= ui.audio.currentTime) active = item.index;
    else break;
  }
  if (active !== state.active) setActive(active);
}
function seekToChord(event) {
  const button = event.target.closest("[data-index]");
  if (!button || !ui.results.contains(button)) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index) || !state.chords[index]) return;
  setActive(index);
  const time = state.chords[index].time;
  if (time !== null) {
    ui.audio.currentTime = time;
    ui.audio.play().catch(() => {});
  }
}
function exportCsv() {
  if (!state.chords.length) {
    setNotice("There are no chord events to export.", true);
    return;
  }
  const rows = [
    ["track", "estimated_key", "confidence", "chord", "roman_numeral", "start_seconds", "start_time", "duration_seconds"],
    ...withDurations(state.chords).map((chord) => [
      state.file?.name || "",
      state.key ? `${NOTE_NAMES[mod(state.key.tonic + state.transpose, 12)]} ${state.key.mode}` : "",
      state.key?.confidence || "",
      displayChord(chord),
      romanNumeral(chord, state.key),
      chord.time ?? "",
      chord.time === null ? "" : formatTime(chord.time),
      chord.duration ?? "",
    ]),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const downloadUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `${(state.file?.name || "chordscope").replace(/\.[^.]+$/, "")}-harmony.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
function startAnalysis() {
  if (!state.file || state.busy || !state.metadataReady || state.durationTooShort || state.durationLimitExceeded) return;
  clearAnalysis();
  setNotice("");
  setBusy(true);
  ui.playerSubtitle.textContent = "Analyzing the audio…";
  ui.progressLabel.textContent = "Uploading audio…";
  ui.progressPercent.textContent = "";
  ui.progressFill.style.width = "0%";
  const form = new FormData();
  form.append("audio", state.file);
  const request = new XMLHttpRequest();
  state.request = request;
  request.open("POST", ANALYZE_URL);
  request.timeout = 300000;
  request.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round(event.loaded / event.total * 100);
    ui.progressLabel.textContent = percent >= 100 ? "Audio received · analysis in progress…" : "Uploading audio…";
    ui.progressPercent.textContent = percent >= 100 ? "Received" : `${percent}%`;
    ui.progressFill.style.width = percent >= 100 ? "42%" : `${percent}%`;
    ui.progress.classList.toggle("is-processing", percent >= 100);
  });
  request.addEventListener("load", () => {
    if (state.request !== request) return;
    state.request = null;
    setBusy(false);
    let body = {};
    try { body = JSON.parse(request.responseText); } catch {}
    if (request.status < 200 || request.status >= 300) {
      ui.playerSubtitle.textContent = "Analysis needs attention";
      if (!API_BASE_URL && !["localhost", "127.0.0.1"].includes(window.location.hostname) && request.status === 404) {
        setNotice("The public analyzer API is not connected yet. Set CHORDSCOPE_API_BASE in the Netlify build settings after deploying the Python API.", true);
        return;
      }
      setNotice(body.detail || body.message || `Analysis failed (${request.status}).`, true);
      return;
    }
    state.chords = normalizeChords(body.chords);
    state.duration = Number.isFinite(body.duration) && body.duration > 0 ? body.duration : state.duration;
    state.key = normalizeKey(body.key, state.chords);
    state.bpm = Number.isFinite(body.bpm) && body.bpm > 0 ? body.bpm : null;
    state.analysisSeconds = Number.isFinite(body.analysis_seconds) ? body.analysis_seconds : null;
    ui.playerSubtitle.textContent = state.chords.length
      ? `Chord map ready${state.analysisSeconds === null ? "" : ` · ${state.analysisSeconds.toFixed(1)} sec`}`
      : "No chord changes found";
    setNotice(state.chords.length ? "" : "Analysis finished, but no chord changes were found. Try a clearer recording.", !state.chords.length);
    renderResults();
  });
  request.addEventListener("error", () => {
    if (state.request !== request) return;
    state.request = null;
    setBusy(false);
    ui.playerSubtitle.textContent = "Local analyzer is offline";
    setNotice("Could not reach the local analyzer. Start it with start.bat, then open http://127.0.0.1:8000.", true);
  });
  request.addEventListener("timeout", () => {
    if (state.request !== request) return;
    state.request = null;
    setBusy(false);
    ui.playerSubtitle.textContent = "Analysis timed out";
    setNotice("This track took too long to analyze. Try a shorter file.", true);
  });
  request.addEventListener("abort", () => {
    if (state.request !== request) return;
    state.request = null;
    setBusy(false);
    ui.playerSubtitle.textContent = "Analysis cancelled";
    setNotice("Analysis cancelled.");
  });
  request.send(form);
}

ui.choose.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!state.busy) ui.fileInput.click();
});
ui.fileInput.addEventListener("change", () => {
  acceptFile(ui.fileInput.files?.[0]);
  ui.fileInput.value = "";
});
ui.dropzone.addEventListener("click", (event) => {
  if (!event.target.closest("button") && !state.busy) ui.fileInput.click();
});
ui.dropzone.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target === ui.dropzone && !state.busy) {
    event.preventDefault();
    ui.fileInput.click();
  }
});
ui.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!state.busy) ui.dropzone.classList.add("is-dragging");
});
ui.dropzone.addEventListener("dragleave", (event) => {
  if (!ui.dropzone.contains(event.relatedTarget)) ui.dropzone.classList.remove("is-dragging");
});
ui.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  ui.dropzone.classList.remove("is-dragging");
  if (!state.busy) acceptFile(event.dataTransfer?.files?.[0]);
});
ui.remove.addEventListener("click", clearTrack);
ui.analyze.addEventListener("click", startAnalysis);
ui.cancel.addEventListener("click", () => state.request?.abort());
ui.audio.addEventListener("loadedmetadata", () => {
  state.metadataReady = true;
  state.duration = Number.isFinite(ui.audio.duration) ? ui.audio.duration : 0;
  state.durationTooShort = state.duration > 0 && state.duration < 1;
  state.durationLimitExceeded = state.duration > MAX_TRACK_SECONDS;
  if (state.file) {
    ui.trackMeta.textContent = `${formatSize(state.file.size)} · ${formatTime(state.duration)}`;
    ui.analyze.disabled = state.busy || state.durationTooShort || state.durationLimitExceeded;
  }
  if (state.durationTooShort) {
    setNotice("This recording is shorter than one second. Choose a longer audio file.", true);
  } else if (state.durationLimitExceeded) {
    setNotice("This track is longer than 15 minutes. Choose a shorter file for now.", true);
  }
  if (!ui.results.hidden) renderResults();
});
ui.audio.addEventListener("error", () => {
  if (!state.file) return;
  state.metadataReady = true;
  ui.analyze.disabled = state.busy || state.durationTooShort || state.durationLimitExceeded;
  ui.trackMeta.textContent = `${formatSize(state.file.size)} · preview unavailable in this browser`;
  setNotice("This browser cannot play the selected file. You can still analyze it, but use MP3 or WAV to follow along.");
});
ui.audio.addEventListener("timeupdate", syncActiveChord);
ui.audio.addEventListener("play", updateLiveChord);
ui.audio.addEventListener("pause", updateLiveChord);
ui.speed.addEventListener("change", () => { ui.audio.playbackRate = Number(ui.speed.value); });
ui.results.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "export") exportCsv();
  if (action === "new") { clearTrack(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  if (action === "view-simple") { state.view = "simple"; renderResults(); }
  if (action === "view-full") { state.view = "full"; renderResults(); }
  if (action === "transpose-down") { state.transpose = Math.max(-12, state.transpose - 1); renderResults(); }
  if (action === "transpose-up") { state.transpose = Math.min(12, state.transpose + 1); renderResults(); }
  seekToChord(event);
});
