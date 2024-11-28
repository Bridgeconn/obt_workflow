import { useState, useEffect, useCallback } from "react";
import Swal from "sweetalert2";

import api from "../store/apiConfig";
import { AudioCodecDetector } from "../utils/audioCodecDetector";
import language_codes from "../store/language_codes.json";

const useAudioTranscription = ({
  projectInstance,
  selectedBook,
  setBooks,
  bookData,
  scriptLanguage,
  setChapterStatuses,
  extractChapterVerse,
}) => {
  const [currentChapter, setCurrentChapter] = useState(null);
  const [currentVerse, setCurrentVerse] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  useEffect(() => {
    if (currentVerse && currentChapter) {
      console.log(
        `updating to the next verse in chapter ${currentChapter.chapterNumber}`
      );
    }
  }, [currentVerse, currentChapter]);

  const updateBookStatus = useCallback(
    (chapterNumber, status) => {
      const bookChapterKey = `${selectedBook}-${chapterNumber}`;

      setChapterStatuses((prev) => ({
        ...prev,
        [bookChapterKey]: status,
      }));

      setBooks((prevBooks) =>
        prevBooks.map((book) => {
          if (book.name !== selectedBook) return book;

          const updatedBook = { ...book };
          const arrays = [
            "approved",
            "completed",
            "inProgress",
            "converted",
            "failed",
          ];
          arrays.forEach((arr) => {
            updatedBook[arr] =
              updatedBook[arr]?.filter((ch) => ch !== chapterNumber) || [];
          });

          switch (status) {
            case "inProgress":
              updatedBook.inProgress.push(chapterNumber);
              updatedBook.status = "inProgress";
              break;
            case "Transcribed":
              updatedBook.completed.push(chapterNumber);
              break;
            case "Failed":
              updatedBook.failed.push(chapterNumber);
              updatedBook.status = "Error";
              break;
          }

          return updatedBook;
        })
      );
    },
    [selectedBook]
  );

  const prepareAudioFile = async (verse) => {
    const codec = await AudioCodecDetector.detectCodec(verse.file);
    let file;
    let targetFormat;

    if (codec === "Opus") {
      const { convertAudioFile } = await import("../utils/opusAudioConversion");
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

    return file;
  };

  // Function to handle transcription for a verse
  const handleTranscribe = useCallback(
    async (verse) => {
      if (!verse) return;
      if(isTranscribing) return;
      setIsTranscribing(true);
      if (currentChapter) {
        updateBookStatus(currentChapter?.chapterNumber, "inProgress");
      }

      try {
        const formData = new FormData();
        const file = await prepareAudioFile(verse);
        let model_name = "mms-1b-all";
        console.log("selected language", scriptLanguage)
        let lang_code = language_codes[scriptLanguage]?.stt?.[model_name];
        console.log("lang_code", lang_code);
        formData.append("files", file);
        formData.append("transcription_language", lang_code);

        const response = await api.post(
          `/ai/model/audio/transcribe?model_name=${model_name}`,
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
        if (currentChapter) {
          updateBookStatus(currentChapter?.chapterNumber, "Failed");
        }
        setIsTranscribing(false);
      }
    },
    [currentChapter, selectedBook, scriptLanguage, updateBookStatus]
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

          const transcriptionData = {
            book: selectedBook,
            chapter: chapterNumber,
            verse: verseNumber,
            transcribedText,
          };
          setIsTranscribing(false);
          await projectInstance.setItem(storageKey, transcriptionData);
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
          updateBookStatus(chapterNumber, "Failed");
          setIsTranscribing(false);
        } else {
          setTimeout(() => checkJobStatus(jobId, verse), 10000);
        }
      } catch (error) {
        console.error("Error fetching job status:", error);
        Swal.fire("Error", "Failed to fetch job status", "error");
        const { chapterNumber } = extractChapterVerse(verse.audioFileName);
        updateBookStatus(chapterNumber, "Failed");
        setIsTranscribing(false);
      }
    },
    [selectedBook, projectInstance, extractChapterVerse, updateBookStatus]
  );

  // Function to move to the next verse after transcription
  const moveToNextVerse = useCallback(
    (verse) => {
      console.log("verse in move to next verse", verse);
      const { chapterNumber, verseNumber } = extractChapterVerse(
        verse.audioFileName
      );
      console.log("chapter number", chapterNumber)
      console.log("verse number", verseNumber)

      const currentChapter = bookData.chapters.find(
        (chapter) => parseInt(chapter.chapterNumber) === parseInt(chapterNumber)
      );
      const nextVerseIndex = currentChapter.verses.findIndex(
        (v) =>
          extractChapterVerse(v.audioFileName).verseNumber === verseNumber + 1
      );

      if (nextVerseIndex !== -1) {
        const nextVerse =
        currentChapter.verses[nextVerseIndex];
        setCurrentVerse(nextVerse);
        handleTranscribe(nextVerse);
      } else {
        updateBookStatus(chapterNumber, "Transcribed");
        const nextChapter = bookData.chapters.find(
          (chapter) => parseInt(chapter.chapterNumber) === parseInt(chapterNumber) + 1
        );
        if (nextChapter) {
          setCurrentChapter(nextChapter);
          setCurrentVerse(nextChapter.verses[0]);
          updateBookStatus(nextChapter.chapterNumber, "inProgress");
          handleTranscribe(nextChapter.verses[0]);
        } else {
          Swal.fire(
            "Completed",
            `All chapters in the book ${selectedBook} have been transcribed.`,
            "success"
          );
          setCurrentVerse(null);
          setCurrentChapter(null);
          setBooks((prevBooks) =>
            prevBooks.map((book) =>
              book.name === selectedBook
                ? { ...book, status: "Transcribed", hasDownload: true }
                : book
            )
          );
          setIsTranscribing(false);
        }
      }
    },
    [bookData, selectedBook, extractChapterVerse, handleTranscribe, updateBookStatus]
  );

  // Start transcription process
  const startTranscription = useCallback(
    (firstChapter) => {
      setCurrentChapter(firstChapter);
      setCurrentVerse(firstChapter.verses[0]);
      updateBookStatus(firstChapter.chapterNumber, "inProgress");
      handleTranscribe(firstChapter.verses[0]);
    },
    [
      selectedBook,
      updateBookStatus,
      handleTranscribe
    ]
  );

  return {
    startTranscription,
    currentChapter,
    currentVerse,
    setCurrentChapter,
    setCurrentVerse,
    isTranscribing
  };
};

export default useAudioTranscription;
