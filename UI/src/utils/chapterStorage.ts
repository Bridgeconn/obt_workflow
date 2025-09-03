type ProjectId = number;
type BookName = string;
type ChapterNum = number;
type VerseId = number;
type VerseText = string;

const getStorageKey = (projectId: ProjectId, bookName: BookName, chapterNum: ChapterNum) =>
  `verse-${projectId}-${bookName}-${chapterNum}`;

export const getStoredVerses = (key: string): Record<VerseId, VerseText> =>
  JSON.parse(localStorage.getItem(key) || "{}");

export const saveVerseToLocalStorage = (
  projectId: ProjectId,
  bookName: BookName,
  chapterNum: ChapterNum,
  verseId: VerseId,
  text: VerseText
) => {
  const key = getStorageKey(projectId, bookName, chapterNum);
  const stored = getStoredVerses(key);
  stored[verseId] = text;
  localStorage.setItem(key, JSON.stringify(stored));
};

export const loadVersesFromLocalStorage = (
  projectId: ProjectId,
  bookName: BookName,
  chapterNum: ChapterNum
): Record<VerseId, VerseText> => {
  const key = getStorageKey(projectId, bookName, chapterNum);
  return getStoredVerses(key);
};

export const removeVerseFromLocalStorage = (
  projectId: ProjectId,
  bookName: BookName,
  chapterNum: ChapterNum,
  verseId: VerseId
) => {
  const key = getStorageKey(projectId, bookName, chapterNum);
  const stored = getStoredVerses(key);
  if (stored[verseId]) {
    delete stored[verseId];
    localStorage.setItem(key, JSON.stringify(stored));
  }
};

export const clearStoredVersesForChapter = (
  projectId: ProjectId,
  bookName: BookName,
  chapterNum: ChapterNum
) => {
  const key = getStorageKey(projectId, bookName, chapterNum);
  localStorage.removeItem(key);
};

export const hasPendingChanges = (projectId: ProjectId, bookName: BookName, chapterNum: ChapterNum) => {
  const key = getStorageKey(projectId, bookName, chapterNum);
  const stored = getStoredVerses(key);
  return Object.keys(stored).length > 0;
};
