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
  retryChapterTranscription: (
    projectId: number,
    bookId: number,
    chapterId: number,
    queryClient?: QueryClient
  ) => Promise<void>;
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
  chapterVerses: { [key: string]: Verse[] | null };
  clearChapterVerses: (key: string) => void;
  fetchChapterDetails: (
    projectId: number,
    book: string,
    chapter: number
  ) => void;
  updateVerseText: (
    verseId: number,
    newText: string,
    book: string,
    chapter: number,
    projectId?: number
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
            const sortedChapters = book.chapters.sort(
              (a, b) => a.chapter - b.chapter
            );
            // let totalChaptersProcessed = 0;
            // let hasErrors = false;

            const chapterStatuses = await Promise.all(
              sortedChapters.map(async (chapter) => {
                try {
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

                  const verses = chapterStatusData.data;
                  const allTranscribed =
                    verses.length > 0 && verses.every((verse) => verse.stt);
                  const modifiedVerses = verses.filter(
                    (verse) => verse.modified
                  );

                  const allModifiedConverted =
                    modifiedVerses.length > 0 &&
                    modifiedVerses.every((verse) => verse.tts);

                  // const allConverted = verses.every((verse) => verse.tts);
                  const completed = verses.filter((verse) => verse.stt).length;
                  const total = verses.length;
                  const isApproved = chapter.approved;

                  // Check for transcription errors in verses
                  // const hasTranscriptionError = verses.some(
                  //   (verse) =>
                  //     verse.stt_msg &&
                  //     verse.stt_msg !== "Transcription successful"
                  // );

                  return {
                    ...chapter,
                    status:
                      isApproved && allTranscribed
                        ? "approved"
                        : allModifiedConverted
                        ? "converted"
                        : allTranscribed
                        ? "transcribed"
                        : "notTranscribed",
                    progress: allTranscribed
                      ? ""
                      : `${completed} out of ${total} done`,
                    verses: verses,
                  };
                } catch (error) {
                  console.error("Failed to fetch chapter status:", error);
                  // totalChaptersProcessed++;
                  // hasErrors = true;
                  return {
                    ...chapter,
                    status: "error",
                    progress: "Failed to fetch chapter status",
                  };
                }
              })
            );

            const bookStatus = chapterStatuses.every(
              (ch) => ch.status === "approved"
            )
              ? "approved"
              : chapterStatuses.every((ch) =>
                  ["approved", "converted"].includes(ch.status)
                )
              ? "converted"
              : chapterStatuses.some((ch) => ch.status === "converting")
              ? "converting"
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
        let hasErrors = false;
        let totalChaptersProcessed = 0;

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
              const errorResp = await transcribeResponse.json();
              throw new Error(`${errorResp.detail}`);
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
                  const allTranscribed =
                    verses.length > 0 && verses.every((verse) => verse.stt);
                  const completed = verses.filter((verse) => verse.stt).length;
                  const total = verses.length;

                  const hasTranscriptionError = verses.some(
                    (verse) =>
                      verse.stt_msg &&
                      verse.stt_msg !== "Transcription successful"
                  );

                  set((state) => {
                    if (!state.project) return {};

                    const updatedBooks = state.project.books.map((b) => {
                      if (b.book_id === bookId) {
                        const updatedChapters = b.chapters.map((ch) => {
                          if (ch.chapter === chapter.chapter) {
                            return {
                              ...ch,
                              status: hasTranscriptionError
                                ? "error"
                                : allTranscribed
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
                          : "inProgress";

                        const currentChapterProgress =
                          updatedChapters.find(
                            (ch) => ch.chapter_id === chapter.chapter_id
                          )?.progress || "";

                        return {
                          ...b,
                          chapters: updatedChapters,
                          status: bookStatus,
                          progress: currentChapterProgress,
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

                  if (hasTranscriptionError || allTranscribed) {
                    totalChaptersProcessed++;
                    if (hasTranscriptionError) hasErrors = true;
                    console.log(
                      `Chapter processed: ${chapter.chapter}, Total processed: ${totalChaptersProcessed}`
                    );
                    resolve();
                  } else {
                    setTimeout(pollChapterStatus, 10000);
                  }
                } catch (error) {
                  totalChaptersProcessed++;
                  reject(error);
                }
              };

              pollChapterStatus();
            });
          } catch (error) {
            // Update state with error status
            hasErrors = true;
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
                    status: "error",
                    progress: "Transcription failed",
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
        set((state) => {
          if (!state.project) return {};

          const updatedBooks = state.project.books.map((b) => {
            if (b.book_id === bookId) {
              const bookStatus = hasErrors ? "error" : "transcribed";
              return { ...b, status: bookStatus };
            }
            return b;
          });
          return {
            project: { ...state.project, books: updatedBooks },
            isLoading: false,
          };
        });
        queryClient?.invalidateQueries({
          queryKey: ["project-details", currentProject.project_id],
        });
      } catch (error) {
        console.error("Error transcribing book:", error);
        set({ error: "Error transcribing book", isLoading: false });
        throw error;
      }
    },

    retryChapterTranscription: async (
      projectId: number,
      bookId: number,
      chapterId: number,
      queryClient?: QueryClient
    ) => {
      const currentProject = get().project;
      if (!currentProject) return;

      const token = useAuthStore.getState().token;
      const book = currentProject.books.find((b) => b.book_id === bookId);
      const chapter = book?.chapters.find((ch) => ch.chapter_id === chapterId);

      if (!book || !chapter) {
        throw new Error("Book or chapter not found");
      }

      try {
        const transcribeResponse = await fetch(
          `${BASE_URL}/project/chapter/stt?project_id=${projectId}&book_code=${book.book}&chapter_number=${chapter.chapter}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!transcribeResponse.ok) {
          const errRep = await transcribeResponse.json();
          throw new Error(
            errRep.detail || `Failed to transcribe chapter ${chapter.chapter}`
          );
        }

        await new Promise<void>((resolve, reject) => {
          const pollChapterStatus = async () => {
            try {
              const response = await fetch(
                `${BASE_URL}/project/${projectId}/${book.book}/${chapter.chapter}`,
                {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                }
              );

              if (!response.ok) {
                throw new Error(
                  `Failed to fetch chapter status: ${response.statusText}`
                );
              }

              const data: ChapterStatusResponse = await response.json();
              const verses = data.data;
              const allTranscribed = verses.every((verse) => verse.stt);
              const completed = verses.filter((verse) => verse.stt).length;
              const total = verses.length;

              const hasTranscriptionError = verses.some(
                (verse) =>
                  verse.stt_msg && verse.stt_msg !== "Transcription successful"
              );

              // Update progress
              set((state) => {
                if (!state.project) return {};

                const updatedBooks = state.project.books.map((b) => {
                  if (b.book_id === bookId) {
                    const updatedChapters = b.chapters.map((ch) => {
                      if (ch.chapter_id === chapterId) {
                        return {
                          ...ch,
                          status: hasTranscriptionError
                            ? "error"
                            : allTranscribed
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
                      : "inProgress";

                    const currentChapterProgress =
                      updatedChapters.find((ch) => ch.chapter_id === chapterId)
                        ?.progress || "";

                    if (hasTranscriptionError) {
                      return {
                        ...b,
                        chapters: updatedChapters,
                        status: "error",
                        progress: "Transcription failed",
                      };
                    }

                    return {
                      ...b,
                      chapters: updatedChapters,
                      status: bookStatus,
                      progress: currentChapterProgress,
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
              // Check if transcription is complete
              if (completed === total) {
                set((state) => {
                  if (!state.project) return {};

                  const updatedBooks = state.project.books.map((b) => {
                    if (b.book_id === bookId) {
                      const updatedChapters = b.chapters.map((ch) => {
                        if (ch.chapter_id === chapterId) {
                          return {
                            ...ch,
                            status: "transcribed",
                            progress: "",
                          };
                        }
                        return ch;
                      });

                      const allTranscribed = updatedChapters.every(
                        (ch) => ch.status === "transcribed"
                      );

                      return {
                        ...b,
                        chapters: updatedChapters,
                        status: allTranscribed ? "transcribed" : b.status,
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

                resolve();
              } else {
                setTimeout(pollChapterStatus, 10000);
              }
            } catch (error) {
              reject(error);
            }
          };

          pollChapterStatus();
        });
      } catch (error) {
        set((state) => {
          if (!state.project) return {};

          const updatedBooks = state.project.books.map((b) => {
            if (b.book_id === bookId) {
              const updatedChapters = b.chapters.map((ch) => {
                if (ch.chapter_id === chapterId) {
                  return {
                    ...ch,
                    status: "error",
                    progress: "API Error: Transcription failed",
                  };
                }
                return ch;
              });

              return {
                ...b,
                chapters: updatedChapters,
                status: "error",
                progress: "API Error: Transcription failed",
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
      set({ isLoading: false });
      queryClient?.invalidateQueries({
        queryKey: ["project-details", currentProject.project_id],
      });
    },

    archiveProject: async (projectId, archive) => {
      console.log("archive value", archive);
      set({ isLoading: true, error: null });

      try {
        const response = await fetch(
          `${BASE_URL}/projects/${projectId}/archive/?archive=${archive}`,
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

export const useChapterDetailsStore = create<ChapterDetailsState>((set) => ({
  chapterVerses: {},

  clearChapterVerses: (key: string) => {
    set((state) => ({
      chapterVerses: {
        ...state.chapterVerses,
        [key]: null,
      },
    }));
  },

  fetchChapterDetails: async (projectId, book, chapter) => {
    const key = `${projectId}-${book}-${chapter}`;
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
      set((state) => ({
        chapterVerses: {
          ...state.chapterVerses,
          [key]: data.data,
        },
      }));
    } catch (error) {
      console.error("Failed to fetch chapter details:", error);
    }
  },

  updateVerseText: async (verseId, newText, book, chapter, projectId) => {
    if (!projectId || !book || !chapter) return;
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
        await useChapterDetailsStore
          .getState()
          .fetchChapterDetails(projectId, book, chapter);
        set((state) => {
          const verses = state.chapterVerses[`${projectId}-${book}-${chapter}`];
          if (!verses) return state;

          return {
            chapterVerses: {
              ...state.chapterVerses,
              [`${projectId}-${book}-${chapter}`]: verses,
            },
          };
        });
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
      await useChapterDetailsStore
        .getState()
        .fetchChapterDetails(projectId, book, chapter);
      const chapterDetails =
        useChapterDetailsStore.getState().chapterVerses[
          `${projectId}-${book}-${chapter}`
        ];

      const checkTranscribed =
        chapterDetails && chapterDetails.every((verse) => verse.stt);

      const modifiedVerses =
        chapterDetails && chapterDetails.filter((verse) => verse.modified);

      const checkModifiedConverted =
        modifiedVerses &&
        modifiedVerses.length > 0 &&
        modifiedVerses.every((verse) => verse.tts);

      if (response.ok) {
        useProjectDetailsStore.getState().setProject((prevProject) => {
          if (!prevProject) return null;

          const updatedBooks = prevProject.books.map((b) => {
            if (b.book === book) {
              const updatedChapters = b.chapters.map((ch) => {
                if (ch.chapter === chapter) {
                  const newStatus = approve
                    ? "approved"
                    : checkModifiedConverted
                    ? "converted"
                    : checkTranscribed
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
                    ["converted", "approved"].includes(ch.status ?? "")
                  )
                ? "converted"
                : updatedChapters.every((ch) =>
                    ["transcribed", "converted", "approved"].includes(
                      ch.status ?? ""
                    )
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
    const token = useAuthStore.getState().token;
    const key = `${project_id}-${bookName}-${chapter.chapter}`;
    try {
      // check for chapter details
      const fetchAndUpdateChapter = async (): Promise<Verse[]> => {
        const response = await fetch(
          `${BASE_URL}/project/${project_id}/${bookName}/${chapter.chapter}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${useAuthStore.getState().token}`,
            },
          }
        );
        const data = await response.json();
        set((state) => ({
          chapterVerses: {
            ...state.chapterVerses,
            [key]: data.data,
          },
        }));
        return data.data;
      };

      const chapterDetails = await fetchAndUpdateChapter();

      const hasModifiedVerses = chapterDetails?.some(
        (verse) => verse.modified && !verse.tts
      );

      if (!hasModifiedVerses) {
        return "No modified verses found for conversion.";
      }

      // Initiate TTS conversion
      const response = await fetch(
        `${BASE_URL}/project/chapter/${chapter.chapter_id}/tts`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errResp = await response.json();
        if (errResp.detail) {
          return errResp.detail;
        }
      }

      // Poll for TTS status and update states
      const resultMessage = await new Promise<string>((resolve, reject) => {
        const pollTTSStatus = async () => {
          try {
            const details = await fetchAndUpdateChapter();

            if (!details) {
              resolve("Failed to fetch chapter details");
              return;
            }

            const modifiedVerses = details.filter((verse) => verse.modified);
            const completedModifiedVerses = modifiedVerses.filter(
              (verse) => verse.tts
            );

            // Update progress in project state
            useProjectDetailsStore.getState().setProject((prevProject) => {
              if (!prevProject) return prevProject;

              const updatedBooks = prevProject.books.map((b) => {
                if (b.book === bookName) {
                  const updatedChapters = b.chapters.map((ch) => {
                    if (ch.chapter_id === chapter.chapter_id) {
                      // Check for any TTS errors
                      const hasConversionError = modifiedVerses.some(
                        (verse) =>
                          verse.tts_msg &&
                          verse.tts_msg !== "Text-to-speech completed"
                      );

                      return {
                        ...ch,
                        status: hasConversionError
                          ? "error"
                          : completedModifiedVerses.length ===
                            modifiedVerses.length
                          ? "converted"
                          : "converting",
                        progress:
                          completedModifiedVerses.length ===
                          modifiedVerses.length
                            ? ""
                            : `Converting`,
                      };
                    }
                    return ch;
                  });

                  // Update book status based on chapters
                  const allConverted = updatedChapters.every(
                    (ch) => ch.status === "converted"
                  );
                  // const hasError = updatedChapters.some(
                  //   ch => ch.status === "error"
                  // );

                  return {
                    ...b,
                    chapters: updatedChapters,
                    status: allConverted ? "converted" : "converting",
                    progress: updatedChapters.find(
                      (ch) => ch.chapter_id === chapter.chapter_id
                    )?.progress,
                  };
                }
                return b;
              });

              return { ...prevProject, books: updatedBooks };
            });

            // Check for errors in modified verses
            const FailedVerse = modifiedVerses.find(
              (verse) =>
                verse.tts_msg && verse.tts_msg !== "Text-to-speech completed"
            );
            if (FailedVerse) {
              set((state) => {
                const verses = state.chapterVerses[key];
                if (!verses) return state;

                return {
                  chapterVerses: {
                    ...state.chapterVerses,
                    [key]: verses.map((verse) =>
                      verse.verse_id === FailedVerse.verse_id
                        ? { ...verse, tts: false, tts_msg: FailedVerse.tts_msg }
                        : verse
                    ),
                  },
                };
              });
              useProjectDetailsStore.getState().setProject((prevProject) => {
                if (!prevProject) return prevProject;

                const updatedBooks = prevProject.books.map((b) => {
                  if (b.book === bookName) {
                    const updatedChapters = b.chapters.map((ch) => {
                      if (ch.chapter_id === chapter.chapter_id) {
                        return {
                          ...ch,
                          status: "error",
                          progress: "Conversion failed",
                        };
                      }
                      return ch;
                    });
                    const checkTranscribed = updatedChapters.every((ch) =>
                      ["transcribed", "converted", "approved"].includes(
                        ch.status ?? ""
                      )
                    );

                    return {
                      ...b,
                      chapters: updatedChapters,
                      status: checkTranscribed
                        ? "transcribed"
                        : "notTranscribed",
                      progress: "",
                    };
                  }
                  return b;
                });

                return { ...prevProject, books: updatedBooks };
              });
              reject(FailedVerse.tts_msg || "Conversion failed");
              return;
            }

            // Check if all modified verses are converted
            if (completedModifiedVerses.length === modifiedVerses.length) {
              await useChapterDetailsStore
                .getState()
                .fetchChapterDetails(project_id, bookName, chapter.chapter);
              set((state) => {
                const verses = state.chapterVerses[key];
                if (!verses) return state;

                return {
                  chapterVerses: {
                    ...state.chapterVerses,
                    [key]: verses,
                  },
                };
              });
              useProjectDetailsStore.getState().setProject((prevProject) => {
                if (!prevProject) return prevProject;

                const updatedBooks = prevProject.books.map((b) => {
                  if (b.book === bookName) {
                    const updatedChapters = b.chapters.map((ch) => {
                      if (ch.chapter_id === chapter.chapter_id) {
                        return {
                          ...ch,
                          status: "converted",
                          progress: "",
                        };
                      }
                      return ch;
                    });

                    const bookStatus = updatedChapters.every(
                      (ch) => ch.status === "converted"
                    )
                      ? "converted"
                      : b.status;

                    return {
                      ...b,
                      status: bookStatus,
                      progress: "",
                      chapters: updatedChapters,
                    };
                  }
                  return b;
                });

                return { ...prevProject, books: updatedBooks };
              });
              resolve("Text-to-speech conversion completed successfully");
            } else {
              setTimeout(pollTTSStatus, 10000);
            }
          } catch (error) {
            resolve(
              error instanceof Error
                ? error.message
                : "Unknown error occurred during conversion"
            );
          }
        };

        pollTTSStatus();
      });

      return resultMessage;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Error during conversion process";
    }
  },
}));
