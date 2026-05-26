from ai_engine.chord_engine import detect_chords


def process_song(audio_path):

    print("\nSTEP 1: Detecting chords directly...\n")

    chords = detect_chords(audio_path)

    print("\nDONE!\n")

    return chords