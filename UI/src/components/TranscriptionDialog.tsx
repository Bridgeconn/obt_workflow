import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const MAX_CHAPTER_TRANSCRIBE = Number(
  import.meta.env.VITE_MAX_CHAPTER_TRANSCRIBE || 3
);

interface Book {
  book_id: number;
  book: string;
  approved: boolean;
  chapters: Chapter[];
  status?: string;
  progress?: string;
}

interface Chapter {
  chapter_id: number;
  chapter: number;
  approved: boolean;
  missing_verses: number[];
  status?: string;
  progress?: string;
}

interface SelectedChapter extends Chapter {
  bookName: string;
}

interface TranscriptionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBook: Book;
  selectedChapters: SelectedChapter[];
  onChapterToggle: (chapter: SelectedChapter[]) => void;
  onTranscribe: () => void;
}

const TranscriptionDialog: React.FC<TranscriptionDialogProps> = ({
  isOpen,
  onClose,
  selectedBook,
  selectedChapters,
  onChapterToggle,
  onTranscribe,
}) => {
  const handleChapterClick = (chapter: Chapter) => {
    if (
      selectedChapters.length > 0 &&
      selectedChapters[0].bookName !== selectedBook.book
    ) {
      toast({
        title: `Cannot select chapters from multiple books.`,
        variant: "destructive",
      });
      return;
    }
    const chapterWithBookName = { ...chapter, bookName: selectedBook.book };
    const isSelected = selectedChapters.some(
      (c) => c.chapter_id === chapter.chapter_id
    );

    if (isSelected) {
      const updatedChapters = selectedChapters
        .filter((c) => c.chapter_id !== chapter.chapter_id)
        .map((chapter) => ({ ...chapter, bookName: selectedBook.book }));
      onChapterToggle(updatedChapters);
    } else {
      if (selectedChapters.length < MAX_CHAPTER_TRANSCRIBE) {
        onChapterToggle([
          ...selectedChapters.map((chapter) => ({
            ...chapter,
            bookName: selectedBook.book,
          })),
          chapterWithBookName,
        ]);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Transcribe {selectedBook.book} audio to text
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Select chapters to transcribe
          </p>
        </DialogHeader>
        <div className="flex overflow-x-auto items-center space-x-6 mt-2">
          <span className="font-semibold pb-2">{selectedBook.book}</span>
          <div className="flex overflow-x-auto space-x-2 max-w-full">
            {selectedBook.chapters
              .filter(
                (chapter) =>
                  chapter.status === "notTranscribed" ||
                  chapter.status === "transcriptionError" ||
                  chapter.status === "error"
              )
              .map((chapter) => {
                const isSelected = selectedChapters.some(
                  (ch) => ch.chapter_id === chapter.chapter_id
                );
                const disabled =
                  selectedChapters.length >= MAX_CHAPTER_TRANSCRIBE &&
                  !isSelected;

                return (
                  <button
                    key={chapter.chapter_id}
                    className={`w-10 h-10 rounded-full border border-gray-300 text-base font-bold flex-shrink-0 ${
                      isSelected
                        ? "bg-red-300 text-white border-red-600"
                        : disabled
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : "bg-white text-black"
                    }`}
                    disabled={disabled}
                    onClick={() => handleChapterClick(chapter)}
                  >
                    {chapter.chapter}
                  </button>
                );
              })}
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button onClick={onTranscribe}>Proceed</Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TranscriptionDialog;
