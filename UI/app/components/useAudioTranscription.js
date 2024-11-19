import { useState, useEffect, useCallback } from "react";
import Swal from "sweetalert2";

import api from "../store/apiConfig";
import { AudioCodecDetector } from "../utils/audioCodecDetector";

const useAudioTranscription = ({
  projectInstance,
  selectedBook,
  setBooks,
  bookData,
  selectedLanguage,
  setChapterStatuses,
  setProcessing,
  extractChapterVerse,
}) => {
  const [currentChapter, setCurrentChapter] = useState(null);
  const [currentVerse, setCurrentVerse] = useState(null);

  useEffect(() => {
    if (currentVerse && currentChapter) {
      console.log(
        `updating to the next verse in chapter ${currentChapter.chapterNumber}`
      );
    }
  }, [currentVerse, currentChapter]);

  // Function to handle transcription for a verse
  const handleTranscribe = useCallback(
    async (verse) => {
      if (!verse) return;
      setProcessing(true);
      let bookChapterKey;
      if (currentChapter) {
        bookChapterKey = `${selectedBook}-${currentChapter?.chapterNumber}`;
        setChapterStatuses((prev) => ({
          ...prev,
          [bookChapterKey]: "inProgress",
        }));
      }
      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.name === selectedBook
            ? {
                ...book,
                status: "inProgress",
                inProgress: [
                  ...new Set([
                    ...book.inProgress,
                    currentChapter?.chapterNumber,
                  ]),
                ],
              }
            : book
        )
      );

      try {
        const formData = new FormData();
        const codec = await AudioCodecDetector.detectCodec(verse.file);
        let file;
        let targetFormat;
        if (codec === "Opus") {
          const { convertAudioFile } = await import("../utils/audioConversion");
          if (verse.audioFileName.endsWith(".mp3")) {
            targetFormat = "mp3";
          } else if (verse.audioFileName.endsWith(".wav")) {
            targetFormat = "wav";
          }
          const audioBlob = await convertAudioFile(
            verse.file,
            verse.audioFileName,
            targetFormat
          );
          file = new File([audioBlob], verse.audioFileName, {
            type: `audio/${targetFormat}`,
          });
        } else {
          file = new File([verse.file], verse.audioFileName, {
            type: `audio/${targetFormat}`,
          });
        }
        formData.append("files", file);
        formData.append("transcription_language", selectedLanguage);

        const response = await api.post(
          "/ai/model/audio/transcribe?model_name=mms-1b-all",
          formData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          }
        );

        const jobId = response.data.data.jobId;
        await checkJobStatus(jobId, verse);
      } catch (error) {
        console.error("Error in transcription:", error);
        Swal.fire(
          "Error",
          "Error in transcription. Please try again later.",
          "error"
        );
        setProcessing(false);
        if (currentChapter) {
          bookChapterKey = `${selectedBook}-${currentChapter?.chapterNumber}`;
          setChapterStatuses((prev) => ({
            ...prev,
            [bookChapterKey]: "Failed",
          }));
        }
        setBooks((prevBooks) =>
          prevBooks.map((book) =>
            book.name === selectedBook
              ? {
                  ...book,
                  inProgress: book.inProgress.filter(
                    (chapter) => chapter !== currentChapter?.chapterNumber
                  ),
                  failed: [
                    ...new Set([
                      ...(book.failed || []),
                      currentChapter?.chapterNumber,
                    ]),
                  ],
                  status: "Failed",
                }
              : book
          )
        );
      }
    },
    [currentChapter, selectedBook, selectedLanguage]
  );

  // Function to check transcription job status
  const checkJobStatus = useCallback(
    async (jobId, verse) => {
      try {
        const response = await api.get(`/ai/model/job?job_id=${jobId}`);
        const jobStatus = response.data.data.status;
        const { chapterNumber, verseNumber } = extractChapterVerse(
          verse.audioFileName
        );
        if (jobStatus === "job finished") {
          const transcribedText =
            response.data.data.output.transcriptions[0].transcribedText;
          const storageKey = `${selectedBook}-${chapterNumber}-${verseNumber}`;
          console.log("storage key", storageKey);

          const transcriptionData = {
            book: selectedBook,
            chapter: chapterNumber,
            verse: verseNumber,
            transcribedText,
          };

          projectInstance
            .setItem(storageKey, transcriptionData)
            .then(() =>
              console.log(`Stored transcription for key ${storageKey}`)
            )
            .catch((err) =>
              console.error(`Failed to store transcription: ${err}`)
            );

          moveToNextVerse(verse);
        }
        else if (jobStatus === "Error") {
          const outputMessage = response.data?.data?.output?.message;
          console.log("error occured in the backend", outputMessage);
          Swal.fire(
            "Error",
            "Some error occured. Please try again later",
            "error"
          );
          setProcessing(false);
          const bookChapterKey = `${selectedBook}-${chapterNumber}`;
          setChapterStatuses((prev) => ({
            ...prev,
            [bookChapterKey]: "Failed",
          }));
          setBooks((prevBooks) =>
            prevBooks.map((book) =>
              book.name === selectedBook
                ? {
                    ...book,
                    inProgress: book.inProgress.filter(
                      (chapter) => chapter !== chapterNumber
                    ),
                    failed: [
                      ...new Set([...(book.failed || []), chapterNumber]),
                    ],
                    status: "Failed",
                  }
                : book
            )
          );
        } else {
          setTimeout(() => checkJobStatus(jobId, verse), 10000);
        }
      } catch (error) {
        console.error("Error fetching job status:", error);
        Swal.fire("Error", "Failed to fetch job status", "error");
        setProcessing(false);
        const { chapterNumber } = extractChapterVerse(verse.audioFileName);
        const bookChapterKey = `${selectedBook}-${chapterNumber}`;
        setChapterStatuses((prev) => ({
          ...prev,
          [bookChapterKey]: "Failed",
        }));
        setBooks((prevBooks) =>
          prevBooks.map((book) =>
            book.name === selectedBook
              ? {
                  ...book,
                  inProgress: book.inProgress.filter(
                    (chapter) => chapter !== chapterNumber
                  ),
                  failed: [...new Set([...(book.failed || []), chapterNumber])],
                  status: "Failed",
                }
              : book
          )
        );
      }
    },
    [selectedBook, projectInstance, extractChapterVerse]
  );

  // Function to move to the next verse after transcription
  const moveToNextVerse = useCallback(
    (verse) => {
      const { chapterNumber, verseNumber } = extractChapterVerse(
        verse.audioFileName
      );

      const nextVerseIndex = bookData.chapters[
        chapterNumber - 1
      ].verses.findIndex(
        (v) =>
          extractChapterVerse(v.audioFileName).verseNumber === verseNumber + 1
      );

      if (nextVerseIndex !== -1) {
        const nextVerse =
          bookData.chapters[chapterNumber - 1].verses[nextVerseIndex];
        setCurrentVerse(nextVerse);
        handleTranscribe(nextVerse);
      } else {
        const bookChapterKey = `${selectedBook}-${chapterNumber}`;
        setChapterStatuses((prev) => ({
          ...prev,
          [bookChapterKey]: "Transcribed",
        }));
        setBooks((prevBooks) =>
          prevBooks.map((book) =>
            book.name === selectedBook
              ? {
                  ...book,
                  status: "Transcribed",
                  inProgress: book.inProgress.filter(
                    (chapter) => chapter !== chapterNumber
                  ),
                  completed: [...new Set([...book.completed, chapterNumber])],
                }
              : book
          )
        );
        const nextChapter = bookData.chapters[chapterNumber];
        if (nextChapter) {
          setCurrentChapter(nextChapter);
          setChapterStatuses((prev) => ({
            ...prev,
            [`${selectedBook}-${nextChapter.chapterNumber}`]: "inProgress",
          }));
          setBooks((prevBooks) =>
            prevBooks.map((book) =>
              book.name === selectedBook
                ? {
                    ...book,
                    status: "inProgress",
                    inProgress: [
                      ...new Set([
                        ...book.inProgress,
                        nextChapter.chapterNumber,
                      ]),
                    ],
                  }
                : book
            )
          );
          setCurrentVerse(nextChapter.verses[0]);
          handleTranscribe(nextChapter.verses[0]);
        } else {
          Swal.fire(
            "Completed",
            "All chapters have been transcribed.",
            "success"
          );
          setProcessing(false);
          setCurrentVerse(null);
          setCurrentChapter(null);
          setBooks((prevBooks) =>
            prevBooks.map((book) =>
              book.name === selectedBook
                ? { ...book, status: "Transcribed", hasDownload: true }
                : book
            )
          );
        }
      }
    },
    [bookData, selectedBook, handleTranscribe]
  );

  // Start transcription process
  const startTranscription = useCallback(
    (firstChapter) => {
      setCurrentChapter(firstChapter);
      setChapterStatuses((prev) => ({
        ...prev,
        [`${selectedBook}-${firstChapter.chapterNumber}`]: "inProgress",
      }));
      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.name === selectedBook
            ? {
                ...book,
                status: "inProgress",
                inProgress: [
                  ...new Set([...book.inProgress, firstChapter.chapterNumber]),
                ],
              }
            : book
        )
      );
      setCurrentVerse(firstChapter.verses[0]);
      handleTranscribe(firstChapter.verses[0]);
    },
    [
      selectedBook,
      setChapterStatuses,
      handleTranscribe,
      setBooks,
      setCurrentVerse,
      setCurrentChapter,
    ]
  );

  return {
    startTranscription,
    currentChapter,
    currentVerse,
  };
};

export default useAudioTranscription;
