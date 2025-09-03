import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.VITE_AI_BASE_URL;
const API_TOKEN = import.meta.env.VITE_AI_API_TOKEN;

interface ServedModel {
  modelName: string;
  modelVersion: string;
}

interface UseServedModelsReturn {
  servedModels: ServedModel[] | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export const useServedModels = (): UseServedModelsReturn => {
  const [servedModels, setServedModels] = useState<ServedModel[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  const fetchServedModels = async () => {
    const response = await fetch(`${BASE_URL}/model/served-models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch served models");
    }

    return response.json();
  };

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const models = await fetchServedModels();
      setServedModels(models);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("An error occurred");
      setError(error);
      toast({
        title: error?.message,
        variant: "destructive",
      });
      console.error("Error fetching served models:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    servedModels,
    isLoading,
    error,
    refetch: fetchData,
  };
};