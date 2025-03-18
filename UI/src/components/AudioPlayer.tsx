import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  PlayIcon,
  PauseIcon,
  Mic,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import useAuthStore from "@/store/useAuthStore";
import WaveSurfer from "wavesurfer.js";

const BASE_URL = import.meta.env.VITE_BASE_URL;

interface Verse {
  verse_id: number;
  verse_number: number;
  stt: boolean;
  stt_msg: string;
  text: string;
  tts: boolean;
  tts_path: string;
  modified: boolean;
  size: number;
  format: string;
  path: string;
  name: string;
  tts_msg: string;
}

const AudioPlayer = ({ 
  verse, 
  onClose
}: { 
  verse: Verse | null, 
  onClose: () => void, 
}) => {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioState, setAudioState] = useState({
    duration: 0,
    currentTime: 0,
    volume: 1,
    isMuted: false,
    previousVolume: 1,
    loadError: false
  });
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!verse) return;
    
    loadAudio(verse);
    
    return () => cleanupAudio();
  }, [verse]);

  useEffect(() => {
    if (audio) {
      audio.volume = audioState.volume;
      audio.muted = audioState.isMuted;
    }

    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.setVolume(audioState.isMuted ? 0 : audioState.volume);
      } catch (e) {
        console.error("Error setting WaveSurfer volume:", e);
      }
    }
  }, [audioState.volume, audioState.isMuted, audio]);

  const cleanupAudio = () => {
    // Stop playback
    if (isPlaying) setIsPlaying(false);

    // Destroy WaveSurfer
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.pause();
        wavesurferRef.current.destroy();
      } catch (e) {
        console.error("Error destroying WaveSurfer:", e);
      }
      wavesurferRef.current = null;
    }

    // Clean up audio element
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch (e) {
        console.error("Error cleaning up audio element:", e);
      }
      setAudio(null);
    }

    // Revoke object URL
    if (audioUrlRef.current) {
      try {
        URL.revokeObjectURL(audioUrlRef.current);
      } catch (e) {
        console.error("Error revoking object URL:", e);
      }
      audioUrlRef.current = null;
    }

    // Reset UI state
    setAudioState(prev => ({
      ...prev,
      currentTime: 0,
      duration: 0,
      loadError: false
    }));

    // Clear waveform container
    if (waveformRef.current) {
      waveformRef.current.innerHTML = "";
    }
  };

  const loadAudio = async (verse: Verse) => {
    try {
      cleanupAudio();
      setAudioState(prev => ({ ...prev, loadError: false }));

      // Check if verse has audio
      if (!verse.tts && !verse.stt) {
        toast({ variant: "destructive", title: "Audio not available" });
        return;
      }

      // Fetch audio from API
      const token = useAuthStore.getState().token;
      const response = await fetch(
        `${BASE_URL}/project/verse/audio?verse_id=${verse.verse_id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) throw new Error("Failed to fetch audio");

      const audioBlob = await response.blob();
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error("Empty audio file received");
      }

      // Create audio URL and set up audio element
      const url = URL.createObjectURL(audioBlob);
      audioUrlRef.current = url;

      const newAudio = new Audio();
      newAudio.onloadedmetadata = () => {
        if (newAudio.duration && !isNaN(newAudio.duration)) {
          setAudioState(prev => ({ ...prev, duration: newAudio.duration }));
        }
      };

      newAudio.ontimeupdate = () => {
        setAudioState(prev => ({ ...prev, currentTime: newAudio.currentTime }));
      };

      newAudio.onended = () => setIsPlaying(false);
      newAudio.onerror = () => setAudioState(prev => ({ ...prev, loadError: true }));

      // Set volume and mute state
      newAudio.volume = audioState.volume;
      newAudio.muted = audioState.isMuted;
      newAudio.src = url;
      setAudio(newAudio);

      // Initialize WaveSurfer
      if (waveformRef.current) {
        try {
          await initializeWaveSurfer(audioBlob);
        } catch (error) {
          console.error("Failed to initialize WaveSurfer:", error);
          if (!audioState.loadError) {
            toast({
              variant: "default",
              title: "Using alternative playback method",
              description: "Waveform visualization unavailable",
            });
          }
        }
      }
    } catch (error) {
      console.error("Error handling audio:", error);
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Error fetching audio",
      });
      cleanupAudio();
    }
  };

  const initializeWaveSurfer = async (audioBlob: Blob) => {
    return new Promise((resolve, reject) => {
      try {
        // Clean up existing instance
        if (wavesurferRef.current) {
          try {
            wavesurferRef.current.destroy();
          } catch (e) {
            console.error("Error destroying existing WaveSurfer:", e);
          }
          wavesurferRef.current = null;
        }

        // Make sure container is empty
        if (waveformRef.current) {
          waveformRef.current.innerHTML = "";
        }

        // Create new instance
        const wavesurfer = WaveSurfer.create({
          container: waveformRef.current!,
          waveColor: "#4F46E5",
          progressColor: "#818CF8",
          cursorColor: "#3730A3",
          barWidth: 2,
          barRadius: 3,
          barGap: 2,
          height: 50,
          autoCenter: true,
          normalize: true,
          backend: "WebAudio",
        });

        // Set up event handlers
        let readyEventFired = false;

        wavesurfer.on("ready", () => {
          readyEventFired = true;
          wavesurferRef.current = wavesurfer;
          if (wavesurfer.getDuration() && !isNaN(wavesurfer.getDuration())) {
            setAudioState(prev => ({ ...prev, duration: wavesurfer.getDuration() }));
          }
          // Set initial volume
          wavesurfer.setVolume(audioState.isMuted ? 0 : audioState.volume);
          resolve(wavesurfer);
        });

        wavesurfer.on("play", () => {
          setIsPlaying(true);
          if (audio) {
            try {
              audio.pause();
            } catch (e) {
              console.error("Error pausing audio element:", e);
            }
          }
        });

        wavesurfer.on("pause", () => setIsPlaying(false));

        wavesurfer.on("audioprocess", (time) => {
          if (!isNaN(time)) {
            setAudioState(prev => ({ ...prev, currentTime: time }));
          }
        });

        wavesurfer.on("finish", () => setIsPlaying(false));
        wavesurfer.on("error", (err) => {
          console.error("WaveSurfer error:", err);
          reject(err);
        });

        // Set up a timeout for initialization
        const timeout = setTimeout(() => {
          if (!readyEventFired) {
            console.warn("WaveSurfer ready event didn't fire");
            reject(new Error("WaveSurfer initialization timeout"));
          }
        }, 3000);

        // Try loading the audio
        try {
          wavesurfer.loadBlob(audioBlob);
          wavesurfer.once("loading", () => clearTimeout(timeout));
        } catch (loadError) {
          clearTimeout(timeout);
          console.error("WaveSurfer load error:", loadError);
          reject(loadError);
        }
      } catch (error) {
        console.error("WaveSurfer initialization error:", error);
        reject(error);
      }
    });
  };

  const togglePlayPause = () => {
    if (wavesurferRef.current) {
      try {
        if (wavesurferRef.current.isPlaying()) {
          wavesurferRef.current.pause();
        } else {
          wavesurferRef.current.play();
        }
      } catch (e) {
        console.error("Error toggling WaveSurfer playback:", e);
        playNativeAudio();
      }
    } else if (audio) {
      playNativeAudio();
    }
  };

  const playNativeAudio = () => {
    if (!audio) return;

    if (audio.paused) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.error("Audio play error:", err);
          toast({ variant: "destructive", title: "Error playing audio" });
        });
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setAudioState(prev => ({ ...prev, volume: newVolume }));

    if (audioState.isMuted && newVolume > 0) {
      setAudioState(prev => ({ ...prev, isMuted: false }));
    }
  };

  const toggleMute = () => {
    if (audioState.isMuted) {
      setAudioState(prev => ({ 
        ...prev, 
        isMuted: false, 
        volume: prev.previousVolume || 0.5 
      }));
    } else {
      setAudioState(prev => ({ 
        ...prev, 
        previousVolume: prev.volume, 
        isMuted: true 
      }));
    }
  };

  if (!verse) return null;

  return (
    <div className="border border-gray-200 rounded-lg mb-4 bg-gray-50 shadow-sm">
      <div className="flex justify-between items-center py-1 px-4 border-b">
        <div className="font-medium">
          Verse {verse.verse_number} Audio
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </div>
      <div className="px-4 py-3">
        <div ref={waveformRef} className="w-full h-[50px] mb-2" />
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={togglePlayPause}
              disabled={!wavesurferRef.current && !audio}
            >
              {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            </Button>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={toggleMute}
                title={audioState.isMuted ? "Unmute" : "Mute"}
              >
                {audioState.isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </Button>
              <div className="w-24">
                <Slider
                  value={[audioState.isMuted ? 0 : audioState.volume]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={handleVolumeChange}
                  disabled={!audio && !wavesurferRef.current}
                />
              </div>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {formatTime(audioState.currentTime)} / {formatTime(audioState.duration)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPlayer;