import { useEffect } from "react"; 
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useServedModels } from "@/hooks/use-served-models";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const AVAILABLE_MODELS = [
  "mms-1b-all",
  "seamless-m4t-large",
  "mms-tts-kannada",
  "mms-tts-marathi",
];

export default function ServedModel() {

  const { servedModels, isLoading, refetch } = useServedModels();
  const navigate = useNavigate();

  useEffect(() => {
    refetch();
  }, []);

  const handleClose = () => {
    navigate("/"); // Navigate back to the home page
  };

  return (
    <div className="p-8 max-w-4xl space-y-6 rounded-lg max-h-[420px] h-[420px]">
      <div className="flex flex-col justify-between gap-4">
        <h1 className="text-3xl font-bold">Served Models</h1>
        <button 
          onClick={refetch}
          className="px-4 py-2 w-fit rounded-md bg-gray-200 hover:bg-gray-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="mt-6 rounded-lg border border-gray-400">
        {!isLoading ? (
          <ScrollArea className="p-4 overflow-y-auto h-full">
            {servedModels ? (
              <Table className="w-full border">
                <TableHeader>
                  <TableRow>
                    <TableHead>Model Name</TableHead>
                    <TableHead>Served</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AVAILABLE_MODELS.map((modelName) => {
                    const isModelServed = servedModels.some(
                      (servedModel) => servedModel.modelName === modelName
                    );
                    return (
                      <TableRow key={modelName}>
                        <TableCell>{modelName}</TableCell>
                        <TableCell>
                          {isModelServed ? (
                            <span className="text-green-500">✔</span>
                          ) : (
                            <span className="text-red-500">✘</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-gray-500">No Models found.</p>
            )}
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-gray-500">Please wait or refresh the page</p>
          </div>
        )}
      </div>
      <div className="flex justify-between mt-4">
      <Button
        variant="outline"
        onClick={handleClose} // Navigate back when Close is clicked
      >
        Close
      </Button>
    </div>
    </div>
  );
}
