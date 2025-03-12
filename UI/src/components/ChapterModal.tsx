import React, { useEffect, useState, useMemo, useRef } from "react";
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
import { Slider } from "@/components/ui/slider";

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
    fetchChapterDetails,
    updateVerseText,
    approveChapter,
    convertToSpeech,
    clearChapterVerses,
  } = useChapterDetailsStore();
  const chapterKey = `${projectId}-${bookName}-${chapter.chapter}`;
  const chapterVerses = useChapterDetailsStore(
    (state) => state.chapterVerses[chapterKey]
  );
  const [playingVerse, setPlayingVerse] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [approved, setApproved] = useState<boolean>(chapter.approved);
  const [verseModifications, setVerseModifications] = useState<{
    [key: number]: string;
  }>({});
  const [editedVerses, setEditedVerses] = useState<Set<number>>(new Set());
  const [fontSize, setFontSize] = useState<number>(16);

  const [isConvertingChapters, setIsConvertingChapters] = useState<{
    [chapterId: number]: boolean;
  }>({});

  const sortedVerses = useMemo(
    () => chapterVerses?.sort((a, b) => a.verse_number - b.verse_number),
    [chapterVerses]
  );

  const completedVersesCount = useMemo(
    () =>
      sortedVerses?.filter((verse) => verse.modified && verse.tts).length || 0,
    [sortedVerses]
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        if (isOpen) {
          await fetchChapterDetails(projectId, bookName, chapter.chapter);
        } else {
          if (!isConvertingChapters[chapter.chapter_id]) {
            clearChapterVerses(chapterKey);
          }
        }
        setApproved(chapter.approved);
      } catch (error) {
        console.error("Error fetching chapter details:", error);
        toast({
          variant: "destructive",
          title:
            error instanceof Error
              ? error.message
              : "Error fetching chapter details",
        });
      }
    };

    loadData();
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
        title: error instanceof Error ? error?.message : "Error fetching audio",
      });
    }
  };

  const handleApproveChapter = async () => {
    const approve = approved ? false : true;
    setApproved(approve);
    try {
      await approveChapter(projectId, bookName, chapter.chapter, approve);
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error
            ? error?.message
            : "Error while approving chapter",
      });
    } finally {
      onClose();
    }
  };

  const handleVerseUpdate = async () => {
    try {
      if (isConvertingChapters[chapter.chapter_id]) {
        return;
      }
      const verseIds = Object.keys(verseModifications).map(Number);
      for (const verseId of verseIds) {
        const newText = verseModifications[verseId];
        await updateVerseText(
          verseId,
          newText,
          bookName,
          chapter.chapter,
          projectId
        );
      }
      await fetchChapterDetails(projectId, bookName, chapter.chapter);
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error?.message : "Error updating verse",
      });
    }
  };

  const handleConvertToSpeech = async () => {
    if (isConvertingChapters[chapter.chapter_id]) {
      return;
    }

    setIsConvertingChapters((prev) => ({
      ...prev,
      [chapter.chapter_id]: true,
    }));

    await handleVerseUpdate();

    // Fetch latest chapter details to ensure we have the most recent state
    await fetchChapterDetails(projectId, bookName, chapter.chapter);

    const modifiedVerses =
      sortedVerses
        ?.filter(
          (verse) =>
            verse.modified ||
            verseModifications[verse.verse_id] ||
            editedVerses.has(verse.verse_id)
        )
        .map((verse) => verse.verse_id) || [];

    if (modifiedVerses.length === 0) {
      toast({
        variant: "destructive",
        title: "Edit verse text before converting to speech",
      });
      setIsConvertingChapters((prev) => ({
        ...prev,
        [chapter.chapter_id]: false,
      }));
      return;
    }
    const resultMsg = await convertToSpeech(projectId, bookName, chapter);

    if (
      resultMsg.includes("Text-to-speech conversion completed successfully")
    ) {
      toast({
        variant: "success",
        title: resultMsg,
      });
    } else {
      toast({
        variant: "destructive",
        title: resultMsg,
      });
    }

    setIsConvertingChapters((prev) => ({
      ...prev,
      [chapter.chapter_id]: false,
    }));
    setVerseModifications({});
    setEditedVerses(new Set());

    await fetchChapterDetails(projectId, bookName, chapter.chapter);
  };

  const handleTextChange = (
    verseId: number,
    newText: string,
    originalText: string
  ) => {
    const hasChanged = newText.trim() !== originalText.trim();

    if (hasChanged) {
      // Store modification and mark verse as edited
      setVerseModifications((prev) => ({
        ...prev,
        [verseId]: newText,
      }));
      setEditedVerses((prev) => new Set(prev).add(verseId));
      setApproved(false);

      // Stop audio if playing for this verse
      if (playingVerse === verseId && audio) {
        audio.pause();
        setAudio(null);
        setPlayingVerse(null);
      }
    } else {
      // Remove modification if text matches original
      setVerseModifications((prev) => {
        const updated = { ...prev };
        delete updated[verseId];
        return updated;
      });
      setEditedVerses((prev) => {
        const updated = new Set(prev);
        updated.delete(verseId);
        return updated;
      });
    }
  };

  const checkProgress = () => {
    if (!isConvertingChapters[chapter.chapter_id]) return null;
    const totalModified =
      sortedVerses?.filter(
        (verse) =>
          verse.modified ||
          verseModifications[verse.verse_id] ||
          editedVerses.has(verse.verse_id)
      ).length || 0;

    const remaining = totalModified - completedVersesCount;

    return `${remaining} verse(s) left`;
  };

  const calculateLineHeight = (fontSize: number) => {
    const multiplier = 1.4 + (fontSize - 12) * 0.01;
    return `${Math.round(fontSize * multiplier)}px`;
  };

  const lineHeight = useMemo(() => calculateLineHeight(fontSize), [fontSize]);

  const increaseFontSize = () => {
    setFontSize((prev) => Math.min(prev + 2, 28));
  };

  const decreaseFontSize = () => {
    setFontSize((prev) => Math.max(prev - 2, 12));
  };

  const handleFontSizeChange = (value: number[]) => {
    setFontSize(value[0]);
  };

  const textareaRefs = useRef<{[key: number]: HTMLTextAreaElement | null}>({});

  const handleTextareaResize = (e: React.ChangeEvent<HTMLTextAreaElement> | HTMLTextAreaElement) => {
    const target = e instanceof HTMLTextAreaElement ? e : e.target;
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  };

  useEffect(() => {
    if(sortedVerses) {
      setTimeout(() => {
        Object.values(textareaRefs.current).forEach(textarea => {
          if (textarea) handleTextareaResize(textarea);
        });
      }, 0)
    }
  }, [sortedVerses, fontSize]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={() => {
        // Save changes before closing if there are modifications
        if (
          !isConvertingChapters[chapter.chapter_id] &&
          Object.keys(verseModifications).length > 0
        ) {
          handleVerseUpdate();
        }
        onClose();
      }}
    >
      <DialogContent className="max-w-6xl h-[80vh]">
        <DialogHeader className="mt-4">
          <DialogTitle className="flex justify-between items-center">
            <div>
              {bookName} - Chapter {chapter.chapter}
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2">
                <button
                  onClick={decreaseFontSize}
                  className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
                  title="Decrease font size"
                >
                  <span className="text-xs">A</span>
                </button>
                <div className="w-24">
                  <Slider
                    value={[fontSize]}
                    min={12}
                    max={28}
                    step={1}
                    onValueChange={handleFontSizeChange}
                  />
                </div>
                <button
                  onClick={increaseFontSize}
                  className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
                  title="Increase font size"
                >
                  <span className="text-lg">A</span>
                </button>
                {/* <span className="text-xs text-gray-500">{fontSize}px</span> */}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[calc(80vh-12rem)] overflow-y-auto border rounded p-4">
          {sortedVerses?.map((verse) => (
            <div
              key={verse.verse_id}
              className={`flex items-center space-x-4 p-2 ${
                verseModifications[verse.verse_id] ? "bg-gray-100 rounded" : ""
              }`}
            >
              <div className={`w-16 text-right text-sm ${verseModifications[verse.verse_id] || verse.modified ? "text-yellow-700" : ""}`}>{`Verse ${verse.verse_number}:`}</div>
              <Textarea
                className={`flex-1 min-h-[60px] w-full md:w-[500px] lg:w-[600px] resize-y whitespace-pre-wrap break-words overflow-auto md:overflow-hidden ${
                  verseModifications[verse.verse_id] || verse.modified
                    ? "border-r-4 border-l-4 border-l-yellow-500 border-r-yellow-500 bg-yellow-100"
                    : ""
                }`}
                style={{ fontSize: `${fontSize}px`, lineHeight: lineHeight, wordBreak: "break-word", overflowWrap: "break-word", height: "auto" }}
                defaultValue={verse.text}
                onChange={(e) => {
                  handleTextChange(verse.verse_id, e.target.value, verse.text);
                  handleTextareaResize(e);
                }}
                ref={(el) => textareaRefs.current[verse.verse_id] = el}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                disabled={isConvertingChapters[chapter.chapter_id]}
              />
              <div className="w-[50px]">
                {verse.modified &&
                isConvertingChapters[chapter.chapter_id] &&
                !verse.tts ? (
                  <LoadingIcon className="animate-spin" />
                ) : (
                  (
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
          <Button
            onClick={handleApproveChapter}
            disabled={isConvertingChapters[chapter.chapter_id]}
          >
            {approved ? "Unapprove" : "Approve"}
          </Button>
          <Button
            onClick={handleConvertToSpeech}
            disabled={isConvertingChapters[chapter.chapter_id]}
          >
            {isConvertingChapters[chapter.chapter_id]
              ? checkProgress()
              : "Convert to Speech"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChapterModal;
