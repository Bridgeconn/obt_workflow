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
import { PlayIcon, PauseIcon, Loader2 as LoadingIcon } from "lucide-react";
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
    convertToSpeech,
  } = useChapterDetailsStore();
  const [playingVerse, setPlayingVerse] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [approved, setApproved] = useState<boolean>(chapter.approved);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [verseModifications, setVerseModifications] = useState<{
    [key: number]: string;
  }>({});
  const [currentlyEditingVerseId, setCurrentlyEditingVerseId] = useState<
    number | null
  >(null);
  const [focusedVerses, setFocusedVerses] = useState<Set<number>>(new Set());
  const [isConvertingVerse, setIsConvertingVerse] = useState<Set<number>>(
    new Set()
  );

  useEffect(() => {
    
    if (isOpen) fetchChapterDetails(projectId, bookName, chapter.chapter);
    // setVerseModifications({});
    setApproved(chapter.approved);
    setCurrentlyEditingVerseId(null);
    setFocusedVerses(new Set());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && audio) {
      audio.pause();
      setAudio(null);
      setPlayingVerse(null);
      setIsPlaying(false);
    }
  }, [isOpen, audio]);

  const handlePlayAudio = async (verseId: number) => {
    try {
      const token = useAuthStore.getState().token;
  
      if (playingVerse === verseId && audio) {
        if (audio.paused) {
          // Resume playback
          audio.play();
          setIsPlaying(true);
        } else {
          // Pause playback
          audio.pause();
          setIsPlaying(false);
        }
        return;
      }
  
      if (audio) {
        // Stop the current audio
        audio.pause();
        setAudio(null);
        setPlayingVerse(null);
        setIsPlaying(false);
      }
  
      // Fetch audio from API if new verse is played
      const response = await fetch(
        `${BASE_URL}/project/verse/audio?verse_id=${verseId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
  
      if (!response.ok) {
        throw new Error("Failed to fetch audio");
      }
  
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
  
      // Initialize and play audio
      const newAudio = new Audio(audioUrl);
      newAudio.play();
  
      // Update state
      setAudio(newAudio);
      setPlayingVerse(verseId);
      setIsPlaying(true);
  
      // Reset state when audio ends
      newAudio.onended = () => {
        setPlayingVerse(null);
        setAudio(null);
        setIsPlaying(false);
      };
    } catch (error) {
      console.error("Error fetching audio:", error);
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error.message : "Error fetching audio",
      });
    }
  };
  

  const handleApproveChapter = () => {
    const approve = approved ? false : true;
    setApproved(approve);
    approveChapter(projectId, bookName, chapter.chapter, approve);
    onClose();
  };

  const handleVerseUpdate = async () => {
    const verseIds = Object.keys(verseModifications).map(Number);

    for (const verseId of verseIds) {
      const newText = verseModifications[verseId];
      await updateVerseText(verseId, newText, bookName, chapter.chapter);
    }
    // // Clear local modifications after update
    // setVerseModifications({});

    await fetchChapterDetails(projectId, bookName, chapter.chapter);
  };

  const handleConvertToSpeech = async () => {
    try {
      setIsConverting(true);
      const modifiedVerses = sortedVerses?.filter(
        verse => verse.modified || verseModifications[verse.verse_id]
      ).map(verse => verse.verse_id) || [];
      
      if (modifiedVerses.length === 0) {
        toast({
          variant: "destructive",
          title: "Edit verse text before converting to speech",
        });        
        setIsConverting(false);
        return;
      }
      setIsConvertingVerse((prev) => new Set([...prev, ...modifiedVerses]));
      await handleVerseUpdate();
      const resultMsg = await convertToSpeech(projectId, bookName, chapter);
      console.log("resultMsg", resultMsg);
      toast({
        variant: "success",
        title: resultMsg,
      });
      setIsConverting(false);
      setIsConvertingVerse(new Set());
      setVerseModifications({});
      setFocusedVerses(new Set());
      await fetchChapterDetails(projectId, bookName, chapter.chapter);
    } catch (error) {
      console.error("Error converting to speech:", error);
      setIsConverting(false);
      setIsConvertingVerse(new Set());
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error.message : "Error converting to speech",
      });
    }
  };

  const handleTextChange = (
    verseId: number,
    newText: string,
    originalText: string
  ) => {
    if (newText.trim() !== originalText.trim()) {
      setVerseModifications((prev) => ({
        ...prev,
        [verseId]: newText,
      }));
      setApproved(false);
      // Add to focusedVerses only when text changes
      setFocusedVerses((prev) => new Set(prev).add(verseId));
      if (playingVerse === verseId) {
        if (audio) {
          audio.pause();
        }
        setAudio(null);
        setPlayingVerse(null);
      }
    } else {
      // Remove from local modifications if text is reverted to original
      setVerseModifications((prev) => {
        const updated = { ...prev };
        delete updated[verseId];
        return updated;
      });
       // Remove from focusedVerses when text matches original
      setFocusedVerses((prev) => {
        const updated = new Set(prev);
        updated.delete(verseId);
        return updated;
      });
    }
  };

  const handleFocus = (verseId: number) => {
    // If there's a previously edited verse, update it before switching
    if (
      currentlyEditingVerseId !== null &&
      currentlyEditingVerseId !== verseId &&
      verseModifications[currentlyEditingVerseId]
    ) {
      const previousVerse = sortedVerses?.find(
        (v) => v.verse_id === currentlyEditingVerseId
      );
      if (previousVerse) {
        updateVerseText(
          currentlyEditingVerseId,
          verseModifications[currentlyEditingVerseId],
          bookName,
          chapter.chapter
        );

        // Remove the verse from local modifications after update
        setVerseModifications((prev) => {
          const updated = { ...prev };
          delete updated[currentlyEditingVerseId];
          return updated;
        });
      }
    }

    // Set the new currently editing verse
    if (currentlyEditingVerseId !== verseId) {
      setCurrentlyEditingVerseId(verseId);
    }
  };

  const handleBlur = async (
    verseId: number,
    newText: string,
    originalText: string
  ) => {
    if (newText.trim() !== originalText.trim()) {
      handleTextChange(verseId, newText, originalText);
      handleVerseUpdate();
    }

    setFocusedVerses((prev) => {
      const updated = new Set(prev);
      updated.delete(verseId);
      return updated;
    });

    if (currentlyEditingVerseId === verseId) {
      setCurrentlyEditingVerseId(null);
    }

    if (!isOpen) {
      setCurrentlyEditingVerseId(null);
    }
  };

  const sortedVerses = chapterVerses?.sort(
    (a, b) => a.verse_number - b.verse_number
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onClose}
    >
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
                verseModifications[verse.verse_id] ? "bg-gray-100 rounded" : ""
              }`}
            >
              <div className="w-16 text-right text-sm">{`Verse ${verse.verse_number}:`}</div>
              <Textarea
                className={`flex-1 min-h-[60px] w-full md:w-[500px] lg:w-[600px] resize-y ${
                  verseModifications[verse.verse_id] || verse.modified
                    ? "border-r-2 border-r-yellow-500 bg-yellow-50"
                    : ""
                }`}
                defaultValue={verse.text}
                onChange={(e) => handleTextChange(verse.verse_id, e.target.value, verse.text)}
                onFocus={() => handleFocus(verse.verse_id)}
                onBlur={(e) =>
                  handleBlur(verse.verse_id, e.target.value, verse.text)
                }
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              />
              <div className="w-[50px]">
                {isConvertingVerse.has(verse.verse_id) ? (
                  <LoadingIcon className="animate-spin" />
                ) : (
                  (verse.modified ? verse.tts : verse.stt) &&
                  !verseModifications[verse.verse_id] &&
                  !focusedVerses.has(verse.verse_id) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handlePlayAudio(verse.verse_id)}
                    >
                      {playingVerse === verse.verse_id && isPlaying ? (
                        <PauseIcon />
                      ) : (
                        <PlayIcon />
                      )}
                    </Button>
                  )
                )}
              </div>
            </div>
          ))}
        </ScrollArea>
        <div className="flex justify-end space-x-4 mt-4">
          <Button
            variant="outline"
            onClick={() => {
              handleVerseUpdate();
              onClose();
            }}
          >
            Close
          </Button>
          <Button onClick={handleApproveChapter}>
            {approved ? "Unapprove" : "Approve"}
          </Button>
          <Button onClick={handleConvertToSpeech} disabled={isConverting}>
            Convert to Speech
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChapterModal;
