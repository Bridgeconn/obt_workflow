import React, { useEffect, useState, useMemo } from "react";
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

  const [isConvertingChapters, setIsConvertingChapters] = useState<{
    [chapterId: number]: boolean;
  }>({});
  // const [chapterProgress, setChapterProgress] = useState<{
  //   [chapterId: number]: {
  //     total: number;
  //     completed: number;
  //   };
  // }>({});

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
    if (isOpen) {
      fetchChapterDetails(projectId, bookName, chapter.chapter);
    } else {
      // clearChapterVerses(chapterKey);
      if (!isConvertingChapters[chapter.chapter_id]) {
        clearChapterVerses(chapterKey);
      }
    }
    setApproved(chapter.approved);
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
        title: error instanceof Error ? error.message : "Error fetching audio",
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
    // // Clear local modifications after update
    // setVerseModifications({});

    await fetchChapterDetails(projectId, bookName, chapter.chapter);
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
    // setIsConvertingVerse(new Set());
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
                onChange={(e) =>
                  handleTextChange(verse.verse_id, e.target.value, verse.text)
                }
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              />
              <div className="w-[50px]">
                {verse.modified &&
                isConvertingChapters[chapter.chapter_id] &&
                !verse.tts ? (
                  <LoadingIcon className="animate-spin" />
                ) : (
                  (verse.modified ? verse.tts : verse.stt) &&
                  !verseModifications[verse.verse_id] &&
                  !editedVerses.has(verse.verse_id) && (
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
