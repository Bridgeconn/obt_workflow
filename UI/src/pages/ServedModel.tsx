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
import { RefreshCw } from "lucide-react";
 
const AVAILABLE_MODELS = [
  { name: "mms-1b-all", useCase: "Convert to text (All)" },
  { name: "mms-tts-telugu", useCase: "Convert to speech (Telugu)" },
  { name: "mms-tts-hin-v2", useCase: "Convert to speech (Hindi)" },
  { name: "mms-tts-kannada", useCase: "Convert to speech (Kannada)" },
  { name: "mms-tts-marathi", useCase: "Convert to speech (Marathi)" },
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
    <div className="w-full mt-12 px-4 md:px-8 lg:px-12">
      {/* Header with Title and Buttons */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
        <h1 className="text-3xl font-bold">AI Models</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={refetch}
            className="flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
 
      {/* Models Table */}
      <div className="relative min-w-[800px] overflow-y-hidden h-auto border-2 rounded-lg">
        {!isLoading ? (
          <ScrollArea className="overflow-y-auto">
            {servedModels ? (
              <Table className="w-full border-collapse border border-gray-300">
                <TableHeader>
                  <TableRow className="border-b border-gray-300">
                    <TableHead className="font-semibold text-primary px-3 py-3">Model Name</TableHead>
                    <TableHead className="font-semibold text-primary px-3 py-3">Use</TableHead>
                    <TableHead className="font-semibold text-primary px-3 py-3">Served</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AVAILABLE_MODELS.map(({ name, useCase }) => {
                    const isModelServed = servedModels.some(
                      (servedModel) => servedModel.modelName === name
                    );
                    return (
                      <TableRow
                        key={name}
                        className="hover:bg-gray-100 border-b border-gray-300"
                      >
                        <TableCell className="px-4 py-4">{name}</TableCell>
                        <TableCell className="px-4 py-4">{useCase}</TableCell>
                        <TableCell className="px-4 py-4">
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
    </div>
  );
}