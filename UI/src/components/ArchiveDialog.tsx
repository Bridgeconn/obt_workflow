import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ArchiveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  handleArchiveProject: () => void;
}

const ArchiveDialog: React.FC<ArchiveDialogProps> = ({
  isOpen,
  onClose,
  handleArchiveProject,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <div className="py-4 space-y-6">
          <h2>Do you want to archive this project ?</h2>
        </div>

        <DialogFooter className="mt-4 flex flex-col md:flex-row gap-2">
          <Button
            onClick={handleArchiveProject}
            className="w-full sm:w-auto px-8 py-2.5 font-semibold"
          >
            Yes
          </Button>
          <Button
            onClick={onClose}
            className="w-full sm:w-auto px-8 py-2.5 font-semibold"
          >
            No
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ArchiveDialog;
