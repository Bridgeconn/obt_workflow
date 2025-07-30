import { create } from "zustand";
import { QueryClient } from "@tanstack/react-query";
import useAuthStore from "./useAuthStore";

const BASE_URL = import.meta.env.VITE_BASE_URL;

declare global {
  interface Window {
    activePollingTimeouts: number[];
  }
}

if (!window.activePollingTimeouts) {
  window.activePollingTimeouts = [];
}

interface ProjectDetailsState {
  project: Project | null;
  isLoading: boolean;
  error: string | null;
  setProject: (updater: (project: Project | null) => Project | null) => void;
  fetchProjectDetails: (projectId: number) => void;
  clearProjectState: () => void;
  transcribeBook: (
    bookId: number,
    selectedChapters: any,
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
  clear: () => void;
}

const TRANSCRIPTION_STORAGE_KEY = "active_transcriptions";
const TRANSCRIPTION_TIMEOUT = 24 * 60 * 60 * 1000;
const ACTIVITY_TIMEOUT = 10 * 1000;

interface ChapterStatusResponse {
  detail: string;
  chapter_info: {
    project_id: number;
    book: string;
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
  ) => Promise<Verse[] | null>;
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

// Utility function to calculate book status based on chapters
const calculateBookStatus = (chapters: Chapter[]): string => {
  console.log("chapters for book status", chapters);
  if (chapters.every((ch) => ch.status === "approved" || ch.approved))
    return "approved";
  if (
    chapters.every((ch) => ["approved", "converted"].includes(ch.status || ""))
  )
    return "converted";
  if (chapters.some((ch) => ch.status === "converting")) return "converting";
  if (
    chapters.some(
      (ch) => ch.status === "inProgress" || ch.progress === "processing"
    )
  )
    return "inProgress";
  if (
    chapters.every((ch) =>
      ["transcribed", "approved", "converted", "modified"].includes(
        ch.status || ""
      )
    )
  )
    return "transcribed";
  if (
    chapters.some((ch) =>
      ["error", "transcriptionError", "conversionError"].includes(
        ch.status || ""
      )
    )
  ) {
    if (chapters.length === 1) {
      const progress = chapters[0]?.progress || "";
      const status = chapters[0]?.status || "";
      if (
        progress.includes("Conversion failed") ||
        status === "conversionError"
      )
        return "transcribed";
      if (
        progress === "Transcription failed" ||
        status === "transcriptionError"
      )
        return "error";
    }
    if (
      chapters.every(
        (ch) =>
          [
            "notTranscribed",
            "transcribed",
            "approved",
            "modified",
            "converted",
            "conversionError",
            "transcriptionError",
          ].includes(ch.status || "") && ch.progress === "Transcription failed"
      )
    )
      return "transcriptionError";
    if (
      chapters.every(
        (ch) =>
          [
            "transcribed",
            "approved",
            "modified",
            "converted",
            "transcriptionError",
          ].includes(ch.status || "") && ch.progress === ""
      )
    )
      return "error";
    if (
      chapters.every((ch) =>
        [
          "transcribed",
          "approved",
          "modified",
          "converted",
          "conversionError",
        ].includes(ch.status || "")
      )
    )
      return "transcribed";
    if (
      chapters.every(
        (ch) =>
          [
            "transcribed",
            "approved",
            "modified",
            "converted",
            "conversionError",
            "transcriptionError",
          ].includes(ch.status || "") &&
          ["Conversion failed", ""].includes(ch.progress || "")
      )
    )
      return "conversionError";
    if (chapters.some((ch) => ch.progress === "Failed to fetch chapter status"))
      return "apiError";

    return "error";
  }
  return "notTranscribed";
};

// Utility function to update the chapter status
const updateChapterStatus = (
  verses: Verse[],
  isApproved: boolean,
  isInProgress: boolean = false
): string => {
  if (isApproved) return "approved";

  const allTranscribed =
    verses.length > 0 && verses.every((verse) => verse.stt);
  const modifiedVerses = verses.filter((verse) => verse.modified);
  const allModifiedConverted =
    modifiedVerses.length > 0 &&
    allTranscribed &&
    modifiedVerses.every((verse) => verse.tts && verse.stt);
  const checkChapterOnlyModified =
    modifiedVerses.length > 0 && allTranscribed && !allModifiedConverted;
  if (allModifiedConverted) return "converted";
  if (checkChapterOnlyModified) return "modified";
  if (allTranscribed) return "transcribed";
  if (isInProgress) return "inProgress";
  return "notTranscribed";
};

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
    clear: () => set({ activeTranscriptions: {} }),
  })
);

export const useProjectDetailsStore = create<ProjectDetailsState>(
  (set, get) => ({
    project: null,
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
        if (!response.ok) {
          throw new Error(data.detail || "Failed to fetch project details");
        }

        useTranscriptionTrackingStore.getState().clearStaleTranscriptions();
        const projectData = data.projects[0];
        // Fetch detailed status for each book and chapter
        const updatedBooks = await Promise.all(
          projectData.books.map(async (book: Book) => {
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
                    `${BASE_URL}/project/${projectData.project_id}/${book.book}/${chapter.chapter}`,
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

                  if (!chapterStatusResponse.ok) {
                    throw new Error(
                      chapterStatusData.detail ||
                        "Failed to fetch chapter status"
                    );
                  }

                  const verses = chapterStatusData.data;

                  const isInProgress = useTranscriptionTrackingStore
                    .getState()
                    .isTranscriptionInProgress(
                      projectId,
                      book.book_id,
                      chapter.chapter_id
                    );

                  const status = updateChapterStatus(
                    verses,
                    chapter.approved,
                    isInProgress
                  );

                  const completed = verses.filter((verse) => verse.stt).length;
                  const total = verses.length;

                  return {
                    ...chapter,
                    status,
                    progress:
                      status === "inProgress"
                        ? `${completed} out of ${total} done`
                        : "",
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

            const bookStatus = calculateBookStatus(chapterStatuses);
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
            ...projectData,
            books: updatedBooks,
          },
          isLoading: false,
        });
      } catch (error) {
        console.error("Error fetching project details:", error);
        set({ error: "Error fetching project details", isLoading: false });
        throw error;
      }
    },

    clearProjectState: () => set({ project: null }),

    transcribeBook: async (
      bookId: number,
      selectedChapters: Chapter[],
      queryClient?: QueryClient
    ) => {
      const token = useAuthStore.getState().token;
      const currentProject = get().project;

      if (!currentProject) return;

      set({ isLoading: true, error: null });

      try {
        const book = currentProject.books.find((b) => b.book_id === bookId);
        if (!book) throw new Error("Book not found");
        let hasErrors = false;
        let totalChaptersProcessed = 0;

        const updateChapterStatusInState = (
          chapterId: number,
          status: string,
          progress: string = ""
        ) => {
          set((state) => {
            if (!state.project) return {};

            const updatedBooks = state.project.books.map((b) => {
              if (b.book_id === bookId && b?.chapters.length) {
                const updatedChapters = b.chapters.map((ch) => {
                  if (ch.chapter_id === chapterId) {
                    const isApproved = ch.approved;
                    return {
                      ...ch,
                      status: isApproved ? "approved" : status,
                      progress,
                    };
                  }
                  return ch;
                });

                return {
                  ...b,
                  chapters: updatedChapters,
                  status: calculateBookStatus(updatedChapters),
                  progress:
                    updatedChapters.find((ch) => ch.chapter_id === chapterId)
                      ?.progress || "processing",
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
        };

        // Sequential chapter transcription
        // for (const chapter of book.chapters) {  --> removing for now for adding chapter wise convertion
        for (const chapter of selectedChapters) {
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
              `${BASE_URL}/project/chapter/stt?project_id=${currentProject.project_id}&book=${book.book}&chapter=${chapter.chapter}`,
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
              updateChapterStatusInState(
                chapter.chapter_id,
                "transcriptionError",
                "Transcription failed"
              );
              throw new Error(`${errorResp.detail}`);
            }
            await new Promise<void>((resolve, reject) => {
              const pollChapterStatus = async () => {
                if (!useAuthStore.getState().token) {
                  console.log("User is logged out. Aborting polling.");
                  reject(new Error("User logged out during polling"));
                  return;
                }
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
                  const completed = verses.filter((verse) => verse.stt).length;
                  const total = verses.length;
                  const hasTranscriptionError = verses.some(
                    (verse) =>
                      verse.stt_msg &&
                      verse.stt_msg !== "Transcription successful"
                  );

                  if (hasTranscriptionError || allTranscribed) {
                    totalChaptersProcessed++;
                    if (hasTranscriptionError) {
                      hasErrors = true;
                      updateChapterStatusInState(
                        chapter.chapter_id,
                        "transcriptionError",
                        "Transcription failed"
                      );
                    } else {
                      updateChapterStatusInState(
                        chapter.chapter_id,
                        "transcribed",
                        ""
                      );
                    }

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
                    updateChapterStatusInState(
                      chapter.chapter_id,
                      "inProgress",
                      `${completed} out of ${total} done`
                    );
                    const timeoutId = setTimeout(
                      pollChapterStatus,
                      5000
                    ) as unknown as number;
                    window.activePollingTimeouts =
                      window.activePollingTimeouts || [];
                    window.activePollingTimeouts.push(timeoutId);
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
            updateChapterStatusInState(
              chapter.chapter_id,
              "transcriptionError",
              "Transcription failed"
            );
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
              const bookStatus = hasErrors
                ? "error"
                : calculateBookStatus(b.chapters);
              return { ...b, status: bookStatus, progress: "" };
            }
            return b;
          });
          return {
            project: { ...state.project, books: updatedBooks },
            isLoading: false,
          };
        });
        if (queryClient) {
          queryClient?.invalidateQueries({
            queryKey: ["project-details", currentProject.project_id],
          });
        }
      } catch (error) {
        console.error("Error transcribing book:", error);
        set({ error: "Error transcribing book", isLoading: false });
        throw error;
      }
      sessionStorage.removeItem("ConvertingBook");
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
      if (!response.ok) {
        throw new Error(data?.detail || "Failed to fetch chapter details");
      }
      set((state) => ({
        chapterVerses: {
          ...state.chapterVerses,
          [key]: data.data,
        },
      }));
      return data.data;
    } catch (error) {
      console.error("Failed to fetch chapter details:", error);
      throw error;
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
        useProjectDetailsStore.getState().setProject((prevProject) => {
          if (!prevProject) return prevProject;
          const updatedBooks = prevProject.books.map((b) => {
            if (b.book === book && b.chapters?.length) {
              const updatedChapters = b.chapters.map((ch) => {
                if (ch.chapter === chapter) {
                  // const newStatus =
                  //   ch.status === "approved" ? "transcribed" : ch.status;
                  return { ...ch, status: "modified", approved: false };
                }
                return ch;
              });
              const updatedBookStatus = calculateBookStatus(updatedChapters);

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
      } else {
        throw new Error("Failed to update verse");
      }
    } catch (error) {
      console.error("Failed to update verse:", error);
      throw error;
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
      const chapterDetails = await useChapterDetailsStore
        .getState()
        .fetchChapterDetails(projectId, book, chapter);

      if (response.ok && chapterDetails && chapterDetails.length > 0) {
        const checkTranscribed = chapterDetails.every((verse) => verse.stt);
        const modifiedVerses = chapterDetails.filter((verse) => verse.modified);
        const checkModifiedConverted =
          modifiedVerses.length > 0 &&
          modifiedVerses.every((verse) => verse.tts);
        const checkChapterOnlyModified =
          modifiedVerses.length > 0 && !checkModifiedConverted;
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
                    : checkChapterOnlyModified
                    ? "modified"
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

              const updatedBookStatus = calculateBookStatus(updatedChapters);

              return {
                ...b,
                chapters: updatedChapters,
                status: updatedBookStatus,
                approved:
                  updatedChapters.length > 0 &&
                  updatedChapters.every((ch) => ch.approved),
              };
            }
            return b;
          });

          return {
            ...prevProject,
            books: updatedBooks,
          };
        });
      } else {
        const errorResp = await response.json();
        throw new Error(errorResp.detail || "Failed to approve chapter");
      }
    } catch (error) {
      console.error("Failed to approve chapter:", error);
      throw error;
    }
  },
  convertToSpeech: async (project_id, bookName, chapter): Promise<string> => {
    const token = useAuthStore.getState().token;
    const key = `${project_id}-${bookName}-${chapter.chapter}`;
    const updateChapterStatus = (
      status: string,
      progress: string = "",
      details?: Verse[]
    ) => {
      useProjectDetailsStore.getState().setProject((prevProject) => {
        if (!prevProject) return prevProject;

        const updatedBooks = prevProject.books.map((b) => {
          if (b.book === bookName && b.chapters?.length) {
            const updatedChapters = b.chapters.map((ch) => {
              if (ch.chapter_id === chapter.chapter_id) {
                return {
                  ...ch,
                  status,
                  progress,
                };
              }
              return ch;
            });

            // Calculate book status
            const updatedBookStatus = calculateBookStatus(updatedChapters);
            return {
              ...b,
              chapters: updatedChapters,
              status: updatedBookStatus,
              progress:
                updatedChapters.find(
                  (ch) => ch.chapter_id === chapter.chapter_id
                )?.progress || "",
            };
          }
          return b;
        });

        return { ...prevProject, books: updatedBooks };
      });

      // Update chapter verses if details provided
      if (details) {
        set((state) => ({
          chapterVerses: {
            ...state.chapterVerses,
            [key]: details,
          },
        }));
      }
    };
    try {
      // check for chapter details
      const fetchAndUpdateChapter = async (): Promise<Verse[] | null> => {
        return (
          useChapterDetailsStore
            .getState()
            .fetchChapterDetails(project_id, bookName, chapter.chapter) || []
        );
      };

      const chapterDetails = await fetchAndUpdateChapter();

      const hasModifiedVerses = chapterDetails?.some(
        (verse) => verse.modified && !verse.tts
      );

      if (!hasModifiedVerses) {
        return "No modified verses found for conversion.";
      }
      updateChapterStatus("converting", "Converting");
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
          updateChapterStatus("conversionError", "Conversion failed");
          return errResp.detail;
        }
      }

      // Poll for TTS status and update states
      const resultMessage = await new Promise<string>((resolve, reject) => {
        const pollTTSStatus = async () => {
          try {
            const details = await fetchAndUpdateChapter();

            if (!details || details.length === 0) {
              updateChapterStatus("conversionError", "Conversion failed");
              reject("Failed to fetch chapter details");
              return;
            }

            const modifiedVerses = details.filter((verse) => verse.modified);
            const completedModifiedVerses = modifiedVerses.filter(
              (verse) => verse.tts
            );

            //check for any TTS errors
            const failedVerse = modifiedVerses.find(
              (verse) =>
                verse.tts_msg && verse.tts_msg !== "Text-to-speech completed"
            );

            if (failedVerse) {
              updateChapterStatus(
                "conversionError",
                "Conversion failed",
                details
              );
              reject(failedVerse.tts_msg || "Conversion failed");
              return;
            }

            if (completedModifiedVerses.length === modifiedVerses.length) {
              await useChapterDetailsStore
                .getState()
                .fetchChapterDetails(project_id, bookName, chapter.chapter);

              updateChapterStatus("converted", "", details);

              resolve("Text-to-speech conversion completed successfully");
            } else {
              //Still converting
              updateChapterStatus("converting", "Converting", details);
              const timeoutId = setTimeout(
                pollTTSStatus,
                5000
              ) as unknown as number;
              window.activePollingTimeouts.push(timeoutId);
            }
          } catch (error) {
            updateChapterStatus("conversionError", "Conversion failed");
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
      updateChapterStatus("conversionError", "Conversion failed");
      return error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : "Error during conversion process";
    }
  },
}));
