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
import { AlertCircle, Loader2 as LoadingIcon, PlayIcon } from "lucide-react";
import { Textarea } from "./ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import AudioPlayer from "./AudioPlayer";
import {
  saveVerseToLocalStorage,
  loadVersesFromLocalStorage,
  removeVerseFromLocalStorage,
  clearStoredVersesForChapter,
  hasPendingChanges,
} from "@/utils/chapterStorage";

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

  const [fontSize, setFontSize] = useState(24);
  const [currentVerse, setCurrentVerse] = useState<Verse | null>(null);
  const [approved, setApproved] = useState(chapter.approved);
  const [isConvertingChapters, setIsConvertingChapters] = useState<
    Record<number, boolean>
  >({});
  const [isSyncingChanges, setIsSyncingChanges] = useState(false);
  const [hasPendingConversion, setHasPendingConversion] = useState(false);
  const [verseModifications, setVerseModifications] = useState<
    Record<number, string>
  >({});
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  const sortedVerses = useMemo(
    () => chapterVerses?.sort((a, b) => a.verse_number - b.verse_number),
    [chapterVerses]
  );

  const completedVersesCount = useMemo(
    () =>
      sortedVerses?.filter((verse) => verse.modified && verse.tts).length || 0,
    [sortedVerses]
  );

  const lineHeight = useMemo(
    () => `${Math.round(fontSize * (1.4 + (fontSize - 12) * 0.01))}px`,
    [fontSize]
  );
  useEffect(() => {
    if (isOpen && projectId && bookName && chapter) {
      setVerseModifications({});

      //load any stored modifications for this chapter
      const storedModifications = loadVersesFromLocalStorage(
        projectId,
        bookName,
        chapter.chapter
      );

      if (Object.keys(storedModifications).length > 0) {
        setVerseModifications(storedModifications);
        setHasPendingConversion(true);
      } else {
        setHasPendingConversion(false);
      }
    }
  }, [isOpen, projectId, bookName, chapter]);

  useEffect(() => {
    if (!isOpen) {
      setCurrentVerse(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const loadData = async () => {
      try {
        if (isOpen) {
          await fetchChapterDetails(projectId, bookName, chapter.chapter);
          setCurrentVerse(null);
        } else if (!isConvertingChapters[chapter.chapter_id]) {
          clearChapterVerses(chapterKey);
        }
        setApproved(chapter.approved);
      } catch (error) {
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
    if (sortedVerses) {
      setTimeout(() => {
        Object.values(textareaRefs.current).forEach((textarea) => {
          if (textarea) handleTextareaResize(textarea);
        });
      }, 0);
    }
  }, [sortedVerses, fontSize]);

  useEffect(() => {
    if (currentVerse && isConvertingChapters[chapter.chapter_id]) {
      //check if this verse is being modified or converted
      if (verseModifications[currentVerse.verse_id]) {
        setCurrentVerse(null);
      }
    }
  }, [isConvertingChapters, currentVerse, verseModifications]);

  const handleTextareaResize = (
    e: React.ChangeEvent<HTMLTextAreaElement> | HTMLTextAreaElement
  ) => {
    const target = e instanceof HTMLTextAreaElement ? e : e.target;
    target.style.height = "auto";
    target.style.height = `${target.scrollHeight}px`;
  };

  const handleVerseUpdate = async () => {
    try {
      if (isConvertingChapters[chapter.chapter_id]) return;

      setIsSyncingChanges(true);

      const verseIds = Object.keys(verseModifications).map(Number);
      const successfulUpdates: number[] = [];
      for (const verseId of verseIds) {
        try {
          await updateVerseText(
            verseId,
            verseModifications[verseId],
            bookName,
            chapter.chapter,
            projectId
          );

          successfulUpdates.push(verseId);

          //Remove from localStorage after successful update
          removeVerseFromLocalStorage(
            projectId,
            bookName,
            chapter.chapter,
            verseId
          );
        } catch (error) {
          console.error(`Failed to update verse ${verseId}:`, error);
        }
      }

      if (successfulUpdates.length > 0) {
        setVerseModifications((prev) => {
          const updated = { ...prev };
          for (const verseId of successfulUpdates) {
            delete updated[verseId];
          }
          return updated;
        });
      }
      const pendingConversions = hasPendingChanges(
        projectId,
        bookName,
        chapter.chapter
      );
      setHasPendingConversion(pendingConversions);
      await fetchChapterDetails(projectId, bookName, chapter.chapter);
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Error updating verse",
      });
    } finally {
      setIsSyncingChanges(false);
    }
  };

  const handleTextChange = (
    verseId: number,
    newText: string,
    originalText: string
  ) => {
    const hasChanged = newText.trim() !== originalText.trim();

    if (hasChanged) {
      setVerseModifications((prev) => ({ ...prev, [verseId]: newText }));
      saveVerseToLocalStorage(
        projectId,
        bookName,
        chapter.chapter,
        verseId,
        newText
      );
      setHasPendingConversion(true);
      setApproved(false);
    } else {
      setVerseModifications((prev) => {
        const updated = { ...prev };
        delete updated[verseId];
        return updated;
      });
      removeVerseFromLocalStorage(
        projectId,
        bookName,
        chapter.chapter,
        verseId
      );
      const pendingConversion = hasPendingChanges(
        projectId,
        bookName,
        chapter.chapter
      );
      setHasPendingConversion(pendingConversion);
    }
  };

  const handleApproveChapter = async () => {
    if (
      !isConvertingChapters[chapter.chapter_id] &&
      Object.keys(verseModifications).length > 0
    ) {
      await handleVerseUpdate();
    }
    const approve = !approved;
    setApproved(approve);
    try {
      await approveChapter(projectId, bookName, chapter.chapter, approve);

      if (approve && !hasPendingConversion) {
        clearStoredVersesForChapter(projectId, bookName, chapter.chapter);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error
            ? error.message
            : "Error while approving chapter",
      });
    } finally {
      setCurrentVerse(null);
      onClose();
    }
  };

  const handleConvertToSpeech = async () => {
    if (isConvertingChapters[chapter.chapter_id]) return;

    setIsConvertingChapters((prev) => ({
      ...prev,
      [chapter.chapter_id]: true,
    }));

    await handleVerseUpdate();

    // Get latest chapter details
    await fetchChapterDetails(projectId, bookName, chapter.chapter);

    const modifiedVerses =
      sortedVerses
        ?.filter(
          (verse) =>
            (verse.modified && !verse.tts) || verseModifications[verse.verse_id]
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

    if (
      currentVerse &&
      (verseModifications[currentVerse.verse_id] ||
        modifiedVerses.includes(currentVerse.verse_id))
    ) {
      setCurrentVerse(null);
    }

    const resultMsg = await convertToSpeech(projectId, bookName, chapter);

    if (
      resultMsg.includes("Text-to-speech conversion completed successfully")
    ) {
      toast({ variant: "success", title: resultMsg });

      clearStoredVersesForChapter(projectId, bookName, chapter.chapter);
      setHasPendingConversion(false);

      if (approved) {
        setApproved(false);
        await approveChapter(projectId, bookName, chapter.chapter, false);
      }
    } else {
      toast({ variant: "destructive", title: resultMsg });
    }

    setIsConvertingChapters((prev) => ({
      ...prev,
      [chapter.chapter_id]: false,
    }));
    setVerseModifications({});

    await fetchChapterDetails(projectId, bookName, chapter.chapter);
  };

  const handleFontSizeChange = (value: number[]) => setFontSize(value[0]);
  const increaseFontSize = () => setFontSize((prev) => Math.min(prev + 2, 32));
  const decreaseFontSize = () => setFontSize((prev) => Math.max(prev - 2, 14));

  const checkProgress = () => {
    if (!isConvertingChapters[chapter.chapter_id]) return null;

    const totalModified =
      sortedVerses?.filter(
        (verse) => verse.modified || verseModifications[verse.verse_id]
      ).length || 0;

    const remaining = totalModified - completedVersesCount;
    return `${remaining} verse(s) left`;
  };

  const handleCloseModal = () => {
    // Save changes if needed
    // if (
    //   !isConvertingChapters[chapter.chapter_id] &&
    //   !isSyncingChanges &&
    //   Object.keys(verseModifications).length > 0
    // ) {
    //   handleVerseUpdate();
    // }
    // Reset verse state
    setCurrentVerse(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseModal()}>
      <DialogContent
        className="w-[90vw] max-w-[90vw] h-[90vh] max-h-[90vh] flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="mt-4">
          <DialogTitle className="flex justify-between items-center gap-4 flex-wrap">
            <div className="flex items-center">
              {bookName} - Chapter {chapter.chapter}
              {hasPendingConversion && (
                <div className="ml-6 flex items-center gap-4 py-2 px-4 border-2 rounded">
                  <div className="flex items-center text-red-600 text-sm">
                    <AlertCircle size={16} className="mr-1" />
                    <span>Unsaved changes</span>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleVerseUpdate}
                    disabled={
                      isSyncingChanges ||
                      isConvertingChapters[chapter.chapter_id]
                    }
                    className="h-8"
                  >
                    {isSyncingChanges ? (
                      <>
                        <LoadingIcon className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              )}
            </div>
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
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Scrollable verses container */}
          <ScrollArea className="flex-1 border rounded p-4 mb-4">
            {sortedVerses?.map((verse) => (
              <div
                key={verse.verse_id}
                className={`flex items-center space-x-4 p-2 ${
                  verseModifications[verse.verse_id]
                    ? "bg-gray-100 rounded"
                    : ""
                }`}
              >
                <div
                  className={`w-16 text-right text-sm ${
                    verseModifications[verse.verse_id] || verse.modified
                      ? "text-yellow-700"
                      : ""
                  }`}
                >{`Verse ${verse.verse_number}:`}</div>
                <Textarea
                  className={`flex-1 min-h-[60px] w-full md:w-[500px] lg:w-[600px] resize-y whitespace-pre-wrap break-words overflow-auto md:overflow-hidden ${
                    verseModifications[verse.verse_id] || verse.modified
                      ? "border-r-4 border-l-4 border-l-yellow-500 border-r-yellow-500 bg-yellow-100"
                      : ""
                  }`}
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight,
                    wordBreak: "break-word",
                    overflowWrap: "break-word",
                    height: "auto",
                  }}
                  defaultValue={
                    verseModifications[verse.verse_id] !== undefined
                      ? verseModifications[verse.verse_id]
                      : verse.text
                  }
                  onChange={(e) => {
                    handleTextChange(
                      verse.verse_id,
                      e.target.value,
                      verse.text
                    );
                    handleTextareaResize(e);
                  }}
                  ref={(el) => (textareaRefs.current[verse.verse_id] = el)}
                  onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                  disabled={
                    isConvertingChapters[chapter.chapter_id] || isSyncingChanges
                  }
                />
                <div className="w-[50px]">
                  {verse.modified &&
                  isConvertingChapters[chapter.chapter_id] &&
                  !verse.tts ? (
                    <LoadingIcon className="animate-spin" />
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setCurrentVerse(
                          currentVerse?.verse_id === verse.verse_id
                            ? null
                            : verse
                        )
                      }
                      title={
                        !(verse.tts || verse.stt)
                          ? "Audio not available"
                          : currentVerse?.verse_id === verse.verse_id
                          ? "Hide audio player"
                          : "Show audio player"
                      }
                      disabled={!(verse.tts || verse.stt)}
                      className="relative"
                    >
                      {currentVerse?.verse_id === verse.verse_id && (
                        <span className="absolute inset-0 rounded-full bg-indigo-300 opacity-70 animate-pulse"></span>
                      )}
                      <PlayIcon
                        className={`${
                          currentVerse?.verse_id === verse.verse_id
                            ? "text-indigo-600"
                            : verseModifications[verse.verse_id] ||
                              verse.modified
                            ? "text-yellow-600"
                            : ""
                        } 
                        ${!(verse.tts || verse.stt) ? "opacity-40" : ""}
                        relative z-10`}
                        size={20}
                      />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </ScrollArea>

          {/* Audio Player */}
          {currentVerse && (
            <AudioPlayer
              verse={currentVerse}
              onClose={() => setCurrentVerse(null)}
            />
          )}

          {/* Bottom Action Buttons */}
          <div className="flex justify-end space-x-4 mt-auto pt-2">
            <Button variant="outline" onClick={handleCloseModal}>
              Close
            </Button>
            <Button
              onClick={handleApproveChapter}
              disabled={
                isConvertingChapters[chapter.chapter_id] || isSyncingChanges
              }
            >
              {approved ? "Unapprove" : "Approve"}
            </Button>
            <Button
              onClick={handleConvertToSpeech}
              disabled={
                isConvertingChapters[chapter.chapter_id] || isSyncingChanges
              }
            >
              {isConvertingChapters[chapter.chapter_id]
                ? checkProgress()
                : "Convert to Speech"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChapterModal;
