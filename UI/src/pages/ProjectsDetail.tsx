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
import lang_codes from "../data/language_codes.json";

const ProjectDetailsPage: React.FC<{ projectId: number }> = ({ projectId }) => {
  const {
    project,
    fetchProjectDetails,
    transcribeBook,
  } = useProjectDetailsStore();
  const [scriptLanguage, setScriptLanguage] = useState("");
  const [audioLanguage, setAudioLanguage] = useState("");
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
    const lang_code = lang_codes[selectedLanguage.major_language as keyof typeof lang_codes]?.tts;
    const token = useAuthStore.getState().token;
    const response = await fetch(
      `http://localhost:8000/projects/${project?.project_id}/script_language/${lang_code}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await response.json();
    console.log("script language response data", data);
  };

  const handleAudioLanguageChange = async (selectedId: string) => {
    const id = Number(selectedId);
    const selectedLanguage = source_languages.find(
      (language) => language.id === id
    );
    console.log("selected language", selectedLanguage)
    if (!selectedLanguage) {
      console.error("Selected language not found.");
      return;
    }

    setAudioLanguage(String(selectedLanguage.id));
    const lang_code = lang_codes[selectedLanguage.source_language as keyof typeof lang_codes]?.stt;
    const token = useAuthStore.getState().token;
    const response = await fetch(
      `http://localhost:8000/projects/${project?.project_id}/audio_language/${lang_code}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await response.json();
    console.log("audio language response data", data);
  };

  const handleDownloadProject = (bookId: number) => {
    console.log("Downloading project for book ID:", bookId);
  };

  const handleCloseProject = () => {
    navigate("/");
  };

  return (
    <div className="px-4 md:px-8 lg:px-12 mt-10 font-sans">
      {/* Project Title */}
      <h1 className="text-4xl font-bold mb-6 text-purple-700">
        {project?.name}
      </h1>
      <div className="flex justify-between mb-6 align-center gap-4 flex-wrap">
        {/* Audio Language */}
        <div className="flex items-center space-x-4">
          <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
            Source Audio Uploaded:
          </label>
          <Select
            onValueChange={handleAudioLanguageChange}
            value={audioLanguage}
          >
            <SelectTrigger className="w-[250px] text-gray-800 font-medium border rounded-lg px-3 py-2 hover:border-gray-400 focus:ring-2 focus:ring-purple-500">
              <SelectValue placeholder="Select Language" />
            </SelectTrigger>
            <SelectContent>
              {source_languages.map((language) => (
                <SelectItem key={language.language_name} value={String(language.id)} disabled={["Kannada", "Marathi"].includes(language.source_language)}>
                  {language.language_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Script Language */}
        <div className="flex items-center space-x-4">
          <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
            Script Language:
          </label>
          <Select
            onValueChange={handleScriptLanguageChange}
            value={scriptLanguage}
          >
            <SelectTrigger className="w-[250px] text-gray-800 font-medium border rounded-lg px-3 py-2 hover:border-gray-400 focus:ring-2 focus:ring-purple-500">
              <SelectValue placeholder="Select Language" />
            </SelectTrigger>
            <SelectContent>
              {major_languages.map((language) => (
                <SelectItem key={language.language_name} value={String(language.id)} disabled={["Kannada", "Marathi"].includes(language.major_language)}>
                  {language.language_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table Section */}
      <div className="overflow-x-auto shadow-lg rounded-lg">
        <Table className="w-full min-w-[600px] border">
          <TableHeader>
            <TableRow className="bg-gray-100">
              <TableHead className="font-semibold text-center px-2 py-3 w-[40px]">
                
              </TableHead>
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
                {/* Checkbox */}
                <TableCell className="text-center px-2 py-2 w-[40px]">
                  <input
                    type="checkbox"
                    className="w-5 h-5 text-purple-600 border-gray-300 rounded"
                  />
                </TableCell>

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
                          chapter.status === "transcribed"
                            ? "text-green-700 border border-green-600 bg-green-200"
                            : chapter.status === "inProgress"
                            ? "text-orange-700 border border-gray-100 bg-orange-200"
                            : "text-gray-700 border border-gray-300"
                        }`}
                      >
                        {chapter.missing_verses?.length > 0 &&
                          chapter.status === "notTranscribed" && (
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
                      className="bg-blue-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-blue-600"
                      disabled
                    >
                      Approved
                    </Button>
                  ) : book.status === "transcribed" ? (
                    <Button
                      className="bg-green-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-green-600"
                      disabled
                    >
                      Transcribed
                    </Button>
                  ) : (
                    <Button
                      disabled={
                        book.status === "inProgress" ||
                        !scriptLanguage ||
                        !audioLanguage
                      }
                      onClick={() => handleTranscribe(book.book_id)}
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
                    disabled={
                      !book.chapters.some((chapter) => chapter.approved)
                    }
                    onClick={() => handleDownloadProject(book.book_id)}
                  >
                    <Download size={20} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Close Button */}
      <div className="flex justify-left mt-6">
        <Button
          onClick={handleCloseProject}
        >
          Close
        </Button>
      </div>
    </div>
  );
};

export default ProjectDetailsPage;
