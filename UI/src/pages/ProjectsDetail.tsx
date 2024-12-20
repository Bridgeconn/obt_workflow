import { useEffect, useState } from "react";
import { useProjectDetailsStore } from "@/store/useProjectStore";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import useAuthStore from "@/store/useAuthStore";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import source_languages from "../data/source_languages.json";
import major_languages from "../data/major_languages.json";
import ChapterModal from "@/components/ChapterModal";
import { toast } from "@/hooks/use-toast";

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

const ProjectDetailsPage: React.FC<{ projectId: number }> = ({ projectId }) => {
  const { project, fetchProjectDetails, transcribeBook, archiveProject } =
    useProjectDetailsStore();
  const [scriptLanguage, setScriptLanguage] = useState("");
  const [audioLanguage, setAudioLanguage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const archive =
    project && project?.project_id === projectId && project.archive;
  const [selectedChapter, setSelectedChapter] =
    useState<SelectedChapter | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    fetchProjectDetails(projectId);
  }, [projectId, fetchProjectDetails]);

  const handleTranscribe = async (bookId: number) => {
    await transcribeBook(bookId, queryClient);
  };

  const handleScriptLanguageChange = async (selectedId: string) => {
    const id = Number(selectedId);
    const selectedLanguage = major_languages.find(
      (language) => language.id === id
    );
    if (!selectedLanguage) {
      console.error("Selected language not found.");
      return;
    }
    setScriptLanguage(String(selectedLanguage.id));
    const token = useAuthStore.getState().token;
    try {
      await fetch(
        `${BASE_URL}/projects/${project?.project_id}/script_language/${selectedLanguage.major_language}`,
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

  const handleAudioLanguageChange = async (selectedId: string) => {
    const id = Number(selectedId);
    const selectedLanguage = source_languages.find(
      (language) => language.id === id
    );
    if (!selectedLanguage) {
      console.error("Selected language not found.");
      return;
    }

    setAudioLanguage(String(selectedLanguage.id));
    const token = useAuthStore.getState().token;
    try {
      await fetch(
        `${BASE_URL}/projects/${project?.project_id}/audio_language/${selectedLanguage.source_language}`,
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
    if (["transcribed", "approved"].includes(chapter.status || "")) {
      setSelectedChapter({ ...chapter, bookName: book.book });
      setModalOpen(true);
    }
  };

  const handleDownloadUSFM = async (projectId: number, book: Book) => {
    try {
      const response = await fetch(
        `${BASE_URL}/generate-usfm?project_id=${projectId}&book=${book.book}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${useAuthStore.getState().token}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("response", response);
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
          error instanceof Error ? error.message : "Failed to generate USFM.",
      });
    }
  };

  const handleCloseProject = () => {
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
        `${BASE_URL}/download-processed-project-zip?project_id=${projectId}`,
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
            ? error.message
            : "Failed to download project.",
      });
    }
  };

  return (
    <div className="px-4 md:px-8 lg:px-12 mt-10 font-sans">
      {/* Project Title */}
      <h1 className="text-4xl font-bold mb-6 text-purple-700">
        {project?.name}
      </h1>
      <div className="flex flex-col md:flex-row justify-between mb-6 items-start md:items-center gap-4 flex-wrap">
        {/* Audio Language */}
        <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-4 w-full md:w-auto">
          <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
            Source Audio Uploaded:
          </label>
          <Select
            onValueChange={handleAudioLanguageChange}
            value={audioLanguage}
          >
            <SelectTrigger className="w-full md:w-[250px] text-gray-800 font-medium border rounded-lg px-3 py-2 hover:border-gray-400 focus:ring-2 focus:ring-purple-500">
              <SelectValue placeholder="Select Language" />
            </SelectTrigger>
            <SelectContent>
              {source_languages.map((language) => (
                <SelectItem
                  key={language.language_name}
                  value={String(language.id)}
                >
                  {language.language_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Script Language */}
        <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-4 w-full md:w-auto">
          <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
            Script Language:
          </label>
          <Select
            onValueChange={handleScriptLanguageChange}
            value={scriptLanguage}
          >
            <SelectTrigger className="w-full md:w-[250px] text-gray-800 font-medium border rounded-lg px-3 py-2 hover:border-gray-400 focus:ring-2 focus:ring-purple-500">
              <SelectValue placeholder="Select Language" />
            </SelectTrigger>
            <SelectContent>
              {major_languages.map((language) => (
                <SelectItem
                  key={language.language_name}
                  value={String(language.id)}
                >
                  {language.language_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                    {book.chapters.map((chapter) => (
                      <div
                        key={chapter.chapter_id}
                        className={`relative w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold ${
                          chapter.status === "approved"
                            ? "text-blue-700 border border-blue-600 bg-blue-200 cursor-pointer"
                            : chapter.status === "transcribed"
                            ? "text-green-700 border border-green-600 bg-green-200 cursor-pointer"
                            : chapter.status === "inProgress"
                            ? "text-orange-700 border border-gray-100 bg-orange-200"
                            : chapter.status === "error"
                            ? "text-red-700 border border-red-600 bg-red-200"
                            : "text-gray-700 border border-gray-300"
                        }`}
                        onClick={() => openChapterModal(chapter, book)}
                      >
                        {chapter.missing_verses?.length > 0 &&
                          book.status === "notTranscribed" && (
                            <span className="absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center bg-red-600 text-white text-sm font-bold rounded-full shadow-md">
                              !
                            </span>
                          )}
                        <span>{chapter.chapter}</span>
                      </div>
                    ))}
                  </div>
                </TableCell>

                {/* Status */}
                <TableCell className="text-center">
                  {book.status === "approved" ? (
                    <Button
                      className="bg-blue-600 text-white font-bold px-4 py-2 md:w-full md:w-36 rounded-lg hover:bg-blue-600"
                      disabled
                    >
                      Approved
                    </Button>
                  ) : book.status === "transcribed" ? (
                    <Button
                      className="bg-green-600 text-white font-bold px-4 py-2 md:w-full md:w-36 rounded-lg hover:bg-green-600"
                      disabled
                    >
                      Transcribed
                    </Button>
                  ) : (
                    <Button
                      className={`text-white font-bold px-4 py-2 md:w-full md:w-36 rounded-lg ${
                        book.status === "inProgress" ||
                        !scriptLanguage ||
                        !audioLanguage
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-gray-700"
                      }`}
                      onClick={() => {
                        if (!scriptLanguage || !audioLanguage) {
                          toast({
                            variant: "destructive",
                            title:
                              "Please select both Source Audio Language and Script Language",
                          });
                          return;
                        }
                        if (book.status === "inProgress") {
                          return;
                        }
                        handleTranscribe(book.book_id);
                      }}
                    >
                      {book.status === "inProgress" ? (
                        <span>{book.progress}</span>
                      ) : (
                        "Transcribe"
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
                    onClick={() => handleDownloadUSFM(project.project_id, book)}
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
          <Button className="w-full md:w-auto" onClick={handleArchiveProject}>
            {archive ? "Unarchive" : "Archive"}
          </Button>
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4 w-full md:w-auto">
          <Button className="w-full md:w-auto" onClick={handleDownloadProject}>
            Download Project
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectDetailsPage;
