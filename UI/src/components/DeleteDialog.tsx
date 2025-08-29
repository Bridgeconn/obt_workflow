import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Book {
  book_id: number;
  book: string;
  approved: boolean;
  chapters: any[];
  status?: string;
  progress?: string;
}

interface DeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  handleDeleteBook: (book: Book) => Promise<void>;
}

export const DeleteDialog: React.FC<DeleteDialogProps> = ({
  isOpen,
  onClose,
  book,
  handleDeleteBook,
}) => {
  if (!book) return null;

  const onConfirm = async () => {
    await handleDeleteBook(book);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm Delete</DialogTitle>
        </DialogHeader>
        <p>
          Are you sure you want to delete{" "}
          <span className="font-semibold">{book.book}</span> ? 
          <br />This action cannot
          be undone.
        </p>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
