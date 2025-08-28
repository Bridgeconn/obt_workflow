import { useEffect, useState, useRef } from "react";
import {
  useProjectDetailsStore,
  useTranscriptionTrackingStore,
} from "@/store/useProjectStore";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Download,
  RotateCcw,
  ArrowLeft,
  Upload,
  X,
  Archive,
  PackageOpen,
} from "lucide-react";
import useAuthStore from "@/store/useAuthStore";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import source_languages from "../data/source_languages.json";
import major_languages from "../data/major_languages.json";
import model_languages from "../data/model_languages.json";
import ChapterModal from "@/components/ChapterModal";
import { toast } from "@/hooks/use-toast";
import { useServedModels } from "@/hooks/use-served-models";
import LanguageSelect from "@/components/LanguageSelect";
import UploadDialog from "@/components/UploadDialog";
import ArchiveDialog from "@/components/ArchiveDialog";
import TranscriptionDialog from "@/components/TranscriptionDialog";

const BASE_URL = import.meta.env.VITE_BASE_URL;

interface Book {
  book_id: number;
  book: string;
  approved: boolean;
  chapters: Chapter[];
  status?: string;
  progress?: string;
}

interface Chapter {
  chapter_id: number;
  chapter: number;
  approved: boolean;
  missing_verses: number[];
  status?: string;
  progress?: string;
}

interface SelectedChapter extends Chapter {
  bookName: string;
}

interface ModelConfig {
  tts: string;
  stt: string;
}

interface ModelLanguages {
  [language: string]: ModelConfig;
}

const typedModelLanguages = model_languages as ModelLanguages;

const ProjectDetailsPage: React.FC<{ projectId: number }> = ({ projectId }) => {
  const {
    project,
    isLoading,
    fetchProjectDetails,
    clearProjectState,
    transcribeBook,
    archiveProject,
  } = useProjectDetailsStore();
  const { servedModels, refetch } = useServedModels();
  const [scriptLanguage, setScriptLanguage] = useState("");
  const [audioLanguage, setAudioLanguage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const archive =
    project && project?.project_id === projectId && project.archive;
  const [selectedChapter, setSelectedChapter] =
    useState<SelectedChapter | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadedBookData, setUploadedBookData] = useState<{
    book: string;
    added_chapters: number[];
    skipped_chapters: number[];
    modified_chapters: number[] | null;
    added_verses: string[] | null;
    modified_verses: string[] | null;
    incompartible_verses: string[] | null;
  } | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedChapters, setSelectedChapters] = useState<SelectedChapter[]>(
    []
  );
  const [selectedBook, setSelectedBook] = useState("");
  const hasRestoredSessionRef = useRef(false);

  const [isNewBook, setIsNewBook] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedBookCode, setUploadedBookCode] = useState<string | null>(null);
  const [dialogDescription, setDialogDescription] = useState("");
  const [isFailedUploading, setIsFailedUploading] = useState(false);
  const [transcriptionDialogOpen, setTranscriptionDialogOpen] = useState(false);
  const [dialogBook, setDialogBook] = useState<Book | null>(null);

  useEffect(() => {
    const loadProject = async () => {
      try {
        clearProjectState();
        setLoading(true);
        await fetchProjectDetails(projectId);
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            error instanceof Error
              ? error.message
              : "Failed to load project details",
        });
        // Navigate back to projects list on error
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectId, fetchProjectDetails, clearProjectState]);

  useEffect(() => {
    let selectedAudioLanguage = null;
    let selectedScriptLanguage = null;

    if (project && project.project_id === projectId) {
      if (project.audio_lang) {
        selectedAudioLanguage = source_languages.find(
          (language) => language.language_name === project.audio_lang
        );
        setAudioLanguage(String(selectedAudioLanguage?.id));
      }

      if (project.script_lang) {
        selectedScriptLanguage = major_languages.find(
          (language) => language.language_name === project.script_lang
        );
        setScriptLanguage(String(selectedScriptLanguage?.id));
      }

      setLoading(false);
      if (!isLoading && !hasRestoredSessionRef.current) {
        const convertingBook = sessionStorage.getItem("ConvertingBook");

        if (convertingBook) {
          const storedData = JSON.parse(convertingBook);

          if (storedData?.projectName === project?.name) {
            const storedBookId = String(storedData?.bookId || "");
            const storedChapters = storedData?.selectedChapters || [];

            setSelectedBook(storedBookId);
            setSelectedChapters(storedChapters);
          }
        } else {
          if (selectedChapters.length > 0 || selectedBook !== "") {
            setSelectedChapters([]);
            setSelectedBook("");
          }
        }

        hasRestoredSessionRef.current = true;
      }
    }
  }, [project, projectId, isLoading]);

  useEffect(() => {
    if (!project || !selectedBook || selectedChapters.length === 0) return;

    const book = project.books.find(
      (b) => b.book_id.toString() === selectedBook
    );

    if (!book) return;

    const transcribedIds = new Set(
      book.chapters
        .filter((ch) => ["transcribed"].includes(ch.status || ""))
        .map((ch) => ch.chapter_id)
    );

    const updated = selectedChapters.filter(
      (ch) => !transcribedIds.has(ch.chapter_id)
    );

    if (updated.length !== selectedChapters.length) {
      setSelectedChapters(updated);
      if (updated.length === 0) setSelectedBook("");
    }
  }, [project, selectedBook, selectedChapters]);

  useEffect(() => {
    console.log("selected chapters updated:", selectedChapters);
  }, [selectedChapters]);

  useEffect(() => {
    if (project && project.project_id === projectId && !loading) {
      // Get transcription tracking store state
      const trackingStore = useTranscriptionTrackingStore.getState();

      project.books.forEach((book) => {
        let bookHasInProgressChapters = false;

        // Check each chapter's status
        const updatedChapters = book.chapters.map((chapter) => {
          const isChapterInProgress = trackingStore.isTranscriptionInProgress(
            projectId,
            book.book_id,
            chapter.chapter_id
          );

          if (isChapterInProgress) {
            bookHasInProgressChapters = true;
            return chapter; // Keep current status if chapter is in progress
          }

          // Reset status only for chapters that were inProgress or notTranscribed
          return {
            ...chapter,
            status: ["inProgress", "notTranscribed"].includes(
              chapter.status || ""
            )
              ? "notTranscribed"
              : chapter.status,
            progress: ["inProgress", "notTranscribed"].includes(
              chapter.status || ""
            )
              ? ""
              : chapter.progress,
          };
        });

        if (!bookHasInProgressChapters) {
          const convertingBook = sessionStorage.getItem("ConvertingBook");
          if (convertingBook) {
            const convertingData = JSON.parse(convertingBook);
            if (
              convertingData?.projectName === project?.name &&
              convertingData?.bookId === book.book_id
            ) {
              sessionStorage.removeItem("ConvertingBook");
            }
          }
        }

        // Update the project state with the new chapter statuses
        useProjectDetailsStore.getState().setProject((prevProject) => {
          if (!prevProject) return prevProject;

          const updatedBooks = prevProject.books.map((b) => {
            if (b.book_id === book.book_id) {
              // Determine book status based on chapters
              const allChaptersNotTranscribed = updatedChapters.every(
                (ch) => ch.status === "notTranscribed" || ch.status === "error"
              );
              const hasInProgressChapters = updatedChapters.some(
                (ch) => ch.status === "inProgress"
              );

              const newBookStatus = bookHasInProgressChapters
                ? "inProgress"
                : allChaptersNotTranscribed
                ? "notTranscribed"
                : hasInProgressChapters
                ? "inProgress"
                : b.status;

              return {
                ...b,
                chapters: updatedChapters,
                status: newBookStatus,
                progress: bookHasInProgressChapters ? b.progress : "",
              };
            }
            return b;
          });

          return { ...prevProject, books: updatedBooks };
        });
      });
    }
  }, [projectId, loading]);

  const uploadBookWithProgress = (
    file: File,
    projectId: number,
    token: string,
    onProgress: (progress: number) => void
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      xhr.open("POST", `${BASE_URL}/projects/${projectId}/add-book`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = (event.loaded / event.total) * 100;
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(
            new Error(
              JSON.parse(xhr.responseText).detail || "Failed to upload book"
            )
          );
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(formData);
    });
  };

  const handleFileUpload = async (file: File) => {
    const bookName = file.name.replace(".zip", "").toUpperCase();
    setUploadedBookCode(bookName);
    const isBookProcessing = project?.books.some(
      (book) =>
        book.book === bookName &&
        (book.status === "inProgress" ||
          book.status === "converting" ||
          book.progress === "processing" ||
          book.chapters.some(
            (chapter) =>
              chapter.status === "inProgress" || chapter.status === "converting"
          ))
    );

    if (isBookProcessing) {
      toast({
        variant: "destructive",
        title: `Book ${bookName} is currently being processed. Please try again later.`,
      });
      return;
    }

    const token = useAuthStore.getState().token;

    try {
      setUploading(true);
      setUploadProgress(1);
      setUploadDialogOpen(true);
      setIsFailedUploading(false);
      setIsNewBook(false);
      setDialogDescription("");
      setUploadedBookData(null);
      const responseData = await uploadBookWithProgress(
        file,
        projectId,
        token!,
        setUploadProgress
      );

      if (responseData.message === "Book added successfully") {
        setIsNewBook(true);
        let succcessDescription = "";
        if (responseData?.incompartible_verses.length > 0) {
          succcessDescription = `${responseData?.incompartible_verses.length} verse file(s) skipped due to file incompatibility`;
        }
        setDialogDescription(succcessDescription);
        toast({
          title: `Book ${responseData.book} added successfully`,
          variant: "success",
          description: succcessDescription,
        });
      } else {
        setIsNewBook(false);
        setUploadedBookData(responseData);
      }
      setUploading(false);
      // Invalidate and refetch project details
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await fetchProjectDetails(projectId);
    } catch (error) {
      setUploadProgress(0);
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Failed to upload book",
      });
      setUploading(false);
      setDialogDescription(
        error instanceof Error
          ? error.message
          : "Something went wrong during upload."
      );
      setIsFailedUploading(true);
    }
  };

  // Add drag and drop handlers
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleTranscribe = async (bookId: number, selectedChapters: any) => {
    const book = project?.books.find((b) => b.book_id === bookId);
    if (!book) return;
    const validChapterIds = new Set(book.chapters.map((ch) => ch.chapter_id));
    const filteredChapters = selectedChapters.filter((ch) =>
      validChapterIds.has(ch.chapter_id)
    );
    if (String(bookId) !== selectedBook || filteredChapters.length === 0) {
      toast({
        variant: "destructive",
        title: "Please select at least one valid chapter to transcribe.",
      });
      return;
    }
    try {
      sessionStorage.setItem(
        "ConvertingBook",
        JSON.stringify({ bookId, projectName: project?.name, selectedChapters })
      );
      await transcribeBook(bookId, selectedChapters, queryClient);
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error?.message : "Failed to transcribe book",
      });
      console.error("Error transcribing book:", error);
    } finally {
      const projectState = useProjectDetailsStore.getState().project;
      const updatedBook = projectState?.books.find((b) => b.book_id === bookId);
      const failedChapterIds = updatedBook?.chapters
        .filter((ch) => ch.status === "transcriptionError")
        .map((ch) => ch.chapter_id);

      if (failedChapterIds && failedChapterIds?.length > 0) {
        const remainingChapters = selectedChapters.filter(
          (ch) => !failedChapterIds.includes(ch.chapter_id)
        );
        setSelectedChapters(remainingChapters);
        if (remainingChapters.length === 0) {
          setSelectedBook("");
        }
      }
      sessionStorage.removeItem("ConvertingBook");
    }
  };

  const checkServedModels = (
    audioLanguage: string | undefined,
    scriptLanguage: string | undefined
  ) => {
    if (!servedModels || !audioLanguage || !scriptLanguage) return;

    const requiredModels =
      typedModelLanguages[audioLanguage] || typedModelLanguages[scriptLanguage];

    if (!requiredModels) {
      console.error(
        `No model configuration found for language: ${audioLanguage}`
      );
      return;
    }

    const ttsServed = servedModels.some(
      (model) => model.modelName === requiredModels.tts
    );
    const sttServed = servedModels.some(
      (model) => model.modelName === requiredModels.stt
    );

    if (!ttsServed && !sttServed) {
      toast({
        title:
          "The required language processing models are currently offline. Please contact the ML team for assistance",
        variant: "destructive",
      });
      return;
    }

    if (!ttsServed) {
      toast({
        title:
          "Model for text-to-speech not active currently, please contact ML team for assistance",
        variant: "destructive",
      });
    }

    if (!sttServed) {
      toast({
        title:
          "Model for speech-to-text not active currently, please contact ML team for assistance",
        variant: "destructive",
      });
    }
  };
  const handleLanguageChange = async (selectedId: string) => {
    const id = Number(selectedId);
    const selectedAudioLanguage = source_languages.find(
      (language) => language.id === id
    );
    if (!selectedAudioLanguage) {
      console.error("Audio language not found.");
      return;
    }
    setAudioLanguage(String(selectedAudioLanguage.id));
    const selectedScriptLanguage = major_languages.find(
      (language) =>
        language.language_name === selectedAudioLanguage.script_language
    );
    if (!selectedScriptLanguage) {
      console.error("Script language not found.");
      return;
    }

    //fetch the served models
    await refetch();

    checkServedModels(
      selectedAudioLanguage.script_language,
      selectedScriptLanguage.major_language
    );
    const token = useAuthStore.getState().token;
    try {
      await fetch(
        `${BASE_URL}/projects/${project?.project_id}/audio_language/${selectedAudioLanguage.language_name}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      await fetch(
        `${BASE_URL}/projects/${project?.project_id}/script_language/${selectedScriptLanguage.major_language}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      console.log("error", error);
    } finally {
      setScriptLanguage(String(selectedScriptLanguage?.id));
      toast({
        title: "Language set successfully",
        variant: "success",
        description:
          "Please reach out to your Admin if you need to change the language.",
      });
    }
  };

  const openChapterModal = (chapter: Chapter, book: Book) => {
    const allowedStatuses = [
      "transcribed",
      "approved",
      "converted",
      "converting",
      "conversionError",
      "modified",
    ];

    if (allowedStatuses.includes(chapter.status || "")) {
      setSelectedChapter({ ...chapter, bookName: book.book });
      setModalOpen(true);
      return;
    }
  };

  const handleDownloadUSFM = async (projectId: number, book: Book) => {
    try {
      const response = await fetch(
        `${BASE_URL}/generate-usfm/?project_id=${projectId}&book=${book.book}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${useAuthStore.getState().token}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.detail || "Failed to generate USFM");
      }
      const contentDisposition = response.headers.get("Content-Disposition");
      let fileName = `${book.book}.usfm`; // default in case no filename is provided

      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match && match[1]) {
          fileName = match[1];
        }
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      toast({
        variant: "success",
        title: "File downloaded successfully!",
      });
    } catch (error) {
      console.log("error", error);
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error?.message : "Failed to generate USFM",
      });
    }
  };

  const handleCloseProject = () => {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    navigate("/");
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
      // Reset the file input value after upload
      e.target.value = "";
    }
  };

  const handleArchiveProject = async () => {
    if (project?.project_id === undefined) return;
    await archiveProject(project?.project_id, !archive);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    navigate("/");
  };

  const handleDownloadProject = async () => {
    try {
      const projectId = project?.project_id;
      if (!projectId) return;

      const response = await fetch(
        `${BASE_URL}/download-processed-project-zip/?project_id=${projectId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${useAuthStore.getState().token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.detail || "Failed to download zip file");
      }
      const contentDisposition = response.headers.get("Content-Disposition");
      let fileName = `${project?.name}.zip`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match && match[1]) {
          fileName = match[1];
        }
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      toast({
        variant: "success",
        title: "Project downloaded successfully!",
      });
    } catch (error) {
      console.error("Error downloading project:", error);
      toast({
        variant: "destructive",
        title:
          error instanceof Error
            ? error?.message
            : "Failed to download project",
      });
    }
  };

  const matchedLanguage = major_languages.find(
    (lang) => String(lang.id) === scriptLanguage
  );

  return (
    <div className="px-4 md:px-8 lg:px-12 mt-10 font-sans">
      {loading || project?.project_id !== projectId ? (
        <div className="min-h-screen flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-t-purple-600 border-purple-200 rounded-full animate-spin mb-4"></div>
          <div className="text-lg font-medium text-gray-600">
            Loading project details...
          </div>
        </div>
      ) : (
        <>
          {/* Project Title */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-10">
            <div className="flex flex-col xl:flex-row w-full gap-8">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ["projects"] });
                    navigate("/");
                  }}
                  className="p-1.5 rounded-full text-purple-600 hover:bg-purple-100 transition-colors"
                  title="Back to Projects"
                >
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <h1 className="text-4xl font-bold text-purple-700 whitespace-nowrap overflow-hidden text-ellipsis">
                  {project?.name}
                </h1>
              </div>
              <div className="flex flex-col md:flex-row items-start md:items-center gap-4 flex-wrap">
                {/* Audio Language */}
                <LanguageSelect
                  onLanguageChange={handleLanguageChange}
                  selectedLanguageId={audioLanguage}
                  selectedScriptLanguage={scriptLanguage}
                />

                {/* Script Language */}
                <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-4 w-full md:w-auto">
                  <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
                    Script :{" "}
                    <label className="text-gray-800 font-medium">
                      {matchedLanguage && matchedLanguage.language_name}
                    </label>
                  </label>
                </div>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept=".zip"
                onChange={handleFileInputChange}
                ref={fileInputRef}
                hidden
              />
              <Button
                variant="outline"
                className="flex items-center gap-2"
                onClick={() => fileInputRef.current?.click()}
                title="Upload a book"
              >
                <Upload className="w-4 h-4" />
                {/* Upload Book */}
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={handleDownloadProject}
                disabled={!project.books.some((book) => book.approved)}
                title="Download Project"
              >
                <Download size={20} />
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  !archive ? setArchiveDialogOpen(true) : handleArchiveProject()
                }
                title={archive ? "Restore" : "Delete"}
              >
                {archive ? <PackageOpen size={20} /> : <Archive size={20} />}
              </Button>
              <Button
                variant="outline"
                onClick={handleCloseProject}
                title="Close Project"
                style={{ color: "red" }}
              >
                <X size={20} />
              </Button>
            </div>
          </div>
          {/* {uploadProgress > 0 && (
            <div className="px-4 my-4">
              <div className="w-full bg-gray-200 rounded-full h-1">
                <div
                  className="bg-green-500 h-1 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-sm text-center text-gray-600 mt-1">{`Uploading: ${Math.round(
                uploadProgress
              )}%`}</p>
            </div>
          )} */}

          {/* Table Section */}
          <div
            className=" relative overflow-x-auto shadow-lg rounded-lg min-h-[680px] border-2"
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragging ? (
              <div className="absolute inset-0 bg-gray-50/90 flex flex-col items-center justify-center space-y-2 border-2 border-dashed border-gray-300 rounded-lg z-10">
                <Upload className="w-12 h-12 text-gray-400" />
                <p className="text-lg font-medium text-gray-600">
                  Drop book ZIP file here
                </p>
              </div>
            ) : (
              <Table className="w-full min-w-[600px] border-b">
                <TableHeader>
                  <TableRow className="bg-gray-100">
                    <TableHead className="font-semibold text-center text-primary px-3 py-3">
                      Books
                    </TableHead>
                    <TableHead className="font-semibold text-center text-primary px-3 py-3">
                      Chapters
                    </TableHead>
                    <TableHead className="font-semibold text-center text-primary px-3 py-3">
                      Status
                    </TableHead>
                    <TableHead className="font-semibold text-center text-primary px-3 py-3">
                      USFM
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {project?.books.map((book) => (
                    <TableRow key={book.book_id} className="hover:bg-gray-50">
                      {/* Books */}
                      <TableCell className="text-center px-3 py-2 font-medium text-gray-800">
                        {book.book}
                      </TableCell>

                      {/* Chapters */}
                      <TableCell className="text-center relative">
                        <div className="flex justify-center items-center gap-2 flex-wrap">
                          {book.chapters.map((chapter) => {
                            const isSelected = selectedChapters.some(
                              (c: any) => c.chapter_id === chapter.chapter_id
                            );
                            const chapterContent = (
                              <div
                                key={chapter.chapter_id}
                                className={`relative w-9 h-9 flex items-center cursor-pointer justify-center rounded-full text-lg  font-medium 
                                  ${
                                    chapter.status === "approved"
                                      ? "text-blue-700 border border-blue-600 bg-blue-200 cursor-pointer"
                                      : chapter.status === "transcribed" ||
                                        chapter.status === "converted"
                                      ? "text-green-700 border border-green-600 bg-green-200 cursor-pointer"
                                      : chapter.status === "modified"
                                      ? "text-yellow-700 border border-yellow-600 bg-yellow-200 cursor-pointer"
                                      : chapter.status === "inProgress" ||
                                        chapter.status === "converting" ||
                                        chapter.progress === "processing"
                                      ? "text-orange-700 border border-gray-100 bg-orange-200"
                                      : [
                                          "error",
                                          "conversionError",
                                          "transcriptionError",
                                        ].includes(chapter.status || "")
                                      ? "text-red-700 border border-red-600 bg-red-200"
                                      : isSelected
                                      ? "bg-red-300 text-white border-red-600"
                                      : "text-gray-700 border border-gray-300"
                                  }
                                `}
                                onClick={() => openChapterModal(chapter, book)}
                              >
                                {chapter.missing_verses?.length > 0 &&
                                  book.progress !== "processing" && (
                                    <span className="absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center bg-red-600 text-white text-sm font-bold rounded-full shadow-md">
                                      !
                                    </span>
                                  )}
                                {[
                                  "error",
                                  "conversionError",
                                  "transcriptionError",
                                ].includes(chapter.status || "") && (
                                  <button className="absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded-full shadow-md transition-colors z-20">
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                                <span>{chapter.chapter}</span>
                              </div>
                            );

                            return chapter.missing_verses?.length > 0 &&
                              book.progress !== "processing" ? (
                              <TooltipProvider key={chapter.chapter_id}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    {chapterContent}
                                  </TooltipTrigger>
                                  <TooltipContent
                                    className="bg-white rounded-lg shadow-lg border border-gray-200 w-72"
                                    side="top"
                                    sideOffset={5}
                                  >
                                    <div className="p-3">
                                      <div className="flex items-center gap-2 border-b pb-2 mb-3">
                                        <div>
                                          <h4 className="font-semibold text-left text-sm text-gray-900">
                                            Missing Verse
                                            {chapter.missing_verses.length > 1
                                              ? "s"
                                              : ""}
                                          </h4>
                                          <p className="text-xs text-gray-500">
                                            {chapter.missing_verses.length}{" "}
                                            verse
                                            {chapter.missing_verses.length > 1
                                              ? "s"
                                              : ""}{" "}
                                            missing from Chapter{" "}
                                            {chapter.chapter}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="text-sm text-gray-600 max-h-28 overflow-y-auto pr-1">
                                        <div className="flex flex-wrap gap-1.5">
                                          {chapter.missing_verses
                                            .sort((a, b) => a - b)
                                            .map((verse) => (
                                              <span
                                                key={verse}
                                                className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-xs font-medium"
                                              >
                                                {verse}
                                              </span>
                                            ))}
                                        </div>
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              chapterContent
                            );
                          })}
                        </div>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="text-center">
                        {book.status === "approved" ? (
                          <Button
                            className="bg-blue-600 text-white font-bold px-4 py-2 w-36 rounded-lg hover:bg-blue-600"
                            disabled
                          >
                            Approved
                          </Button>
                        ) : book.status === "converted" ? (
                          <Button
                            className="bg-green-600 text-white font-bold px-4 py-2 w-36 rounded-lg hover:bg-green-600"
                            disabled
                          >
                            Done
                          </Button>
                        ) : book.status === "transcribed" ? (
                          <Button
                            className="bg-green-600 text-white font-bold px-4 py-2 w-36 rounded-lg hover:bg-green-600"
                            disabled
                          >
                            Transcribed
                          </Button>
                        ) : book.status === "converted" ? (
                          <Button
                            className="bg-green-600 text-white font-bold px-4 py-2 w-36 rounded-lg hover:bg-green-600"
                            disabled
                          >
                            Done
                          </Button>
                        ) : (
                          <Button
                            className={`text-white font-bold px-4 py-2 w-36 rounded-lg ${
                              book.status === "inProgress" ||
                              book.status === "converting" ||
                              book.progress === "processing" ||
                              !scriptLanguage ||
                              !audioLanguage
                                ? "opacity-50 cursor-not-allowed"
                                : "hover:bg-gray-700"
                            }`}
                            onClick={() => {
                              if (!scriptLanguage || !audioLanguage) {
                                toast({
                                  variant: "destructive",
                                  title: "Please select the Audio Language",
                                });
                                return;
                              }
                              if (
                                book.status === "inProgress" ||
                                book.status === "converting" ||
                                book.progress === "processing"
                              ) {
                                return;
                              }
                              const allowedStatuses = [
                                "notTranscribed",
                                "error",
                                "transcriptionError",
                              ];
                              const hasTranscriptionInProgress =
                                project?.books?.some((b) =>
                                  b.chapters.some(
                                    (ch) => ch.status === "inProgress"
                                  )
                                );

                              if (hasTranscriptionInProgress) {
                                toast({
                                  variant: "destructive",
                                  title: `Transcription is already in progress in this project. Please wait before selecting another chapter.`,
                                });
                                return;
                              }
                              const isConvertProcessing =
                                sessionStorage.getItem("ConvertingBook");

                              if (isConvertProcessing) {
                                const convertProcessingObj =
                                  JSON.parse(isConvertProcessing);

                                const isDifferentProject =
                                  convertProcessingObj.projectName !==
                                  project?.name;
                                const isDifferentBook =
                                  convertProcessingObj.bookId !== book.book_id;

                                if (
                                  isDifferentProject ||
                                  (!allowedStatuses.includes(
                                    book.status || ""
                                  ) &&
                                    isDifferentBook)
                                ) {
                                  toast({
                                    variant: "destructive",
                                    title: `A book in ${convertProcessingObj.projectName} is currently being converted. Please wait until it is complete.`,
                                  });
                                  return;
                                }
                              }
                              setDialogBook(book);
                              setTranscriptionDialogOpen(true);
                            }}
                          >
                            {book.status === "inProgress" ||
                            book.status === "converting" ||
                            book.progress === "processing" ? (
                              <>
                                {book.progress === "processing" ||
                                book.progress === "" ? (
                                  <div className="flex items-center justify-center space-x-2">
                                    <span>Calculating</span>
                                    <span className="flex space-x-1">
                                      <span className="w-2 h-2 bg-black rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                      <span className="w-2 h-2 bg-black rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                      <span className="w-2 h-2 bg-black rounded-full animate-bounce"></span>
                                    </span>
                                  </div>
                                ) : (
                                  <span>{book.progress}</span>
                                )}
                              </>
                            ) : (book.status === "error" &&
                                book.progress === "Transcription failed") ||
                              ([
                                "error",
                                "transcriptionError",
                                "conversionError",
                              ].includes(book.status || "") &&
                                [
                                  "Conversion failed",
                                  "Transcription failed",
                                  "",
                                ].includes(book.progress || "")) ? (
                              "Retry"
                            ) : book.status === "notTranscribed" &&
                              book.progress === "" ? (
                              "Convert to Text"
                            ) : (
                              "error"
                            )}
                          </Button>
                        )}
                      </TableCell>

                      {/* USFM Download */}
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-full md:w-auto"
                          disabled={
                            book.chapters.length === 0 ||
                            !book.chapters.every((chapter) => chapter.approved)
                          }
                          onClick={() =>
                            handleDownloadUSFM(project.project_id, book)
                          }
                        >
                          <Download size={20} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {dialogBook && (
              <TranscriptionDialog
                isOpen={transcriptionDialogOpen}
                onClose={() => {
                  setTranscriptionDialogOpen(false);
                  if (
                    selectedBook &&
                    dialogBook?.book_id.toString() === selectedBook
                  ) {
                    setSelectedBook("");
                    setSelectedChapters([]);
                  }
                }}
                selectedBook={dialogBook}
                selectedChapters={selectedChapters}
                onChapterToggle={(updatedList) => {
                  setSelectedChapters(updatedList);
                  if (updatedList.length > 0) {
                    setSelectedBook(dialogBook.book_id.toString());
                  } else {
                    setSelectedBook("");
                  }
                }}
                onTranscribe={() => {
                  setTranscriptionDialogOpen(false);
                  handleTranscribe(dialogBook.book_id, selectedChapters);
                }}
              />
            )}
            {uploadDialogOpen && (
              <UploadDialog
                isOpen={uploadDialogOpen}
                onClose={() => {
                  setUploadDialogOpen(false);
                  setUploadedBookData(null);
                  setIsNewBook(false);
                  setUploadProgress(0);
                  setDialogDescription("");
                  setIsFailedUploading(false);
                }}
                bookCode={uploadedBookData?.book || uploadedBookCode || ""}
                progress={uploadProgress}
                isUploading={uploading}
                isNewBook={isNewBook}
                dialogDescription={dialogDescription}
                isFailedUploading={isFailedUploading}
                addedChapters={uploadedBookData?.added_chapters || []}
                skippedChapters={uploadedBookData?.skipped_chapters || []}
                modifiedChapters={uploadedBookData?.modified_chapters || []}
                addedVerses={uploadedBookData?.added_verses || []}
                modifiedVerses={uploadedBookData?.modified_verses || []}
                skippedVerses={uploadedBookData?.incompartible_verses || []}
              />
            )}
            {project && project.project_id !== undefined && selectedChapter && (
              <ChapterModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                projectId={project.project_id}
                bookName={selectedChapter.bookName}
                chapter={selectedChapter}
              />
            )}
            {archiveDialogOpen && (
              <ArchiveDialog
                isOpen={archiveDialogOpen}
                onClose={() => setArchiveDialogOpen(false)}
                handleArchiveProject={handleArchiveProject}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ProjectDetailsPage;
