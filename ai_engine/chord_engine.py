import librosa
import numpy as np


def detect_chords(audio_path):

    print("\nLOADING AUDIO...\n")

    y, sr = librosa.load(audio_path)

    # -------------------------
    # HARMONIC SEPARATION
    # -------------------------

    harmonic, _ = librosa.effects.hpss(y)

    y = harmonic

    # -------------------------
    # BEAT TRACKING
    # -------------------------

    tempo, beat_frames = librosa.beat.beat_track(
        y=y,
        sr=sr
    )

    beat_times = librosa.frames_to_time(
        beat_frames,
        sr=sr
    )

    print(f"\nTempo: {tempo}")

    print(f"Total Beats: {len(beat_times)}")

    # -------------------------
    # CHORD DEFINITIONS
    # -------------------------

    chord_names = [
        "C", "C#", "D", "D#", "E",
        "F", "F#", "G", "G#", "A",
        "A#", "B"
    ]

    major_template = [0, 4, 7]

    minor_template = [0, 3, 7]

    results = []

    previous_chord = None

    # -------------------------
    # HALF-BAR GROUPING
    # -------------------------

    beats_per_segment = 2

    for i in range(
        0,
        len(beat_times) - beats_per_segment,
        beats_per_segment
    ):

        start_time = beat_times[i]

        end_time = beat_times[
            i + beats_per_segment
        ]

        start_sample = int(
            start_time * sr
        )

        end_sample = int(
            end_time * sr
        )

        segment = y[
            start_sample:end_sample
        ]

        if len(segment) < 1000:
            continue

        # -------------------------
        # CHROMA FEATURES
        # -------------------------

        chroma = librosa.feature.chroma_cqt(
            y=segment,
            sr=sr
        )

        avg = np.mean(
            chroma,
            axis=1
        )

        avg = avg / (
            np.sum(avg) + 1e-6
        )

        best_score = -1

        best_chord = "C"

        # -------------------------
        # CHORD MATCHING
        # -------------------------

        for root in range(12):

            # MAJOR

            major_score = sum(

                avg[(root + x) % 12]

                for x in major_template

            )

            if major_score > best_score:

                best_score = major_score

                best_chord = (
                    chord_names[root]
                )

            # MINOR

            minor_score = sum(

                avg[(root + x) % 12]

                for x in minor_template

            )

            if minor_score > best_score:

                best_score = minor_score

                best_chord = (
                    chord_names[root] + "m"
                )

        # -------------------------
        # REMOVE DUPLICATES
        # -------------------------

        if best_chord != previous_chord:

            results.append({
                "time": round(float(start_time), 1),
                "chord": best_chord
            })

            previous_chord = best_chord

    # -------------------------
    # REMOVE VERY SHORT CHORDS
    # -------------------------

    filtered = []

    minimum_duration = 1.2

    for i in range(len(results)):

        current = results[i]

        # Keep last chord
        if i == len(results) - 1:

            filtered.append(current)

            break

        next_chord = results[i + 1]

        duration = (
            next_chord["time"]
            -
            current["time"]
        )

        # Keep only stable chords
        if duration >= minimum_duration:

            filtered.append(current)

    # -------------------------
    # FINAL CLEANING
    # -------------------------

    cleaned = []

    for chord in filtered:

        if (
            len(cleaned) == 0
            or
            cleaned[-1]["chord"]
            != chord["chord"]
        ):

            cleaned.append(chord)

    # -------------------------
    # DEBUG
    # -------------------------

    print("\nFINAL CHORDS:")
    print(len(cleaned))

    print("\nFIRST 20:\n")

    for item in cleaned[:20]:

        print(item)

    return cleaned