import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import useAuthStore from "@/store/useAuthStore";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

const BASE_URL = import.meta.env.VITE_BASE_URL;

export default function AdminLogs() {
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const { token } = useAuthStore();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    handleFetchFile();
  }, []);

  // Fetch logs file from the server
  const handleFetchFile = async () => {
    setIsLoading(true);
    try {
      const fileData = await fetchFile();
      if (fileData) {
        setFileContent(fileData);
      }
    } catch (error) {
      toast({
        title: "Failed to fetch file",
        variant: "destructive",
      });
      console.error("Error fetching file:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFile = async (): Promise<string | null> => {
    const response = await fetch(`${BASE_URL}/admin/logs`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch file");
    }

    const blob = await response.blob();
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = () => {
        if (reader.result) resolve(reader.result as string);
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(blob);
    });
  };

  // Handle file download
  const handleDownloadFile = async () => {
    setIsDownloading(true);
    try {
      await downloadFile();
    } catch (error) {
      console.error("Error downloading file:", error);
      toast({
        title: "Failed to download file",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const downloadFile = async () => {
    const response = await fetch(`${BASE_URL}/admin/logs`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch file for download");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "logs.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    navigate("/"); // Redirect to the home page or any other route
  };

  return (
    <div className="p-8 space-y-6 bg-gray-900 text-white rounded-lg shadow-lg max-w-5xl mx-auto mt-8">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-green-400">Server Logs</h1>
        <div className="flex gap-4 items-center">
          <Button
            variant="default"
            onClick={handleFetchFile}
            disabled={isLoading}
            className="border border-white"
          >
            {isLoading ? "Loading..." : "Refresh"}
          </Button>
          <Button
            variant="default"
            onClick={handleDownloadFile}
            disabled={isLoading}
            className="border border-white"
          >
            {isDownloading ? "Downloading..." : "Download Logs"}
          </Button>
          <Button className="border border-white" onClick={handleClose} variant="default">
            Close
          </Button>
        </div>
      </div>

      <div className="mt-6 bg-black rounded-lg border border-gray-700">
        <ScrollArea className="max-h-[600px] h-[600px] p-4 overflow-y-auto">
          {fileContent && !isLoading ? (
            <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap">
              {fileContent}
            </pre>
          ) : (
            <p className="text-gray-500">
              No logs fetched yet. Please wait or click the "Refresh" button.
            </p>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
