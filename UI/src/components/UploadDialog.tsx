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
  progress: number;
  isUploading: boolean;
  isNewBook: boolean;
  dialogDescription: string;
  isFailedUploading: boolean;
  addedChapters: number[] | null;
  skippedChapters: number[] | null;
  modifiedChapters: number[] | null;
  addedVerses: string[] | null;
  modifiedVerses: string[] | null;
  skippedVerses: string[] | null;
  invalidFiles?: string[] | null;
}

const UploadDialog: React.FC<UploadDialogProps> = ({
  isOpen,
  onClose,
  bookCode,
  progress,
  isUploading,
  isNewBook,
  dialogDescription,
  isFailedUploading,
  addedChapters,
  skippedChapters,
  modifiedChapters,
  addedVerses,
  modifiedVerses,
  skippedVerses,
  invalidFiles,
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
            Book upload status
          </DialogTitle>
        </DialogHeader>

        {!isFailedUploading && (
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-600 mt-1 text-center">
              {progress < 100
                ? `Uploading: ${Math.round(progress)}%`
                : `Uploaded: 100%`}
            </p>
          </div>
        )}

        {!isUploading && isNewBook && (
          <div className="text-center">
            <p className="font-medium text-green-700 mb-1">
              {bookCode && getBookName(bookCode)} uploaded successfully
            </p>
            {dialogDescription && (
              <>
                <label className="text-orange-500 font-bold">Warning :</label>{" "}
                <span>{dialogDescription}</span>
              </>
            )}
          </div>
        )}
        {isFailedUploading && (
          <div>
            {dialogDescription && (
              <p className="mb-2 font-medium text-red-700">
                {dialogDescription}
              </p>
            )}
            {invalidFiles && invalidFiles.length > 0 ? (
              <>
                <p className="font-semibold text-gray-700 mb-1">
                  The following files exceed the allowed size:
                </p>
                <ScrollArea className="max-h-[200px] border border-gray-200 rounded-md p-2 bg-gray-50">
                  <ul className="list-disc list-inside text-sm text-gray-700">
                    {invalidFiles.map((file, idx) => (
                      <li key={idx}>{file}</li>
                    ))}
                  </ul>
                </ScrollArea>
              </>
            ) : (
              <p>
                Please upload a single book zip file with a valid book code.
              </p>
            )}
          </div>
        )}

        {!isUploading && !isNewBook && !isFailedUploading && (
          <ScrollArea className="pr-4 max-h-[400px]">
            <div className="space-y-6">
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
                  <div className="flex items-center gap-2">
                    No chapters added
                  </div>
                )}
                {skippedVerses && skippedVerses?.length > 0 && (
                  <p className="text-sm">
                    <label className="text-orange-500 font-bold">
                      Warning :
                    </label>{" "}
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
        )}

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
