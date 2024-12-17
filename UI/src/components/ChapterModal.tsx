import React, { useEffect, useState } from "react";
import { useChapterDetailsStore } from "@/store/useProjectStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlayIcon, PauseIcon } from "lucide-react";
import useAuthStore from "@/store/useAuthStore";
import { Textarea } from "./ui/textarea";
import { toast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.VITE_BASE_URL;

interface Chapter {
  chapter_id: number;
  chapter: number;
  approved: boolean;
  missing_verses: number[];
  status?: string;
  progress?: string;
}

interface ChapterModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  bookName: string;
  chapter: Chapter;
}

const ChapterModal: React.FC<ChapterModalProps> = ({
  isOpen,
  onClose,
  projectId,
  bookName,
  chapter,
}) => {
  const {
    chapterVerses,
    fetchChapterDetails,
    updateVerseText,
    approveChapter,
    convertToSpeech
  } = useChapterDetailsStore();
  const [playingVerse, setPlayingVerse] = useState<number | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [approved, setApproved] = useState<boolean>(false);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [modifiedVerses, setModifiedVerses] = useState<Set<number>>(new Set());
  const [focusedVerses, setFocusedVerses] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isOpen) fetchChapterDetails(projectId, bookName, chapter.chapter);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && audio) {
      audio.pause();
      setAudio(null);
      setPlayingVerse(null);
    }
  }, [isOpen, audio]);
  

  const handlePlayAudio = async (verseId: number) => {
    if (audio) {
      // Stop and reset the audio
      audio.pause();
      setAudio(null);
      setPlayingVerse(null);
    } else {
      try {
        const token = useAuthStore.getState().token;

        // Fetch audio from API
        const response = await fetch(
          `${BASE_URL}/project/verse/audio?verse_id=${verseId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        // Check if the response is OK
        if (!response.ok) {
          throw new Error("Failed to fetch audio");
        }

        // Process the audio blob
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        // Play audio
        const newAudio = new Audio(audioUrl);
        newAudio.play();

        // Update state
        setAudio(newAudio);
        setPlayingVerse(verseId);

        // Reset state when audio ends
        newAudio.onended = () => {
          setPlayingVerse(null);
          setAudio(null);
        };
      } catch (error) {
        console.error("Error fetching audio:", error);
      }
    }
  };

  const handleApproveChapter = () => {
    const approve = approved ? false : true;
    setApproved(approve);
    approveChapter(projectId, bookName, chapter.chapter, approve);
    onClose();
  };

  const handleVerseUpdate = (verseId: number, newText: string) => {
    updateVerseText(verseId, newText);
    setModifiedVerses((prev) => new Set(prev).add(verseId));
  };

  const handleConvertToSpeech = async () => {
    try {
      setIsConverting(true);
      const resultMsg = await convertToSpeech(projectId, bookName, chapter);
      toast({
        variant: "success",
        title: resultMsg,
      });
      setIsConverting(false);
    } catch (error) {
      console.error("Error converting to speech:", error);
      setIsConverting(false);
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Error converting to speech",
      });
    }
  };

  const handleFocus = (verseId: number) => {
    setFocusedVerses((prev) => new Set(prev).add(verseId));
  };

  const handleBlur = (verseId: number, newText: string, originalText: string) => {
    setFocusedVerses((prev) => {
      const updated = new Set(prev);
      updated.delete(verseId);
      return updated;
    });

    if (newText.trim() !== originalText.trim()) {
      handleVerseUpdate(verseId, newText);
    }
  };
  
  

  const sortedVerses = chapterVerses?.sort((a, b) => a.verse_number - b.verse_number);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {bookName} - Chapter {chapter.chapter}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-96 border rounded p-4">
          {sortedVerses?.map((verse) => (
            <div
              key={verse.verse_id}
              className={`flex items-center space-x-4 p-2 ${
                modifiedVerses.has(verse.verse_id)
                  ? "bg-gray-100 rounded"
                  : ""
              }`}
            >
              <div className="w-16 text-right text-sm">{`Verse ${verse.verse_number}:`}</div>
              <Textarea
                className={`flex-1 min-h-[60px] w-full md:w-[500px] lg:w-[600px] resize-y ${
                  modifiedVerses.has(verse.verse_id) || verse.modified ? "border-2 border-yellow-500 bg-yellow-50" : ""
                }`}
                defaultValue={verse.text}
                onFocus={() => handleFocus(verse.verse_id)}
                onBlur={(e) => handleBlur(verse.verse_id, e.target.value, verse.text)}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              />
              <div className="w-[50px]">
                {(verse.tts || verse.stt ) && !modifiedVerses.has(verse.verse_id) && !focusedVerses.has(verse.verse_id) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handlePlayAudio(verse.verse_id)}
                  >
                    {playingVerse === verse.verse_id ? (
                      <PauseIcon />
                    ) : (
                      <PlayIcon />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </ScrollArea>
        <div className="flex justify-end space-x-4 mt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleApproveChapter}>
            {approved ? "Unapprove" : "Approve"}
          </Button>
          <Button onClick={handleConvertToSpeech} disabled={isConverting}>Convert to Speech</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChapterModal;