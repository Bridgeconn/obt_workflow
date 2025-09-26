import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface LanguageConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedLanguageName: string;
}

const LanguageConfirmDialog: React.FC<LanguageConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  selectedLanguageName
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Language Selection</DialogTitle>
        </DialogHeader>
        <p className="text-gray-700 mt-2">
          Please Confirm <span className="font-semibold">{selectedLanguageName}</span> 
          {" "}as your selected language.
        </p>
        <DialogFooter className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LanguageConfirmDialog;
