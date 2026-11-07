# Software Musician

Software Musician is a chord-following player. It analyzes audio and returns a timestamped chord map, an estimated key, and a tempo estimate. When using the hosted site, audio is uploaded over HTTPS to the analyzer and its temporary server copy is removed after processing. Local development sends audio to the local analyzer on the same computer.

## Start the web app

Use Python 3.11 or newer.

1. Install the project dependencies once:

   ```powershell
   python -m pip install -r requirements.txt
   ```

2. Double-click `start.bat`, or run:

   ```powershell
   python run_server.py
   ```

3. Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

The terminal window is the local server. Leave it open while using Software Musician; press `Ctrl+C` there to stop it.

## What the analyzer does

The first backend uses a short-time Fourier transform chromagram, chord-template matching, temporal smoothing, key-profile scoring, and beat tracking. It analyzes the actual recording rather than looking up a song title. The method is a signal-processing baseline, not a trained deep-learning model. Accuracy can vary with dense mixes, tuning, live recordings, and ambiguous harmony; the visible key confidence is a guide rather than a probability.

The practice player keeps the current chord in view, lets you jump to a chord, slow playback, switch between simple and full chord labels, transpose the displayed chord chart, and export a CSV.

## API

- `GET /api/health` reports whether the analyzer is running.
- `POST /api/analyze` accepts one multipart audio field named `audio`.
- `GET /docs` shows the automatically generated local API reference.

The upload limit is 100 MB and the track limit is 8 minutes on the current low-memory service plan. WAV, MP3, FLAC, OGG, and AIFF are the best-supported formats. Some M4A, AAC, Opus, and WebM files may need FFmpeg installed for decoding.

## Deploy to Netlify + Render

The UI is a static Netlify site. Audio analysis runs on a separate Python web service because uploads and analysis can exceed Netlify Function request and runtime limits.

1. Push this project to a Git repository and import it into Netlify. The included `netlify.toml` builds only the browser assets into `dist/`, so Python source files are not part of the published site.
2. Create a Render Blueprint from the repository using `render.yaml`. It selects Render's Free plan for initial setup. Set `CORS_ORIGINS` to the exact Netlify site origin, such as `https://your-site.netlify.app` (no trailing slash).
3. Copy the Render service's public origin, then set the Netlify build environment variable `CHORDSCOPE_API_BASE` to that origin, such as `https://softwaremusician-api.onrender.com` (no trailing slash). Trigger a new deploy after setting it.

The Netlify build script injects the API origin into `dist/config.js`. For local development, the root `config.js` remains empty and the browser uses the same-origin FastAPI service.

The backend currently has no account system or per-user rate limit. Before promoting the public URL broadly, add abuse controls and measure memory/runtime on representative audio files.

## Improving accuracy

The next useful step is calibration with a small set of tracks across genres, including known chord charts and a few user corrections. That gives us measurable accuracy targets before replacing or combining the baseline with a trained chord-recognition model. A competitive model will need a labeled evaluation set and a hosting plan if it should run for users outside this computer.

