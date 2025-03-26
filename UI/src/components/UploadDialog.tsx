import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import bookCodes from "../data/book_codes.json";

interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  bookCode: string;
  addedChapters: number[] | null;
  skippedChapters: number[] | null;
  modifiedChapters: number[] | null;
  addedVerses: string[] | null;
  modifiedVerses: string[] | null;
  skippedVerses: string[] | null;
}

const UploadDialog: React.FC<UploadDialogProps> = ({
  isOpen,
  onClose,
  bookCode,
  addedChapters,
  skippedChapters,
  modifiedChapters,
  addedVerses,
  modifiedVerses,
  skippedVerses,
}) => {
  const getBookName = (code: string): string => {
    const book = bookCodes.find((b) => b.abbreviation === code.toLowerCase());
    return book ? book.book : code;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-2xl font-bold text-gray-900">
            <div>
              <p className="text-gray-800 text-lg font-bold">
                {bookCode && getBookName(bookCode)} Book has been uploaded
                successfully
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="pr-4 max-h-[400px]">
          <div className="py-4 space-y-6">
            {/* Added Chapters Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                  Chapters Added
                </Badge>
              </div>
              {addedChapters && addedChapters.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {addedChapters.map((chapter) => (
                    <span
                      key={chapter}
                      className="w-8 h-8 flex items-center justify-center rounded-full border"
                    >
                      {chapter}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">No chapters added</div>
              )}
              {skippedVerses && skippedVerses?.length > 0 && (
                <p className="text-sm">
                  <label className="text-orange-500 font-bold">Warning :</label>{" "}
                  {skippedVerses?.length} verse file(s) skipped due to file
                  incompatibility
                </p>
              )}
            </div>

            {/* Modified Chapters Section */}
            <div className="border-t border-gray-200 my-4"></div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                  Chapters Modified
                </Badge>
              </div>
              {modifiedChapters && modifiedChapters.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {modifiedChapters.map((chapter) => (
                    <span
                      key={chapter}
                      className="w-8 h-8 flex items-center justify-center rounded-full border"
                    >
                      {chapter}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  No chapters modified
                </div>
              )}
              <div className="space-y-2 text-sm mt-2">
                {modifiedVerses && modifiedVerses.length > 0 && (
                  <p className="text-sm">
                    <label className="text-blue-500 font-bold">Note :</label>{" "}
                    {modifiedVerses.length} verse(s) modified in{" "}
                    {modifiedChapters && modifiedChapters.length === 1
                      ? "this chapter"
                      : "these chapters"}
                    .
                  </p>
                )}
                {addedVerses && addedVerses.length > 0 && (
                  <p className="text-sm">
                    <label className="text-green-500 font-bold">Note :</label>{" "}
                    {addedVerses.length} new verse(s) added to{" "}
                    {modifiedChapters && modifiedChapters.length === 1
                      ? "this chapter"
                      : "these chapters"}
                    .
                  </p>
                )}
              </div>
            </div>

            {/* Skipped Chapters Section */}
            <div className="border-t border-gray-200 my-4"></div>
            {skippedChapters && skippedChapters.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                    Existing Chapters Skipped
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {skippedChapters.map((chapter) => (
                    <span
                      key={chapter}
                      className="w-8 h-8 flex items-center justify-center rounded-full border"
                    >
                      {chapter}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4">
          <Button
            onClick={onClose}
            className="w-full sm:w-auto px-8 py-2.5 font-semibold"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UploadDialog;
