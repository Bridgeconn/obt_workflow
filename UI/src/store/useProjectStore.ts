import { create } from 'zustand';
import { QueryClient } from '@tanstack/react-query';
import useAuthStore from './useAuthStore';

interface ProjectDetailsState {
  project: Project | null;
  isLoading: boolean;
  error: string | null;
  setProject: (updater: (project: Project | null) => Project | null) => void;
  fetchProjectDetails: (projectId: number) => void;
  transcribeBook: (bookId: number, queryClient?: QueryClient) => Promise<void>;
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
  fetchChapterDetails: (projectId: number, book: string, chapter: number) => void;
  updateVerseText: (verseId: number, newText: string) => void;
  approveChapter: (projectId: number, book: string, chapter: number, approve: boolean) => Promise<void>;
}

export const useProjectDetailsStore = create<ProjectDetailsState>((set, get) => ({
  project: null,
  scriptLanguage: '',
  audioLanguage: '',
  isLoading: false,
  error: null,
  setProject: (updater) =>
    set((state) => ({
      project: typeof updater === "function" ? updater(state.project) : updater,
    })),
  fetchProjectDetails: async (projectId: number) => {
    set({ isLoading: true, error: null });
    const token = useAuthStore.getState().token;
    try {
      // Fetch initial project details
      const response = await fetch(`http://localhost:8000/project/details?project_id=${projectId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const data = await response.json();

      // Fetch detailed status for each book and chapter
      const updatedBooks = await Promise.all(
        data.project.books.map(async (book: Book) => {
          const chapterStatuses = await Promise.all(
            book.chapters.map(async (chapter) => {
              const chapterStatusResponse = await fetch(
                `http://localhost:8000/project/${data.project.project_id}/${book.book}/${chapter.chapter}`,
                {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                }
              );
              const chapterStatusData: ChapterStatusResponse = await chapterStatusResponse.json();
              
              // Determine chapter status
              const verses = chapterStatusData.data;
              const allTranscribed = verses.every((verse) => verse.stt);
              const completed = verses.filter((verse) => verse.stt).length;
              const total = verses.length;
              const isApproved = chapter.approved

              return {
                ...chapter,
                status: isApproved && allTranscribed ? "approved" : (allTranscribed ? 'transcribed' : 'notTranscribed'),
                progress: allTranscribed ? '' : `${completed} out of ${total} done`,
                verses: verses
              };
            })
          );

          // Determine book-level status
          const bookStatus = chapterStatuses.every(ch => ch.status === "approved")
            ? "approved"
            : chapterStatuses.every(ch => ch.status === "transcribed")
            ? "transcribed"
            : chapterStatuses.some(ch => ch.status === "inProgress")
            ? "inProgress"
            : "notTranscribed";


          return {
            ...book,
            chapters: chapterStatuses,
            status: bookStatus,
            progress: bookStatus === 'inProgress' 
              ? chapterStatuses.find(ch => ch.status === 'inProgress')?.progress 
              : ''
          };
        })
      );

      set({ 
        project: { 
          ...data.project, 
          books: updatedBooks 
        }, 
        isLoading: false 
      });
    } catch (error) {
      console.error('Error fetching project details:', error);
      set({ error: 'Error fetching project details', isLoading: false });
    }
  },

  transcribeBook: async (bookId: number, queryClient?: QueryClient) => {
    const token = useAuthStore.getState().token;
    const currentProject = get().project;
    
    if (!currentProject) return;

    set({ isLoading: true, error: null });

    try {
      const book = currentProject.books.find((b) => b.book_id === bookId);
      if (!book) throw new Error('Book not found');

      // Sequential chapter transcription
      for (const chapter of book.chapters) {
        // Start transcription for each chapter
        await fetch(
          `http://localhost:8000/transcribe?project_id=${currentProject.project_id}&book_code=${book.book}&chapter_number=${chapter.chapter}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        // Wait for chapter to complete transcription
        await new Promise<void>((resolve, reject) => {
          const pollChapterStatus = async () => {
            try {
              const response = await fetch(
                `http://localhost:8000/project/${currentProject.project_id}/${book.book}/${chapter.chapter}`,
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

              // Update project state with current transcription status
              set((state) => {
                if (!state.project) return {};

                const updatedBooks = state.project.books.map((b) => {
                  if (b.book_id === bookId) {
                    const updatedChapters = b.chapters.map((ch) => {
                      if (ch.chapter === chapter.chapter) {
                        return {
                          ...ch,
                          status: allTranscribed ? 'transcribed' : 'inProgress',
                          progress: allTranscribed ? '' : `${completed} out of ${total} done`,
                        };
                      }
                      return ch;
                    });

                    // Recalculate book status
                    const bookStatus = updatedChapters.every(ch => ch.status === 'transcribed')
                      ? 'transcribed'
                      : updatedChapters.some(ch => ch.status === 'inProgress')
                      ? 'inProgress'
                      : 'notTranscribed';

                    return {
                      ...b,
                      chapters: updatedChapters,
                      status: bookStatus,
                      progress: bookStatus === 'inProgress'
                        ? updatedChapters.find(ch => ch.status === 'inProgress')?.progress
                        : ''
                    };
                  }
                  return b;
                });

                return {
                  project: {
                    ...state.project,
                    books: updatedBooks
                  }
                };
              });

              if (allTranscribed) {
                resolve();
              } else {
                setTimeout(pollChapterStatus, 10000); // 10 seconds
              }
            } catch (error) {
              reject(error);
            }
          };

          pollChapterStatus();
        });
      }

      set({ isLoading: false });
      queryClient?.invalidateQueries({ 
        queryKey: ['project-details', currentProject.project_id] 
      });

    } catch (error) {
      console.error('Error transcribing book:', error);
      set({ error: 'Error transcribing book', isLoading: false });
    }
  },
}));

export const useChapterDetailsStore = create<ChapterDetailsState>((set) => ({
  chapterVerses: null,

  fetchChapterDetails: async (projectId, book, chapter) => {
    try {
      const response = await fetch(
        `http://localhost:8000/project/${projectId}/${book}/${chapter}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${useAuthStore.getState().token}` },

        }
      );
      const data = await response.json();
      set({ chapterVerses: data.data });
    } catch (error) {
      console.error("Failed to fetch chapter details:", error);
    }
  },

  updateVerseText: async (verseId, newText) => {
    try {
      const response = await fetch(
        `http://localhost:8000/project/verse/${verseId}?verse_text=${newText}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${useAuthStore.getState().token}` },
        }
      );
      if (response.ok) {
        // Update local state
        set((state) => ({
          chapterVerses: state.chapterVerses?.map((verse) =>
            verse.verse_id === verseId
              ? { ...verse, text: newText, tts: false }
              : verse
          ),
        }));
      }
    } catch (error) {
      console.error("Failed to update verse:", error);
    }
  },
  approveChapter: async (projectId, book, chapter, approve) => {
    try {
      const response = await fetch(
        `http://localhost:8000/chapter/approve?project_id=${projectId}&book=${book}&chapter=${chapter}&approve=${approve}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${useAuthStore.getState().token}` },
        }
      );
  
      if (response.ok) {
        // Update the project state in useProjectDetailsStore
        useProjectDetailsStore.getState().setProject((prevProject) => {
          if (!prevProject) return null;
  
          // Modify the books and chapters based on approval
          const updatedBooks = prevProject.books.map((b) => {
            if (b.book === book) {
              const updatedChapters = b.chapters.map((ch) => {
                if (ch.chapter === chapter) {
                  return {
                    ...ch,
                    approved: approve,
                    status: approve ? "approved" : ch.status,
                  };
                }
                return ch;
              });
  
              const updatedBookStatus = updatedChapters.every(ch => ch.approved)
                ? "approved"
                : b.status;
  
              return {
                ...b,
                chapters: updatedChapters,
                status: updatedBookStatus,
              };
            }
            return b;
          });
  
          // Ensure the full project structure is maintained and returned
          return {
            ...prevProject,
            books: updatedBooks,
          };
        });
      }
    } catch (error) {
      console.error("Failed to approve chapter:", error);
    }
  }
  
  
}));