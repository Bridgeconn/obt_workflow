import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const BASE_URL = import.meta.env.VITE_AI_BASE_URL;

// Define the type for the served models
interface ServedModel {
  modelName: string;
  modelVersion: string;
}

export default function ServedModel() {
  const [servedModels, setServedModels] = useState<ServedModel[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { toast } = useToast();
  const models = [
    "mms-1b-all",
    "seamless-m4t-large",
    "mms-tts-kannada",
    "mms-tts-marathi",
  ];

  useEffect(() => {
    handleFetchModels();
  }, []);

  const handleFetchModels = async () => {
    try {
      setIsLoading(true);
      const models = await fetchServedModels();
      if (models) {
        setServedModels(models);
      }
    } catch (error) {
      toast({
        title: "Failed to fetch models",
        variant: "destructive",
      });
      console.error("Error fetching models:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchServedModels = async () => {
    const api_token = "ory_st_mby05AoClJAHhX9Xlnsg1s0nn6Raybb3";
    const response = await fetch(`${BASE_URL}/model/served-models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${api_token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch served models");
    }

    return response.json();
  };

  return (
    <div className="p-8 max-w-4xl space-y-6 rounded-lg max-h-[420px] h-[420px]">
      <h1 className="text-3xl font-bold">Served Models</h1>

      <div className="mt-6 rounded-lg border border-gray-400 ">
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
                  {models.map((modelName) => {
                    const isModelServed = servedModels.some(
                      (servedModel: ServedModel) =>
                        servedModel.modelName === modelName
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
              <p className="text-gray-500">No Model found.</p>
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
