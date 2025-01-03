import { create } from "zustand";
import { QueryClient } from "@tanstack/react-query";
import useAuthStore from "./useAuthStore";

const BASE_URL = import.meta.env.VITE_BASE_URL;

interface ProjectDetailsState {
  project: Project | null;
  isLoading: boolean;
  error: string | null;
  setProject: (updater: (project: Project | null) => Project | null) => void;
  fetchProjectDetails: (projectId: number) => void;
  clearProjectState: () => void;
  transcribeBook: (bookId: number, queryClient?: QueryClient) => Promise<void>;
  archiveProject: (projectId: number, archive: boolean) => Promise<void>;
}

interface Project {
  project_id: number;
  name: string;
  owner_id: number;
  user_name: string;
  script_lang: string;
  audio_lang: string;
  archive: boolean;
  books: Book[];
}

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

interface Verse {
  verse_id: number;
  verse_number: number;
  stt: boolean;
  stt_msg: string;
  text: string;
  tts: boolean;
  tts_path: string;
  modified: boolean;
  size: number;
  format: string;
  path: string;
  name: string;
  tts_msg: string;
}

interface ChapterStatusResponse {
  message: string;
  chapter_info: {
    project_id: number;
    book_code: string;
    chapter_id: number;
    chapter_number: number;
  };
  data: Verse[];
}

interface ChapterDetailsState {
  chapterVerses: Verse[] | null;
  fetchChapterDetails: (
    projectId: number,
    book: string,
    chapter: number
  ) => void;
  updateVerseText: (
    verseId: number,
    newText: string,
    book: string,
    chapter: number
  ) => void;
  approveChapter: (
    projectId: number,
    book: string,
    chapter: number,
    approve: boolean
  ) => Promise<void>;
  convertToSpeech: (
    project_id: number,
    bookName: string,
    chapter: Chapter
  ) => Promise<string>;
}

export const useProjectDetailsStore = create<ProjectDetailsState>(
  (set, get) => ({
    project: null,
    scriptLanguage: "",
    audioLanguage: "",
    isLoading: false,
    error: null,
    setProject: (updater) =>
      set((state) => ({
        project:
          typeof updater === "function" ? updater(state.project) : updater,
      })),
    fetchProjectDetails: async (projectId: number) => {
      set({ isLoading: true, error: null });
      const token = useAuthStore.getState().token;
      try {
        // Fetch initial project details
        const response = await fetch(
          `${BASE_URL}/project/details?project_id=${projectId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );
        const data = await response.json();

        // Fetch detailed status for each book and chapter
        const updatedBooks = await Promise.all(
          data.project.books.map(async (book: Book) => {
            const sortedChapters = book.chapters.sort((a, b) => a.chapter - b.chapter);
          
            const chapterStatuses = await Promise.all(
              sortedChapters.map(async (chapter) => {
                const chapterStatusResponse = await fetch(
                  `${BASE_URL}/project/${data.project.project_id}/${book.book}/${chapter.chapter}`,
                  {
                    method: "GET",
                    headers: {
                      Authorization: `Bearer ${token}`,
                      "Content-Type": "application/json",
                    },
                  }
                );
                const chapterStatusData: ChapterStatusResponse =
                  await chapterStatusResponse.json();

                // Determine chapter status
                const verses = chapterStatusData.data;
                const allTranscribed = verses.every((verse) => verse.stt);
                const allConverted = verses.every((verse) => verse.tts);
                const completed = verses.filter((verse) => verse.stt).length;
                const total = verses.length;
                const isApproved = chapter.approved;

                return {
                  ...chapter,
                  status:
                    isApproved && allTranscribed
                      ? "approved"
                      : allConverted
                      ? "converted"
                      : allTranscribed
                      ? "transcribed"
                      : "notTranscribed",
                  progress: allTranscribed
                    ? ""
                    : `${completed} out of ${total} done`,
                  verses: verses,
                };
              })
            );

            // Determine book-level status
            const bookStatus = chapterStatuses.every(
              (ch) => ch.status === "approved"
            )
              ? "approved"
              : chapterStatuses.every((ch) => ch.status === "converted")
              ? "converted"
              : chapterStatuses.every((ch) =>
                  ["transcribed", "approved", "converted"].includes(ch.status)
                )
              ? "transcribed"
              : chapterStatuses.some((ch) => ch.status === "inProgress")
              ? "inProgress"
              : "notTranscribed";

            return {
              ...book,
              chapters: chapterStatuses,
              status: bookStatus,
              progress:
                bookStatus === "inProgress"
                  ? chapterStatuses.find((ch) => ch.status === "inProgress")
                      ?.progress
                  : "",
            };
          })
        );
        set({
          project: {
            ...data.project,
            books: updatedBooks,
          },
          isLoading: false,
        });
      } catch (error) {
        console.error("Error fetching project details:", error);
        set({ error: "Error fetching project details", isLoading: false });
      }
    },

    clearProjectState: () => set({ project: null }),

    transcribeBook: async (bookId: number, queryClient?: QueryClient) => {
      const token = useAuthStore.getState().token;
      const currentProject = get().project;

      if (!currentProject) return;

      set({ isLoading: true, error: null });

      try {
        const book = currentProject.books.find((b) => b.book_id === bookId);
        if (!book) throw new Error("Book not found");
        
        // Sequential chapter transcription
        for (const chapter of book.chapters) {
          try {
            const transcribeResponse = await fetch(
              `${BASE_URL}/project/chapter/stt?project_id=${currentProject.project_id}&book_code=${book.book}&chapter_number=${chapter.chapter}`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
              }
            );

            if (!transcribeResponse.ok) {
              throw new Error(
                `Failed to start transcription for chapter ${chapter.chapter}`
              );
            }

            await new Promise<void>((resolve, reject) => {
              const pollChapterStatus = async () => {
                try {
                  const response = await fetch(
                    `${BASE_URL}/project/${currentProject.project_id}/${book.book}/${chapter.chapter}`,
                    {
                      method: "GET",
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                      },
                    }
                  );

                  const data: ChapterStatusResponse = await response.json();
                  const verses = data.data;
                  const allTranscribed = verses.every((verse) => verse.stt);
                  const completed = verses.filter((verse) => verse.stt).length;
                  const total = verses.length;

                  set((state) => {
                    if (!state.project) return {};

                    const updatedBooks = state.project.books.map((b) => {
                      if (b.book_id === bookId) {
                        const updatedChapters = b.chapters.map((ch) => {
                          if (ch.chapter === chapter.chapter) {
                            return {
                              ...ch,
                              status: allTranscribed
                                ? "transcribed"
                                : "inProgress",
                              progress: allTranscribed
                                ? ""
                                : `${completed} out of ${total} done`,
                            };
                          }
                          return ch;
                        });

                        const bookStatus = updatedChapters.every(
                          (ch) => ch.status === "transcribed"
                        )
                          ? "transcribed"
                          : updatedChapters.some(
                              (ch) => ch.status === "inProgress"
                            )
                          ? "inProgress"
                          : "notTranscribed";

                        return {
                          ...b,
                          chapters: updatedChapters,
                          status: bookStatus,
                          progress:
                            bookStatus === "inProgress"
                              ? updatedChapters.find(
                                  (ch) => ch.status === "inProgress"
                                )?.progress
                              : "",
                        };
                      }
                      return b;
                    });

                    return {
                      project: {
                        ...state.project,
                        books: updatedBooks,
                      },
                    };
                  });

                  if (allTranscribed) {
                    resolve();
                  } else {
                    setTimeout(pollChapterStatus, 10000);
                  }
                } catch (error) {
                  // Update state with error status
                  set((state) => {
                    if (!state.project) return {};

                    const updatedBooks = state.project.books.map((b) => {
                      if (b.book_id === bookId) {
                        const updatedChapters = b.chapters.map((ch) => {
                          if (ch.chapter === chapter.chapter) {
                            return {
                              ...ch,
                              status: "error",
                              progress: "Transcription failed",
                            };
                          }
                          return ch;
                        });

                        return {
                          ...b,
                          chapters: updatedChapters,
                          status: "notTranscribed",
                          progress: "",
                        };
                      }
                      return b;
                    });

                    return {
                      project: {
                        ...state.project,
                        books: updatedBooks,
                      },
                    };
                  });

                  reject(error);
                }
              };

              pollChapterStatus();
            });
          } catch (error) {
            // Update state with error status
            set((state) => {
              if (!state.project) return {};

              const updatedBooks = state.project.books.map((b) => {
                if (b.book_id === bookId) {
                  const updatedChapters = b.chapters.map((ch) => {
                    if (ch.chapter === chapter.chapter) {
                      return {
                        ...ch,
                        status: "error",
                        progress: "Transcription failed",
                      };
                    }
                    return ch;
                  });

                  return {
                    ...b,
                    chapters: updatedChapters,
                    status: "notTranscribed",
                    progress: "",
                  };
                }
                return b;
              });

              return {
                project: {
                  ...state.project,
                  books: updatedBooks,
                },
              };
            });

            throw error;
          }
        }

        set({ isLoading: false });
        queryClient?.invalidateQueries({
          queryKey: ["project-details", currentProject.project_id],
        });
      } catch (error) {
        console.error("Error transcribing book:", error);
        set({ error: "Error transcribing book", isLoading: false });
      }
    },
    archiveProject: async (projectId, archive) => {
      console.log("archive value", archive);
      set({ isLoading: true, error: null });

      try {
        const response = await fetch(
          `${BASE_URL}/projects/${projectId}/archive?archive=${archive}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${useAuthStore.getState().token}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error("Failed to archive project.");
        }
        useProjectDetailsStore.getState().setProject((prevProjects) => {
          if (!prevProjects) return prevProjects;
          if (prevProjects.project_id === projectId) {
            return { ...prevProjects, archive: archive };
          } else {
            return prevProjects;
          }
        });
      } catch (error) {
        console.error("Failed to archive project:", error);
        set({ error: "Error archiving project." });
      } finally {
        set({ isLoading: false });
      }
    },
  })
);

export const useChapterDetailsStore = create<ChapterDetailsState>(
  (set, get) => ({
    chapterVerses: null,

    fetchChapterDetails: async (projectId, book, chapter) => {
      try {
        const response = await fetch(
          `${BASE_URL}/project/${projectId}/${book}/${chapter}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${useAuthStore.getState().token}`,
            },
          }
        );
        const data = await response.json();
        set({ chapterVerses: data.data });
      } catch (error) {
        console.error("Failed to fetch chapter details:", error);
      }
    },

    updateVerseText: async (verseId, newText, book, chapter) => {
      try {
        const response = await fetch(
          `${BASE_URL}/project/verse/${verseId}?verse_text=${newText}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${useAuthStore.getState().token}`,
            },
          }
        );
        if (response.ok) {
          set((state) => ({
            chapterVerses: state.chapterVerses?.map((verse) =>
              verse.verse_id === verseId
                ? { ...verse, text: newText, tts: false }
                : verse
            ),
          }));
          useProjectDetailsStore.getState().setProject((prevProject) => {
            if (!prevProject) return prevProject;
            const updatedBooks = prevProject.books.map((b) => {
              if (b.book === book) {
                const updatedChapters = b.chapters.map((ch) => {
                  if (ch.chapter === chapter) {
                    const newStatus =
                      ch.status === "approved" ? "transcribed" : ch.status;
                    return { ...ch, status: newStatus, approved: false };
                  }
                  return ch;
                });
                const updatedBookStatus = updatedChapters.every(
                  (ch) => ch.status === "approved"
                )
                  ? "approved"
                  : updatedChapters.every((ch) =>
                      ["transcribed", "approved"].includes(ch.status ?? "")
                    )
                  ? "transcribed"
                  : b.status || "notTranscribed";
                return {
                  ...b,
                  chapters: updatedChapters,
                  status: updatedBookStatus,
                  approved: false,
                };
              }
              return b;
            });
            return { ...prevProject, books: updatedBooks };
          });
        }
      } catch (error) {
        console.error("Failed to update verse:", error);
      }
    },
    approveChapter: async (projectId, book, chapter, approve) => {
      try {
        const response = await fetch(
          `${BASE_URL}/chapter/approve?project_id=${projectId}&book=${book}&chapter=${chapter}&approve=${approve}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${useAuthStore.getState().token}`,
            },
          }
        );

        if (response.ok) {
          
          useProjectDetailsStore.getState().setProject((prevProject) => {
            if (!prevProject) return null;
           
            const updatedBooks = prevProject.books.map((b) => {
              if (b.book === book) {
                const updatedChapters = b.chapters.map((ch) => {
                  if (ch.chapter === chapter) {
                    const newStatus = approve
                      ? "approved"
                      : ch.status === "approved"
                      ? "transcribed"
                      : ch.status;
                    return {
                      ...ch,
                      approved: approve,
                      status: newStatus,
                    };
                  }
                  return ch;
                });
                const updatedBookStatus = updatedChapters.every(
                  (ch) => ch.approved
                )
                  ? "approved"
                  : updatedChapters.every((ch) =>
                      ["transcribed", "approved"].includes(ch.status ?? "")
                    )
                  ? "transcribed"
                  : b.status || "notTranscribed";

                return {
                  ...b,
                  chapters: updatedChapters,
                  status: updatedBookStatus,
                  approved: updatedChapters.every((ch) => ch.approved),
                };
              }
              return b;
            });

            return {
              ...prevProject,
              books: updatedBooks,
            };
          });
        }
      } catch (error) {
        console.error("Failed to approve chapter:", error);
      }
    },

    convertToSpeech: async (project_id, bookName, chapter): Promise<string> => {
      try {
        const response = await fetch(
          `${BASE_URL}/project/chapter/${chapter.chapter_id}/tts`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${useAuthStore.getState().token}`,
            },
          }
        );
        const responseData = await response.json();

        if (response.ok) {
          await get().fetchChapterDetails(
            project_id,
            bookName,
            chapter.chapter
          );
          const chapterDetails = get().chapterVerses;

          const hasModifiedVerses = chapterDetails?.some(
            (verse) => verse.modified
          );
          if (!hasModifiedVerses) {
            console.log("No modified verses found.");
            throw new Error(
              responseData.message || "No modified verses found."
            );
          }

          const pollForTTSStatus = async (): Promise<string> => {
            return new Promise((resolve, reject) => {
              const checkStatus = async () => {
                try {
                  await get().fetchChapterDetails(
                    project_id,
                    bookName,
                    chapter.chapter
                  );
                  const chapterDetails = get().chapterVerses;
                  
                  if (chapterDetails) {
                    const modifiedVerses = chapterDetails.filter(
                      (verse) => verse.modified
                    );

                    const allModifiedConverted = modifiedVerses.every(
                      (verse) => verse.tts
                    );

                    if (allModifiedConverted) {
                      const verseWithTTSMsg = modifiedVerses.find(
                        (verse) => verse.tts_msg
                      );

                      if (verseWithTTSMsg && verseWithTTSMsg.tts_msg) {
                        resolve(verseWithTTSMsg.tts_msg);
                        return;
                      } else {
                        resolve(
                          "Text-to-speech conversion completed successfully."
                        );
                        return;
                      }
                    }
                  }
                  setTimeout(checkStatus, 10000);
                } catch (error) {
                  reject(
                    error instanceof Error
                      ? error.message
                      : "Unknown error occurred."
                  );
                }
              };

              checkStatus();
            });
          };

          const resultMsg = await pollForTTSStatus();
          return resultMsg;
        } else {
          throw new Error("Failed to initiate text-to-speech conversion.");
        }
      } catch (error) {
        console.error("Failed to convert chapter:", error);
        throw error;
      }
    },
  })
);
