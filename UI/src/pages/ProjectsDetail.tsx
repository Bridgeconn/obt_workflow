import { useEffect, useState } from "react";
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
import { Download, RotateCcw, CornerDownLeft } from "lucide-react";
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
    fetchProjectDetails,
    clearProjectState,
    transcribeBook,
    // retryChapterTranscription,
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

  useEffect(() => {
    clearProjectState();

    setLoading(true);

    fetchProjectDetails(projectId);
  }, [projectId, fetchProjectDetails, clearProjectState]);

  useEffect(() => {
    console.log("project", project);
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
    }
  }, [project, projectId]);

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

  const handleTranscribe = async (bookId: number) => {
    try {
      await transcribeBook(bookId, queryClient);
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error?.message : "Failed to transcribe book",
      });
      console.error("Error transcribing book:", error);
    }
  };

  // const handleChapterRetry = async (book: Book, chapter: Chapter, e: React.MouseEvent) => {
  //   e.stopPropagation();

  //   if (book.status === "inProgress") {
  //     toast({
  //       variant: "destructive",
  //       title: "Book transcription is in progress. Please wait.",
  //     });
  //     return;
  //   }

  //   try {
  //     await retryChapterTranscription(projectId, book.book_id, chapter.chapter_id, queryClient);
  //   } catch (error) {
  //     toast({
  //       variant: "destructive",
  //       title: "Failed to retry chapter transcription",
  //     });
  //     console.error("Error retrying chapter transcription:", error);
  //   }
  // };

  const checkServedModels = (
    audioLanguage: string | undefined,
    scriptLanguage: string | undefined
  ) => {
    refetch();
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
        language.language_name === selectedAudioLanguage.source_language
    );
    if (!selectedScriptLanguage) {
      console.error("Script language not found.");
      return;
    }
    setScriptLanguage(String(selectedScriptLanguage?.id));
    checkServedModels(
      selectedAudioLanguage.source_language,
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
    }
  };

  const openChapterModal = (chapter: Chapter, book: Book) => {
    if (
      ["transcribed", "approved", "converted", "converting"].includes(
        chapter.status || ""
      )
    ) {
      setSelectedChapter({ ...chapter, bookName: book.book });
      setModalOpen(true);
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
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => navigate("/")}
              className="p-1.5 rounded-full text-purple-600 hover:bg-purple-100 transition-colors"
              title="Back to Projects"
            >
              <CornerDownLeft className="w-6 h-6" />
            </button>
            <h1 className="text-4xl font-bold text-purple-700">
              {project?.name}
            </h1>
          </div>
          <div className="flex flex-col md:flex-row justify-between mb-6 items-start md:items-center gap-4 flex-wrap">
            {/* Audio Language */}
            <LanguageSelect
              onLanguageChange={handleLanguageChange}
              selectedLanguageId={audioLanguage}
            />

            {/* Script Language */}
            <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-4 w-full md:w-auto">
              <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
                Script Language
              </label>
              <div className="w-full md:w-[250px] min-h-[36px] border rounded-lg px-3 py-2">
                {matchedLanguage && (
                  <div className="text-gray-800 font-medium bold hover:border-gray-400">
                    {matchedLanguage.language_name}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table Section */}
          <div className="overflow-x-auto shadow-lg rounded-lg h-[420px] border-2">
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
                          const chapterContent = (
                            <div
                              key={chapter.chapter_id}
                              className={`relative w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold ${
                                chapter.status === "approved"
                                  ? "text-blue-700 border border-blue-600 bg-blue-200 cursor-pointer"
                                  : chapter.status === "transcribed" ||
                                    chapter.status === "converted"
                                  ? "text-green-700 border border-green-600 bg-green-200 cursor-pointer"
                                  : chapter.status === "inProgress" ||
                                    chapter.status === "converting"
                                  ? "text-orange-700 border border-gray-100 bg-orange-200"
                                  : chapter.status === "error"
                                  ? "text-red-700 border border-red-600 bg-red-200"
                                  : "text-gray-700 border border-gray-300"
                              }`}
                              onClick={() => openChapterModal(chapter, book)}
                            >
                              {chapter.missing_verses?.length > 0 &&
                                chapter.status === "notTranscribed" &&
                                book.status === "notTranscribed" && (
                                  <span className="absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center bg-red-600 text-white text-sm font-bold rounded-full shadow-md">
                                    !
                                  </span>
                                )}
                              {chapter.status === "error" && (
                                <button
                                  className="absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded-full shadow-md transition-colors z-20"
                                  // onClick={(e) =>
                                  //   handleChapterRetry(book, chapter, e)
                                  // }
                                  // title="Retry transcription"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                </button>
                              )}
                              <span>{chapter.chapter}</span>
                            </div>
                          );

                          return chapter.missing_verses?.length > 0 &&
                            chapter.status === "notTranscribed" &&
                            book.status === "notTranscribed" ? (
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
                                          {chapter.missing_verses.length} verse
                                          {chapter.missing_verses.length > 1
                                            ? "s"
                                            : ""}{" "}
                                          missing from Chapter {chapter.chapter}
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
                              book.status === "converting"
                            ) {
                              return;
                            }
                            handleTranscribe(book.book_id);
                          }}
                        >
                          {book.status === "inProgress" ||
                          book.status === "converting" ? (
                            <span>{book.progress}</span>
                          ) : book.status === "error" ? (
                            "Retry"
                          ) : (
                            "Convert to Text"
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

            {project && project.project_id !== undefined && selectedChapter && (
              <ChapterModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                projectId={project.project_id}
                bookName={selectedChapter.bookName}
                chapter={selectedChapter}
              />
            )}
          </div>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mt-6">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 w-full md:w-auto">
              <Button className="w-full md:w-auto" onClick={handleCloseProject}>
                Close
              </Button>
              <Button
                className="w-full md:w-auto"
                onClick={handleArchiveProject}
              >
                {archive ? "Unarchive" : "Archive"}
              </Button>
            </div>
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 w-full md:w-auto">
              <Button
                className="w-full md:w-auto"
                onClick={handleDownloadProject}
                disabled={!project.books.some((book) => book.approved)}
              >
                Download Project
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ProjectDetailsPage;
