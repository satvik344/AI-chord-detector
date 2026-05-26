from ai_engine.chord_engine import detect_chords


def process_song(file_path):

    print("\nSTEP 1: Detecting chords directly...\n")

    chords = detect_chords(
        file_path
    )

    return chords