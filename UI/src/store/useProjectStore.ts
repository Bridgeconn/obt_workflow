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

interface TranscriptionProgress {
  projectId: number;
  bookId: number;
  chapterId: number;
  startTime: number;
  lastUpdated: number;
}

interface TranscriptionTrackingState {
  activeTranscriptions: { [key: string]: TranscriptionProgress };
  setTranscriptionInProgress: (
    projectId: number,
    bookId: number,
    chapterId: number
  ) => void;
  removeTranscriptionProgress: (
    projectId: number,
    bookId: number,
    chapterId: number
  ) => void;
  isTranscriptionInProgress: (
    projectId: number,
    bookId: number,
    chapterId: number
  ) => boolean;
  clearStaleTranscriptions: () => void;
  updateTranscriptionTimestamp: (
    projectId: number,
    bookId: number,
    chapterId: number
  ) => void;
}

const TRANSCRIPTION_STORAGE_KEY = "active_transcriptions";
const TRANSCRIPTION_TIMEOUT = 24 * 60 * 60 * 1000;
const ACTIVITY_TIMEOUT = 10 * 1000;

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

export const useTranscriptionTrackingStore = create<TranscriptionTrackingState>(
  (set, get) => ({
    activeTranscriptions: (() => {
      try {
        const stored = localStorage.getItem(TRANSCRIPTION_STORAGE_KEY);
        if (!stored) return {};

        // Clean up stale transcriptions on initial load
        const storedTranscriptions = JSON.parse(stored);
        const currentTime = Date.now();
        const cleanTranscriptions: { [key: string]: TranscriptionProgress } =
          {};

        Object.entries(storedTranscriptions).forEach(([key, value]) => {
          const transcription = value as TranscriptionProgress;
          // Check both overall timeout and activity timeout
          if (
            currentTime - transcription.startTime < TRANSCRIPTION_TIMEOUT &&
            currentTime - transcription.lastUpdated <= ACTIVITY_TIMEOUT
          ) {
            cleanTranscriptions[key] = transcription;
          }
        });

        localStorage.setItem(
          TRANSCRIPTION_STORAGE_KEY,
          JSON.stringify(cleanTranscriptions)
        );

        return cleanTranscriptions;
      } catch {
        return {};
      }
    })(),

    setTranscriptionInProgress: (projectId, bookId, chapterId) => {
      set((state) => {
        const key = `${projectId}-${bookId}-${chapterId}`;
        const currentTime = Date.now();
        const newTranscriptions = {
          ...state.activeTranscriptions,
          [key]: {
            projectId,
            bookId,
            chapterId,
            startTime: currentTime,
            lastUpdated: currentTime,
          },
        };

        localStorage.setItem(
          TRANSCRIPTION_STORAGE_KEY,
          JSON.stringify(newTranscriptions)
        );
        return { activeTranscriptions: newTranscriptions };
      });
    },

    updateTranscriptionTimestamp: (projectId, bookId, chapterId) => {
      set((state) => {
        const key = `${projectId}-${bookId}-${chapterId}`;
        const transcription = state.activeTranscriptions[key];

        if (!transcription) return state;

        const updatedTranscriptions = {
          ...state.activeTranscriptions,
          [key]: {
            ...transcription,
            lastUpdated: Date.now(),
          },
        };

        localStorage.setItem(
          TRANSCRIPTION_STORAGE_KEY,
          JSON.stringify(updatedTranscriptions)
        );

        return { activeTranscriptions: updatedTranscriptions };
      });
    },

    removeTranscriptionProgress: (projectId, bookId, chapterId) => {
      if (!chapterId) return;
      set((state) => {
        const key = `${projectId}-${bookId}-${chapterId}`;
        const currentTranscription = state.activeTranscriptions[key];

        if (!currentTranscription) {
          return state;
        }

        const remainingTranscriptions = { ...state.activeTranscriptions };
        delete remainingTranscriptions[key];

        // Update localStorage
        localStorage.setItem(
          TRANSCRIPTION_STORAGE_KEY,
          JSON.stringify(remainingTranscriptions)
        );

        return { activeTranscriptions: remainingTranscriptions };
      });
    },

    isTranscriptionInProgress: (projectId, bookId, chapterId?) => {
      if (!chapterId) return false;
      const key = `${projectId}-${bookId}-${chapterId}`;
      const transcription = get().activeTranscriptions[key];
      const currentTime = Date.now();

      if (!transcription) return false;

      // Check both the overall timeout and the activity timeout
      if (
        currentTime - transcription.startTime > TRANSCRIPTION_TIMEOUT ||
        currentTime - transcription.lastUpdated > ACTIVITY_TIMEOUT
      ) {
        get().removeTranscriptionProgress(projectId, bookId, chapterId);
        return false;
      }

      return true;
    },

    clearStaleTranscriptions: () => {
      set((state) => {
        const currentTime = Date.now();
        const activeTranscriptions = { ...state.activeTranscriptions };
        let hasChanges = false;

        Object.entries(activeTranscriptions).forEach(([key, value]) => {
          if (
            currentTime - value.startTime > TRANSCRIPTION_TIMEOUT ||
            currentTime - value.lastUpdated > ACTIVITY_TIMEOUT
          ) {
            delete activeTranscriptions[key];
            hasChanges = true;
          }
        });

        if (hasChanges) {
          localStorage.setItem(
            TRANSCRIPTION_STORAGE_KEY,
            JSON.stringify(activeTranscriptions)
          );
          return { activeTranscriptions };
        }

        return state;
      });
    },
  })
);

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

        useTranscriptionTrackingStore.getState().clearStaleTranscriptions();

        // Fetch detailed status for each book and chapter
        const updatedBooks = await Promise.all(
          data.project.books.map(async (book: Book) => {
            if (!book.chapters || book.chapters.length === 0) {
              return {
                ...book,
                chapters: [],
              };
            }
            const sortedChapters = book.chapters.sort(
              (a, b) => a.chapter - b.chapter
            );

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
                  
                  const isApproved = chapter.approved;

                  const isInProgress = useTranscriptionTrackingStore
                    .getState()
                    .isTranscriptionInProgress(
                      projectId,
                      book.book_id,
                      chapter.chapter_id
                    );

                  return {
                    ...chapter,
                    status:
                      isApproved && allTranscribed
                        ? "approved"
                        : allModifiedConverted
                        ? "converted"
                        : allTranscribed
                        ? "transcribed"
                        : isInProgress
                        ? "inProgress"
                        : "notTranscribed",
                    progress: allTranscribed
                      ? ""
                      : isInProgress && "Processing",
                    verses: verses,
                  };
                } catch (error) {
                  console.error("Failed to fetch chapter status:", error);
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
          // Set progress for current chapter
          useTranscriptionTrackingStore
            .getState()
            .setTranscriptionInProgress(
              currentProject.project_id,
              bookId,
              chapter.chapter_id
            );

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
                  // Update timestamp for current chapter
                  useTranscriptionTrackingStore
                    .getState()
                    .updateTranscriptionTimestamp(
                      currentProject.project_id,
                      bookId,
                      chapter.chapter_id
                    );

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

                  const hasTranscriptionError = verses.some(
                    (verse) =>
                      verse.stt_msg &&
                      verse.stt_msg !== "Transcription successful"
                  );

                  set((state) => {
                    if (!state.project) return {};

                    const updatedBooks = state.project.books.map((b) => {
                      if (b.book_id === bookId && b?.chapters.length) {
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
                                : "Processing",
                            };
                          }
                          return ch;
                        });

                          const bookStatus = !updatedChapters.length
                          ? b.status
                          : updatedChapters.every((ch) => ch.status === "transcribed"
                        )
                          ? "transcribed"
                          : "inProgress";

                        const currentChapterProgress = updatedChapters.find(
                            (ch) => ch.chapter_id === chapter.chapter_id
                          )?.progress || "Calculating";

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
                    // Remove progress tracking for completed chapter
                    useTranscriptionTrackingStore
                      .getState()
                      .removeTranscriptionProgress(
                        currentProject.project_id,
                        bookId,
                        chapter.chapter_id
                      );
                    resolve();
                  } else {
                    setTimeout(pollChapterStatus,5000);
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
                if (b.book_id === bookId && b?.chapters.length) {
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
            // Remove progress tracking for failed chapter
            useTranscriptionTrackingStore
              .getState()
              .removeTranscriptionProgress(
                currentProject.project_id,
                bookId,
                chapter.chapter_id
              );

            throw error;
          }
        }
        set((state) => {
          if (!state.project) return {};

          const updatedBooks = state.project.books.map((b) => {
            if (b.book_id === bookId && b?.chapters.length) {
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
            if (b.book === book && b.chapters?.length) {
              const updatedChapters = b.chapters.map((ch) => {
                if (ch.chapter === chapter) {
                  const newStatus =
                    ch.status === "approved" ? "transcribed" : ch.status;
                  return { ...ch, status: newStatus, approved: false };
                }
                return ch;
              });
              const updatedBookStatus = !updatedChapters.length
              ? b.status || "notTranscribed"
              : updatedChapters.every((ch) => ch.status === "approved")
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
            if (b.book === book && b.chapters?.length) {
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

                const updatedBookStatus = !updatedChapters.length
                  ? b.status || "notTranscribed"
                  : updatedChapters.every(
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
                approved: updatedChapters.length > 0 && updatedChapters.every((ch) => ch.approved),
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
                if (b.book === bookName && b.chapters?.length) {
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
                          ? "conversionError"
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
                  const allConverted =  updatedChapters.length > 0 && updatedChapters.every(
                    (ch) => ["converted", "approved"].includes(ch?.status || "")
                  );
                  // const hasError = updatedChapters.some(
                  //   ch => ch.status === "error"
                  // );

                  const isConverting = updatedChapters.length > 0 && updatedChapters.some(
                    (ch) => ch.status === "converting"
                  )

                  return {
                    ...b,
                    chapters: updatedChapters,
                    status: allConverted ? "converted" : isConverting ? "converting" : b.status,
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
                  if (b.book === bookName && b?.chapters.length) {
                    const updatedChapters = b.chapters.map((ch) => {
                      if (ch.chapter_id === chapter.chapter_id) {
                        return {
                          ...ch,
                          status: "conversionError",
                          progress: "Conversion failed",
                        };
                      }
                      return ch;
                    });
                    const checkTranscribed = updatedChapters.length > 0 && updatedChapters.some((ch) =>
                      ["transcribed", "converted", "approved"].includes(
                        ch.status ?? ""
                      )
                    );

                    const checkNotTranscribed = updatedChapters.length > 0 && updatedChapters.some((ch) =>
                      ["notTranscribed"].includes(ch.status ?? "")
                    );

                    return {
                      ...b,
                      chapters: updatedChapters,
                      status: checkNotTranscribed ? "notTranscribed" : checkTranscribed ? "transcribed" : "error",
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

              await useProjectDetailsStore.getState().fetchProjectDetails(
                project_id
              )
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
                  if (b.book === bookName && b.chapters?.length) {
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

                    const isConverting = updatedChapters.length > 0 && updatedChapters.some(
                      (ch) => ch.status === "converting"
                    )

                    const isConverted = updatedChapters.length > 0 && updatedChapters.every(
                      (ch) => ["converted", "approved"].includes(ch.status ?? "") && !isConverting
                    )

                    const bookStatus = !updatedChapters.length
                    ? b.status
                    : isConverted
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
              setTimeout(pollTTSStatus, 5000);
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
        : typeof error === "string"
        ? error
        : "Error during conversion process";
    }
  },
}));
