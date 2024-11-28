import { useState, useEffect, useCallback, useRef } from "react";
import Swal from "sweetalert2";

import api from "../store/apiConfig";
import { unzipBlob } from "../utils/unzip";
import language_codes from "../store/language_codes.json";

const TextToAudioConversion = ({
  projectInstance,
  selectedBook,
  setBooks,
  chapterData,
  audioLanguage,
  setInProgressVerse,
  setChapterStatuses,
  extractChapterVerse,
  setChapterContent,
}) => {
  const [processingChapter, setProcessingChapter] = useState(null);
  const [processingVerse, setProcessingVerse] = useState(null);
  const [isConverting, setIsConverting] = useState(false);

  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (processingVerse && processingChapter) {
      console.log(
        `updating to the next verse in chapter ${processingChapter.chapterNumber}`
      );
    }
  }, [processingVerse, processingChapter]);

  const fetchAsset = async (key, jobId) => {
    let existingData;
    try {
      existingData = await projectInstance.getItem(key);
    } catch (error) {
      console.error("Failed to fetch existing data from IndexedDB:", error);
      Swal.fire(
        "Error",
        "Failed to access local storage. Please check your browser settings.",
        "error"
      );
      setIsConverting(false);
      return;
    }

    const chapterNumber = existingData?.chapter;
    const verseNumber = existingData?.verse;

    try {
      const response = await api.get(`/ai/assets`, {
        params: {
          job_id: jobId,
        },
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: response.headers["content-type"],
      });

      const unzippedFiles = await unzipBlob(blob);

      if (unzippedFiles.length !== 0) {
        const { convertAudio } = await import("../utils/ffmpeg");

        for (const audio of unzippedFiles) {
          const { name, data } = audio;
          if (data instanceof Blob) {
            const convertedFile = await convertAudio(data);
            let fileName = `${selectedBook}-${chapterNumber}-${verseNumber}.wav`;
            const file = new File([convertedFile], fileName, {
              type: convertedFile.type,
            });

            try {
              await projectInstance.setItem(key, {
                ...existingData,
                generatedAudio: file,
                lastUpdated: new Date().toISOString(),
              });
              setChapterContent((prevContent) =>
                prevContent.map((verse) =>
                  verse.chapterNumber === chapterNumber &&
                  verse.verseNumber === verseNumber
                    ? { ...verse, generatedAudio: file }
                    : verse
                )
              );
              setInProgressVerse((prev) => ({ ...prev, [key]: false }));
              return;
            } catch (dbError) {
              console.error("Failed to save audio to IndexedDB:", dbError);
              Swal.fire(
                "Storage Error",
                "Failed to save audio file. You might be out of storage space.",
                "error"
              );
              setIsConverting(false);
              updateBookStatus(chapterNumber, "Failed");
              setInProgressVerse((prev) => ({ ...prev, [key]: false }));
              return;
            }
          }
        }
      }
    } catch (apiError) {
      console.error("API or processing error:", apiError);
      Swal.fire(
        "Error",
        `Failed to fetch audio for verse ${verseNumber} in chapter ${chapterNumber}`,
        "error"
      );
      setIsConverting(false);
      updateBookStatus(chapterNumber, "Failed");
      setInProgressVerse((prev) => ({ ...prev, [key]: false }));
      return;
    }
  };

  const updateBookStatus = (chapterNumber, status) => {
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

        if (status === "converting") {
          updatedBook.inProgress.push(chapterNumber);
        } else if (status === "Converted") {
          updatedBook.converted.push(chapterNumber);
        } else if (status === "Failed") {
          updatedBook.failed.push(chapterNumber);
          // updatedBook.status = "Transcribed"
        }

        return updatedBook;
      })
    );
  };

  const handleConvert = useCallback(
    async (verse) => {
      if (isProcessingRef.current || isConverting) {
        console.log("Conversion already in progress");
        return;
      }
      if (!verse) return;
      console.log("verse", verse);

      try {
        isProcessingRef.current = true;
        setIsConverting(true);
        if (processingChapter) {
          updateBookStatus(processingChapter?.chapterNumber, "converting");
        }
        const { chapterNumber, verseNumber } = extractChapterVerse(
          verse.audioFileName
        );
        setInProgressVerse((prev) => ({
          ...prev,
          [`${selectedBook}-${chapterNumber}-${verseNumber}`]: true,
        }));
        const storageKey = `${selectedBook}-${chapterNumber}-${verseNumber}`;
        const transcribedData = await projectInstance.getItem(storageKey);
        const transcribedTextArray = [transcribedData?.transcribedText.trim()];
        let model_name = "seamless-m4t-large";
        let lang_code = language_codes[audioLanguage]?.tts?.[model_name];
        const response = await api.post(
          `/ai/model/audio/generate?model_name=${model_name}&language=${lang_code}`,
          transcribedTextArray
        );
        const jobId = response.data.data.jobId;
        await checkJobStatus(jobId, verse);
      } catch (error) {
        console.error("Error in TTS conversion:", error);
        Swal.fire(
          "Error",
          "Error in TTS conversion. Please try again later.",
          "error"
        );
        setIsConverting(false);
        isProcessingRef.current = false;
        const { chapterNumber, verseNumber } = extractChapterVerse(
          verse.audioFileName
        );
        setInProgressVerse((prev) => ({
          ...prev,
          [`${selectedBook}-${chapterNumber}-${verseNumber}`]: false,
        }));
        if (processingChapter) {
          updateBookStatus(processingChapter?.chapterNumber, "Failed");
        }
      }
    },
    [processingChapter, selectedBook, audioLanguage, updateBookStatus]
  );

  const moveToNextVerse = useCallback(
    (verse) => {
      const { chapterNumber, verseNumber } = extractChapterVerse(
        verse.audioFileName
      );

      const nextVerse = chapterData.verses.find(
        (v) =>
          extractChapterVerse(v.audioFileName).verseNumber === verseNumber + 1
      );
      if (nextVerse) {
        setProcessingVerse(nextVerse);
        handleConvert(nextVerse);
      } else {
        updateBookStatus(chapterNumber, "Converted");
        Swal.fire(
          "Completed",
          `Audio generation successfully done for chapter ${chapterNumber}`,
          "success"
        );
        setIsConverting(false);
        isProcessingRef.current = false;
        setProcessingVerse(null);
        setProcessingChapter(null);
      }
    },
    [chapterData, extractChapterVerse, handleConvert, updateBookStatus]
  );

  const checkJobStatus = useCallback(
    async (jobId, verse) => {
      try {
        const response = await api.get(`/ai/model/job?job_id=${jobId}`);
        const jobStatus = response.data.data.status;
        const { chapterNumber, verseNumber } = extractChapterVerse(
          verse.audioFileName
        );

        if (jobStatus === "job finished") {
          const storageKey = `${selectedBook}-${chapterNumber}-${verseNumber}`;
          setIsConverting(false);
          isProcessingRef.current = false;
          await fetchAsset(storageKey, jobId);
          moveToNextVerse(verse);
        } else if (jobStatus === "Error") {
          const outputMessage = response.data?.data?.output?.message;
          console.error("Error occurred in the backend:", outputMessage);
          Swal.fire(
            "Error",
            "Some error occurred. Please try again later",
            "error"
          );
          setIsConverting(false);
          isProcessingRef.current = false;
          setInProgressVerse((prev) => ({
            ...prev,
            [`${selectedBook}-${chapterNumber}-${verseNumber}`]: false,
          }));

          updateBookStatus(chapterNumber, "Failed");
        } else {
          setTimeout(() => checkJobStatus(jobId, verse), 10000);
        }
      } catch (error) {
        console.error("Error fetching job status:", error);
        Swal.fire("Error", "Failed to fetch job status", "error");
        setIsConverting(false);
        isProcessingRef.current = false;
        const { chapterNumber, verseNumber } = extractChapterVerse(
          verse.audioFileName
        );
        setInProgressVerse((prev) => ({
          ...prev,
          [`${selectedBook}-${chapterNumber}-${verseNumber}`]: false,
        }));
        updateBookStatus(chapterNumber, "Failed");
      }
    },
    [
      selectedBook,
      extractChapterVerse,
      fetchAsset,
      updateBookStatus,
      moveToNextVerse,
    ]
  );

  const startConversion = useCallback(
    (chapter) => {
      isProcessingRef.current = false;
      setIsConverting(false);
      setProcessingChapter(null);
      setProcessingVerse(null);

      setProcessingChapter(chapter);
      setProcessingVerse(chapter.verses[0]);
      updateBookStatus(chapter.chapterNumber, "converting");
      handleConvert(chapter.verses[0]);
    },
    [selectedBook, setBooks, handleConvert, updateBookStatus]
  );

  return {
    isConverting,
    startConversion,
    processingChapter,
    processingVerse,
  };
};

export default TextToAudioConversion;
