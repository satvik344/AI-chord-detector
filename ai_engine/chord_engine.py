import librosa
import numpy as np

CHORDS = {
    "C": [0, 4, 7],
    "Cm": [0, 3, 7],
    "C#": [1, 5, 8],
    "C#m": [1, 4, 8],
    "D": [2, 6, 9],
    "Dm": [2, 5, 9],
    "D#": [3, 7, 10],
    "D#m": [3, 6, 10],
    "E": [4, 8, 11],
    "Em": [4, 7, 11],
    "F": [5, 9, 0],
    "Fm": [5, 8, 0],
    "F#": [6, 10, 1],
    "F#m": [6, 9, 1],
    "G": [7, 11, 2],
    "Gm": [7, 10, 2],
    "G#": [8, 0, 3],
    "G#m": [8, 11, 3],
    "A": [9, 1, 4],
    "Am": [9, 0, 4],
    "A#": [10, 2, 5],
    "A#m": [10, 1, 5],
    "B": [11, 3, 6],
    "Bm": [11, 2, 6],
}

def match_chord(chroma_vector):

    scores = {}

    for chord, notes in CHORDS.items():

        score = sum(chroma_vector[n] for n in notes)

        scores[chord] = score

    return max(scores, key=scores.get)

def detect_chords(audio_path):

    y, sr = librosa.load(
        audio_path,
        sr=22050,
        mono=True,
        duration=120
    )

    hop_length = 4096

    chroma = librosa.feature.chroma_cqt(
        y=y,
        sr=sr,
        hop_length=hop_length
    )

    times = librosa.frames_to_time(
        np.arange(chroma.shape[1]),
        sr=sr,
        hop_length=hop_length
    )

    chords = []

    last_chord = None
    last_time = 0

    for i in range(chroma.shape[1]):

        current_chord = match_chord(chroma[:, i])

        current_time = float(times[i])

        if current_chord != last_chord:

            if current_time - last_time >= 1.5:

                chords.append({
                    "time": round(current_time, 1),
                    "chord": current_chord
                })

                last_chord = current_chord
                last_time = current_time

    return chords