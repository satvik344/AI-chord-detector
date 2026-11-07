from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any

import librosa
import numpy as np

SAMPLE_RATE = 22_050
# A 46 ms analysis grid keeps chord boundaries responsive while cutting the
# chroma/Viterbi frame count in half compared with the 512-sample default.
HOP_LENGTH = 1024
NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
MAJOR_QUALITIES = ["major", "minor", "minor", "major", "major", "minor", "diminished"]
MINOR_QUALITIES = ["minor", "diminished", "major", "minor", "minor", "major", "major"]


@dataclass(frozen=True)
class ChordTemplate:
    label: str
    root: int
    quality: str
    notes: tuple[int, ...]
    vector: np.ndarray


def _make_templates() -> list[ChordTemplate]:
    chord_types: list[tuple[str, str, tuple[int, ...], tuple[float, ...]]] = [
        ("", "major", (0, 4, 7), (1.35, 1.0, 0.82)),
        ("m", "minor", (0, 3, 7), (1.35, 1.0, 0.82)),
        ("dim", "diminished", (0, 3, 6), (1.35, 1.0, 0.82)),
        ("aug", "augmented", (0, 4, 8), (1.35, 1.0, 0.82)),
        ("sus2", "suspended", (0, 2, 7), (1.35, 0.95, 0.82)),
        ("sus4", "suspended", (0, 5, 7), (1.35, 0.95, 0.82)),
        ("7", "major", (0, 4, 7, 10), (1.3, 0.95, 0.76, 0.55)),
        ("maj7", "major", (0, 4, 7, 11), (1.3, 0.95, 0.76, 0.55)),
        ("m7", "minor", (0, 3, 7, 10), (1.3, 0.95, 0.76, 0.55)),
        ("m7b5", "diminished", (0, 3, 6, 10), (1.3, 0.95, 0.76, 0.55)),
        ("dim7", "diminished", (0, 3, 6, 9), (1.3, 0.95, 0.76, 0.55)),
    ]
    templates: list[ChordTemplate] = []
    for root in range(12):
        for suffix, quality, intervals, weights in chord_types:
            label = f"{NOTE_NAMES[root]}{suffix}"
            vector = np.zeros(12, dtype=np.float32)
            for interval, weight in zip(intervals, weights, strict=True):
                vector[(root + interval) % 12] = weight
            vector /= np.linalg.norm(vector)
            templates.append(
                ChordTemplate(
                    label=label,
                    root=root,
                    quality=quality,
                    notes=tuple((root + interval) % 12 for interval in intervals),
                    vector=vector,
                )
            )
    return templates


CHORDS = _make_templates()


def _cosine_profile(chroma: np.ndarray, profile: np.ndarray) -> float:
    centered_chroma = chroma - chroma.mean()
    centered_profile = profile - profile.mean()
    denominator = np.linalg.norm(centered_chroma) * np.linalg.norm(centered_profile)
    if denominator <= 1e-12:
        return 0.0
    return float(np.dot(centered_chroma, centered_profile) / denominator)


def _estimate_key(
    chroma: np.ndarray,
    frame_energy: np.ndarray,
    segments: list[dict[str, Any]],
) -> dict[str, Any] | None:
    active = frame_energy > max(1e-5, float(np.max(frame_energy)) * 0.08)
    if not np.any(active):
        return None
    weights = frame_energy[active]
    chroma_profile = np.average(chroma[:, active], axis=1, weights=weights)
    candidates: list[tuple[float, int, str]] = []

    for tonic in range(12):
        for mode, profile, scale, expected in (
            ("major", MAJOR_PROFILE, MAJOR_SCALE, MAJOR_QUALITIES),
            ("minor", MINOR_PROFILE, MINOR_SCALE, MINOR_QUALITIES),
        ):
            rotated = np.roll(profile, tonic)
            tonal_score = _cosine_profile(chroma_profile, rotated)
            harmonic_score = 0.0
            total_weight = 0.0
            for segment in segments:
                chord = CHORDS[segment["template"]]
                duration = max(0.2, segment["duration"])
                degree = scale.index((chord.root - tonic) % 12) if (chord.root - tonic) % 12 in scale else -1
                fit = -0.24 if degree < 0 else 0.28
                if degree >= 0:
                    if chord.quality == expected[degree]:
                        fit += 0.28
                    elif mode == "minor" and degree == 4 and chord.quality == "major":
                        fit += 0.12
                    else:
                        fit -= 0.08
                    if degree == 0:
                        fit += 0.12
                    if degree == 4 and chord.quality == "major":
                        fit += 0.06
                harmonic_score += fit * duration
                total_weight += duration
            chord_score = harmonic_score / total_weight if total_weight else 0.0
            candidates.append((tonal_score * 0.72 + chord_score * 0.28, tonic, mode))

    candidates.sort(key=lambda candidate: candidate[0], reverse=True)
    best = candidates[0]
    margin = best[0] - candidates[1][0]
    unique_roots = len({CHORDS[segment["template"]].root for segment in segments})
    confidence = "limited" if unique_roots < 2 else "strong" if margin >= 0.12 else "moderate" if margin >= 0.055 else "exploratory"
    return {
        "tonic": NOTE_NAMES[best[1]],
        "mode": best[2],
        "confidence": confidence,
        "margin": round(float(margin), 4),
        "root_count": unique_roots,
    }


def _viterbi_decode(scores: np.ndarray, quiet_frames: np.ndarray) -> np.ndarray:
    chord_count, frame_count = scores.shape
    state_count = chord_count + 1
    emissions = np.vstack([scores, np.full(frame_count, 0.15, dtype=np.float32)])
    emissions[-1, quiet_frames] = 1.0

    best_scores = emissions[:, 0].copy()
    backpointers = np.zeros((frame_count, state_count), dtype=np.uint8)
    state_indices = np.arange(state_count)
    for frame in range(1, frame_count):
        best_index = int(np.argmax(best_scores))
        other_indices = np.full(state_count, best_index, dtype=np.int16)
        second_index = int(np.argmax(np.where(state_indices == best_index, -np.inf, best_scores)))
        other_indices[best_index] = second_index
        switch_cost = np.where((state_indices == chord_count) | (other_indices == chord_count), 0.08, 0.17)
        switch_scores = best_scores[other_indices] - switch_cost
        switched = switch_scores > best_scores
        backpointers[frame] = np.where(switched, other_indices, state_indices)
        best_scores = np.maximum(switch_scores, best_scores) + emissions[:, frame]

    path = np.empty(frame_count, dtype=np.int16)
    path[-1] = int(np.argmax(best_scores))
    for frame in range(frame_count - 1, 0, -1):
        path[frame - 1] = backpointers[frame, path[frame]]
    return path


def _segments_from_path(
    path: np.ndarray,
    scores: np.ndarray,
    duration: float,
    frame_seconds: float,
) -> list[dict[str, Any]]:
    if not len(path):
        return []
    boundaries = np.flatnonzero(np.diff(path) != 0) + 1
    starts = np.r_[0, boundaries]
    ends = np.r_[boundaries, len(path)]
    segments: list[dict[str, Any]] = []
    no_chord_state = scores.shape[0]

    for start, end in zip(starts, ends, strict=True):
        template = int(path[start])
        if template == no_chord_state:
            continue
        segment_duration = max(0.0, min(duration, end * frame_seconds) - start * frame_seconds)
        if segment_duration <= 0:
            continue
        confidence = float(np.mean(scores[template, start:end])) if end > start else 0.0
        segments.append({
            "template": template,
            "start": round(float(start * frame_seconds), 2),
            "duration": round(float(segment_duration), 2),
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
        })

    # Remove very short flickers by folding them into the stronger neighboring chord.
    changed = True
    while changed and len(segments) > 1:
        changed = False
        for index, segment in enumerate(segments):
            if segment["duration"] >= 0.42:
                continue
            neighbors = []
            if index > 0:
                neighbors.append((segments[index - 1]["confidence"], index - 1))
            if index + 1 < len(segments):
                neighbors.append((segments[index + 1]["confidence"], index + 1))
            if not neighbors:
                continue
            _, target_index = max(neighbors)
            target = segments[target_index]
            start = min(segment["start"], target["start"])
            end = max(segment["start"] + segment["duration"], target["start"] + target["duration"])
            target["start"] = round(start, 2)
            target["duration"] = round(end - start, 2)
            target["confidence"] = round((target["confidence"] + segment["confidence"]) / 2, 3)
            segments.pop(index)
            changed = True
            break

    return segments


def analyze_audio(path: str) -> dict[str, Any]:
    started = perf_counter()
    try:
        signal, sample_rate = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    except Exception as exc:
        raise ValueError("The audio could not be decoded. Try WAV, MP3, FLAC, or install FFmpeg for M4A/Opus.") from exc

    if signal.size < SAMPLE_RATE:
        raise ValueError("This recording is too short. Choose at least one second of audio.")
    if not np.all(np.isfinite(signal)):
        signal = np.nan_to_num(signal)
    duration = float(signal.size / sample_rate)
    if duration > 15 * 60:
        raise ValueError("This recording is longer than 15 minutes. Use a shorter track for now.")
    if float(np.max(np.abs(signal))) < 1e-5:
        return {
            "chords": [],
            "key": None,
            "bpm": None,
            "duration": round(duration, 2),
            "analysis_seconds": round(perf_counter() - started, 2),
            "engine": "ChordScope harmonic chroma v1",
        }

    harmonic, _ = librosa.effects.hpss(signal)
    chroma = librosa.feature.chroma_cqt(
        y=harmonic,
        sr=sample_rate,
        hop_length=HOP_LENGTH,
        n_chroma=12,
        n_octaves=6,
        tuning=None,
    )
    chroma = np.maximum(np.asarray(chroma, dtype=np.float32), 0.0)
    chroma_norm = np.linalg.norm(chroma, axis=0)
    frame_seconds = HOP_LENGTH / sample_rate
    rms = librosa.feature.rms(y=signal, frame_length=2048, hop_length=HOP_LENGTH)[0]
    frame_count = min(chroma.shape[1], rms.shape[0])
    chroma = chroma[:, :frame_count]
    rms = rms[:frame_count]
    chroma_norm = chroma_norm[:frame_count]

    active_energy = rms[rms > 1e-5]
    quiet_threshold = max(1e-5, float(np.percentile(active_energy, 12)) * 0.35) if active_energy.size else 1e-5
    quiet_frames = rms < quiet_threshold
    safe_norm = np.where(chroma_norm > 1e-8, chroma_norm, 1.0)
    chroma /= safe_norm[None, :]
    chroma[:, quiet_frames] = 0.0

    template_matrix = np.stack([chord.vector for chord in CHORDS])
    similarity = np.maximum(template_matrix @ chroma, 0.0)
    # A modest non-chord penalty helps distinguish close templates without suppressing extensions.
    for index, chord in enumerate(CHORDS):
        non_chord = [pitch for pitch in range(12) if pitch not in chord.notes]
        similarity[index] -= 0.12 * np.mean(chroma[non_chord], axis=0)
    similarity = np.maximum(similarity, 0.0)

    path = _viterbi_decode(similarity, quiet_frames)
    segments = _segments_from_path(path, similarity, duration, frame_seconds)
    output_chords = [
        {
            "chord": CHORDS[segment["template"]].label,
            "time": segment["start"],
            "duration": segment["duration"],
            "confidence": segment["confidence"],
        }
        for segment in segments
    ]
    key = _estimate_key(chroma, rms, segments)

    bpm: float | None = None
    if duration >= 8:
        try:
            tempo_values, _ = librosa.beat.beat_track(
                y=signal,
                sr=sample_rate,
                hop_length=HOP_LENGTH,
                start_bpm=110.0,
                units="time",
            )
            tempo_array = np.asarray(tempo_values).reshape(-1)
            if tempo_array.size and np.isfinite(tempo_array[0]) and 0 < tempo_array[0] <= 300:
                bpm = round(float(tempo_array[0]), 1)
        except Exception:
            bpm = None

    return {
        "chords": output_chords,
        "key": key,
        "bpm": bpm,
        "duration": round(duration, 2),
        "analysis_seconds": round(perf_counter() - started, 2),
        "engine": "ChordScope harmonic chroma v1",
    }
