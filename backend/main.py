from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import shutil
import uuid
import os

from ai_engine.process_song import process_song

app = FastAPI()

# -------------------------
# CORS
# -------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# CREATE FOLDERS
# -------------------------

os.makedirs("uploads", exist_ok=True)

# -------------------------
# TEST ROUTE
# -------------------------

@app.get("/")
def home():

    return {
        "message": "AI Chord Detector Backend Running"
    }

# -------------------------
# ANALYZE ROUTE
# -------------------------

@app.post("/analyze")
async def analyze(
    audio: UploadFile = File(...)
):

    try:

        file_id = str(uuid.uuid4())

        file_path = (
            f"uploads/{file_id}.mp3"
        )

        with open(file_path, "wb") as buffer:

            shutil.copyfileobj(
                audio.file,
                buffer
            )

        chords = process_song(file_path)

        return {
            "success": True,
            "chords": chords
        }

    except Exception as e:

        print("\nERROR:\n")
        print(str(e))

        return {
            "success": False,
            "error": str(e)
        }