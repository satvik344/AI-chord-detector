import { useState, useRef, useEffect } from 'react'
import axios from 'axios'

function App() {

  const [file, setFile] = useState(null)

  const [loading, setLoading] = useState(false)

  const [progress, setProgress] = useState(0)

  const [chords, setChords] = useState([])

  const [audioURL, setAudioURL] = useState(null)

  const [currentTime, setCurrentTime] = useState(0)

  const [activeIndex, setActiveIndex] = useState(-1)

  const audioRef = useRef(null)

  const chordRefs = useRef([])

  // -------------------------
  // Upload + Analyze
  // -------------------------

  const handleUpload = async () => {

    if (!file) return

    const formData = new FormData()

    formData.append('audio', file)

    const localAudio = URL.createObjectURL(file)

    setAudioURL(localAudio)

    setLoading(true)

    setProgress(0)

    setChords([])

    // FAKE AI PROGRESS

    let fakeProgress = 0

    const interval = setInterval(() => {

      fakeProgress += Math.random() * 12

      if (fakeProgress > 95) {

        fakeProgress = 95
      }

      setProgress(
        Math.floor(fakeProgress)
      )

    }, 400)

    try {

      const response = await axios.post(
        'http://127.0.0.1:8000/analyze',
        formData
      )

      clearInterval(interval)

      setProgress(100)

      setChords(
        response.data.chords || []
      )

      setLoading(false)

      // AUTO PLAY

      setTimeout(() => {

        if (audioRef.current) {

          audioRef.current.play()
        }

      }, 500)

    } catch (error) {

      clearInterval(interval)

      console.log(error)

      alert('Error processing song')

      setLoading(false)
    }
  }

  // -------------------------
  // SPACEBAR PLAY/PAUSE
  // -------------------------

  useEffect(() => {

    const handleKey = (e) => {

      if (
        e.code === 'Space' &&
        audioRef.current
      ) {

        e.preventDefault()

        if (
          audioRef.current.paused
        ) {

          audioRef.current.play()

        } else {

          audioRef.current.pause()
        }
      }
    }

    window.addEventListener(
      'keydown',
      handleKey
    )

    return () => {

      window.removeEventListener(
        'keydown',
        handleKey
      )
    }

  }, [])

  // -------------------------
  // AUDIO TIME TRACKING
  // -------------------------

  useEffect(() => {

    const interval = setInterval(() => {

      if (audioRef.current) {

        setCurrentTime(
          audioRef.current.currentTime
        )
      }

    }, 250)

    return () =>
      clearInterval(interval)

  }, [])

  // -------------------------
  // ACTIVE CHORD
  // -------------------------

  useEffect(() => {

    let newIndex = -1

    for (
      let i = chords.length - 1;
      i >= 0;
      i--
    ) {

      if (
        currentTime >= chords[i].time
      ) {

        newIndex = i

        break
      }
    }

    if (newIndex !== activeIndex) {

      setActiveIndex(newIndex)

      const activeElement =
        chordRefs.current[newIndex]

      if (activeElement) {

        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }
    }

  }, [currentTime, chords])

  // -------------------------
  // SEEK AUDIO
  // -------------------------

  const seekToChord = (time) => {

    if (audioRef.current) {

      audioRef.current.currentTime = time

      audioRef.current.play()
    }
  }

  // -------------------------
  // FORMAT TIME
  // -------------------------

  const formatTime = (seconds) => {

    const mins = Math.floor(
      seconds / 60
    )

    const secs = Math.floor(
      seconds % 60
    )

    return (
      String(mins).padStart(2, '0')
      + ':'
      + String(secs).padStart(2, '0')
    )
  }

  return (

    <div
      style={{
        background: '#0f0f0f',
        minHeight: '100vh',
        color: 'white',
        padding: '40px',
        fontFamily: 'Arial'
      }}
    >

      <h1
        style={{
          fontSize: '42px',
          marginBottom: '30px'
        }}
      >
        🎵 AI Chord Detector
      </h1>

      {/* Upload */}

      <div
        style={{
          marginBottom: '30px'
        }}
      >

        <input
          type="file"
          accept="audio/*"
          onChange={(e) =>
            setFile(
              e.target.files[0]
            )
          }
        />

        <button
          onClick={handleUpload}
          style={{
            marginLeft: '20px',
            padding: '12px 25px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '16px',
            cursor: 'pointer',
            background: '#00ff99',
            fontWeight: 'bold'
          }}
        >
          Analyze Song
        </button>

      </div>

      {/* LOADING */}

      {loading && (

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: '100px'
          }}
        >

          <div
            style={{
              width: '90px',
              height: '90px',
              border: '10px solid #333',
              borderTop: '10px solid #00ff99',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}
          />

          <h2
            style={{
              marginTop: '30px',
              fontSize: '52px'
            }}
          >
            {progress}%
          </h2>

          <p
            style={{
              opacity: 0.7,
              marginTop: '10px',
              fontSize: '18px'
            }}
          >
            Detecting harmony, beats & chord transitions
          </p>

        </div>
      )}

      {/* AUDIO */}

      {!loading && audioURL && (

        <audio
          controls
          ref={audioRef}
          src={audioURL}
          style={{
            width: '100%',
            marginBottom: '30px'
          }}
        />

      )}

      {/* CHORDS */}

      {!loading && chords.length > 0 && (

        <div
          style={{
            maxHeight: '600px',
            overflowY: 'auto',
            padding: '20px',
            border: '1px solid #333',
            borderRadius: '15px',
            background: '#1a1a1a'
          }}
        >

          {chords.map((item, index) => (

            <div
              key={index}

              ref={(el) =>
                chordRefs.current[index] = el
              }

              onClick={() =>
                seekToChord(item.time)
              }

              style={{

                display: 'flex',

                justifyContent:
                  'space-between',

                alignItems: 'center',

                padding: '18px',

                marginBottom: '12px',

                borderRadius: '12px',

                cursor: 'pointer',

                transition: '0.25s',

                background:

                  index === activeIndex
                    ? '#00ff99'
                    : '#222',

                color:

                  index === activeIndex
                    ? 'black'
                    : 'white',

                transform:

                  index === activeIndex
                    ? 'scale(1.04)'
                    : 'scale(1)',

                boxShadow:

                  index === activeIndex
                    ? '0px 0px 20px #00ff99'
                    : 'none'
              }}
            >

              <div
                style={{
                  fontSize:

                    index === activeIndex
                      ? '42px'
                      : '28px',

                  fontWeight: 'bold'
                }}
              >
                {item.chord}
              </div>

              <div
                style={{
                  opacity: 0.7,
                  fontSize: '18px'
                }}
              >
                {formatTime(item.time)}
              </div>

            </div>

          ))}

        </div>

      )}

      {/* Spinner Animation */}

      <style>
        {`
          @keyframes spin {

            0% {
              transform: rotate(0deg);
            }

            100% {
              transform: rotate(360deg);
            }
          }
        `}
      </style>

    </div>
  )
}

export default App