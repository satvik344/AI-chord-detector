from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

import shutil
import os
import uuid 

from ai_engine.process_song import process_song

app = FastAPI()

# CORS FIX
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create uploads folder
os.makedirs(
    "uploads",
    exist_ok=True
)


@app.get("/")
def home():

    return {
        "message": "AI Chord Detector Backend Running"
    }


@app.post("/analyze")
async def analyze(
    audio: UploadFile = File(...)
):

    try:

        # SAFE RANDOM FILE NAME
        safe_name = (
            str(uuid.uuid4()) + ".mp3"
        )

        file_path = (
            f"uploads/{safe_name}"
        )

        # SAVE FILE
        with open(
            file_path,
            "wb"
        ) as buffer:

            shutil.copyfileobj(
                audio.file,
                buffer
            )

        print("\nFILE SAVED:")
        print(file_path)

        # PROCESS SONG
        chords = process_song(
            file_path
        )

        print("\nTOTAL CHORDS:")
        print(len(chords))

        return {
            "success": True,
            "chords": chords
        }

    except Exception as e:

        print("\nERROR:")
        print(str(e))

        return {
            "success": False,
            "error": str(e)
        }