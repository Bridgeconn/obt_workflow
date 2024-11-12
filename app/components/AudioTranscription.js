import React, { useState, useEffect } from "react";
import Swal from "sweetalert2";
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
} from "@mui/material";
import api from "../store/apiConfig";
import { processUSFM } from "../utils/usfmProcessor";
import { AudioCodecDetector } from "../utils/audioCodecDetector";
import LanguageDropdown from "../components/LanguageDropdown";
// import { OpusToWavConverter } from "../utils/opusToWavConverter";

const AudioTranscription = ({
  projectInstance,
  projectName,
  selectedBook,
  bookData,
  bibleMetaData,
  onTranscriptionComplete,
}) => {
  const [processing, setProcessing] = useState(false);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [currentVerse, setCurrentVerse] = useState(null);
  const [chapterStatuses, setChapterStatuses] = useState({});
  const [selectedLanguage, setSelectedLanguage] = useState("");

  const handleLanguageChange = (language) => {
    setSelectedLanguage(language);
  };

  // Load transcription statuses from local storage
  const loadTranscriptionStatuses = async () => {
    const keys = await projectInstance.keys();
    console.log("keys", keys);
    const statuses = {};

    bookData.chapters.forEach((chapter) => {
      const bookChapterKey = `${selectedBook}-${chapter.chapterNumber}`;
      statuses[bookChapterKey] = "Not Started";
    });

    for (const key of keys) {
      if (key.startsWith(`${selectedBook}`)) {
        const status = await projectInstance.getItem(key);
        if (status) {
          const match = key.match(/^(.+)-(\d+)-/);
          if (match) {
            const bookChapterKey = `${match[1]}-${match[2]}`;
            statuses[bookChapterKey] = statuses[bookChapterKey] || "done";
          }
        }
      }
    }

    console.log("statuses", statuses);
    setChapterStatuses(statuses);
  };

  useEffect(() => {
    loadTranscriptionStatuses();
  }, [bookData]);

  useEffect(() => {
    if (chapterStatuses) {
      console.log("changed the chapter status");
    }
  }, [chapterStatuses]);

  useEffect(() => {
    if (currentVerse) {
      console.log("updating to the next verse");
    }
  }, [currentVerse]);

  // Extract chapter and verse from the audioFileName
  const extractChapterVerse = (audioFileName) => {
    const match = audioFileName.match(/^(\d+)_(\d+)/);
    if (match) {
      const chapterNumber = parseInt(match[1], 10);
      const verseNumber = parseInt(match[2], 10);
      return { chapterNumber, verseNumber };
    }
    return null;
  };

  // Function to handle transcription for a verse
  const handleTranscribe = async (verse) => {
    setProcessing(true);
    let bookChapterKey;
    if (currentChapter) {
      bookChapterKey = `${selectedBook}-${currentChapter.chapterNumber}`;
      setChapterStatuses((prev) => ({
        ...prev,
        [bookChapterKey]: "In Progress",
      }));
    }

    try {
      const formData = new FormData();
      // const converter = new OpusToWavConverter();
      console.log("file mime type", verse.file.type);
      const codec = await AudioCodecDetector.detectCodec(verse.file);
      console.log("Detected codec:", codec);
      let file;
      let targetFormat;
      if (codec === "Opus") {
        // const wavBlob = await converter.convertOpusToWav(verse.file);
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
        console.log("success");
        console.log("opus to wav file object", file);
      } else {
        file = new File([verse.file], verse.audioFileName, {
          type: `audio/${targetFormat}`,
        });
      }
      console.log("actual file", verse.file);
      console.log("converted file", file, "type of file", typeof file);
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
      checkJobStatus(jobId, verse);
    } catch (error) {
      console.error("Error in transcription:", error);
      Swal.fire(
        "Error",
        "Error in transcription. Please try again later.",
        "error"
      );
      setProcessing(false);

      // const bookChapterKey = `${selectedBook}-${currentChapter.chapterNumber}`;
      setChapterStatuses((prev) => ({
        ...prev,
        [bookChapterKey]: "Failed",
      }));
    }
  };

  // Function to check transcription job status
  const checkJobStatus = async (jobId, verse) => {
    try {
      const response = await api.get(`/ai/model/job?job_id=${jobId}`);
      const jobStatus = response.data.data.status;

      if (jobStatus === "job finished") {
        const transcribedText =
          response.data.data.output.transcriptions[0].transcribedText;
        const { chapterNumber, verseNumber } = extractChapterVerse(
          verse.audioFileName
        );
        const storageKey = `${selectedBook}-${chapterNumber}-${verseNumber}`;
        console.log("storage key", storageKey);
        onTranscriptionComplete(storageKey, {
          book: selectedBook,
          chapter: chapterNumber,
          verse: verseNumber,
          transcribedText,
        });

        moveToNextVerse(verse);
      } else {
        setTimeout(() => checkJobStatus(jobId, verse), 10000);
      }
    } catch (error) {
      console.error("Error fetching job status:", error);
      Swal.fire("Error", "Failed to fetch job status", "error");
      setProcessing(false);
      const bookChapterKey = `${selectedBook}-${chapterNumber}`;
      setChapterStatuses((prev) => ({
        ...prev,
        [bookChapterKey]: "Failed",
      }));
    }
  };

  // Function to move to the next verse after transcription
  const moveToNextVerse = (verse) => {
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
        [bookChapterKey]: "Done",
      }));
      const nextChapter = bookData.chapters[chapterNumber];
      if (nextChapter) {
        setCurrentChapter(nextChapter);
        setChapterStatuses((prev) => ({
          ...prev,
          [`${selectedBook}-${nextChapter.chapterNumber}`]: "In Progress",
        }));
        setCurrentVerse(nextChapter.verses[0]);
        handleTranscribe(nextChapter.verses[0]);
      } else {
        Swal.fire(
          "Completed",
          "All chapters have been transcribed.",
          "success"
        );
        setProcessing(false);
      }
    }
  };

  // Start transcription process
  const startTranscription = () => {
    if (!processing) {
      const firstChapter = bookData.chapters[0];
      setCurrentChapter(firstChapter);
      setChapterStatuses((prev) => ({
        ...prev,
        [`${selectedBook}-${firstChapter.chapterNumber}`]: "In Progress",
      }));
      setCurrentVerse(firstChapter.verses[0]);
      handleTranscribe(firstChapter.verses[0]);
    }
  };

  const downloadUSFM = () => {
    processUSFM(projectInstance, selectedBook, bibleMetaData);
  };

  return (
    <Box sx={{ padding: "40px", width: "100%", margin: "0 auto" }}>
      <Typography variant="h4" sx={{ marginBottom: "20px" }}>
        {projectName}
      </Typography>
      <Typography variant="h5" sx={{ marginBottom: "20px" }}>
        Transcribing Audio Files for {selectedBook}
      </Typography>

      <LanguageDropdown onLanguageChange={handleLanguageChange}/>

      <TableContainer
        component={Paper}
        sx={{
          marginTop: "20px",
          border: "1px solid #ddd",
          borderRadius: "8px",
        }}
      >
        <Table sx={{ borderCollapse: "collapse" }}>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  border: "1px solid #ddd",
                  padding: "10px",
                  fontSize: "16px",
                }}
              >
                Chapter
              </TableCell>
              <TableCell
                sx={{
                  border: "1px solid #ddd",
                  padding: "10px",
                  fontSize: "16px",
                }}
              >
                Verses
              </TableCell>
              <TableCell
                sx={{
                  border: "1px solid #ddd",
                  padding: "10px",
                  fontSize: "16px",
                }}
              >
                Status
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bookData.chapters.map((chapter) => {
              const chapterNumber = chapter.chapterNumber;
              const chapterKey = `${selectedBook}-${chapterNumber}`;
              const currentVerseDetails = currentVerse
                ? extractChapterVerse(currentVerse.audioFileName)
                : null;
              return (
                <TableRow key={chapterKey}>
                  <TableCell
                    sx={{
                      border: "1px solid #ddd",
                      padding: "10px",
                      fontSize: "16px",
                    }}
                  >
                    {chapterNumber}
                  </TableCell>
                  <TableCell
                    sx={{
                      border: "1px solid #ddd",
                      padding: "10px",
                      fontSize: "16px",
                    }}
                  >
                    {chapter.verses.map((verse) => {
                      const { verseNumber } = extractChapterVerse(
                        verse.audioFileName
                      );
                      const isCurrentVerse =
                        String(currentVerseDetails?.chapterNumber) ===
                          String(chapterNumber) &&
                        String(currentVerseDetails?.verseNumber) ===
                          String(verseNumber);

                      const verseKey = `${chapterKey}-${verseNumber}`;
                      return (
                        <Box
                          key={verseKey}
                          sx={{
                            display: "inline-block",
                            marginRight: "10px",
                            fontSize: "16px",
                            fontWeight: isCurrentVerse ? "bold" : "normal",
                            color: isCurrentVerse ? "blue" : "inherit",
                          }}
                        >
                          {verseNumber}
                        </Box>
                      );
                    })}
                  </TableCell>
                  <TableCell
                    sx={{
                      border: "1px solid #ddd",
                      padding: "10px",
                      fontSize: "16px",
                    }}
                  >
                    {chapterStatuses[chapterKey] || "Not Started"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Button
        variant="contained"
        color="primary"
        onClick={startTranscription}
        disabled={processing}
        sx={{ marginTop: "20px" }}
      >
        Transcript
      </Button>

      <Button
        variant="outlined"
        color="secondary"
        onClick={downloadUSFM}
        disabled={processing}
        sx={{ marginTop: "20px", marginLeft: "10px" }}
      >
        Download USFM
      </Button>
    </Box>
  );
};

export default AudioTranscription;
