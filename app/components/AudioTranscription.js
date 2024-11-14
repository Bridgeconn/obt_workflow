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
  Modal,
  TextField,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import api from "../store/apiConfig";
import { processUSFM } from "../utils/usfmProcessor";
import { AudioCodecDetector } from "../utils/audioCodecDetector";
import LanguageDropdown from "../components/LanguageDropdown";

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
  const [modalOpen, setModalOpen] = useState(false);
  const [chapterContent, setChapterContent] = useState([]);
  const [editedVerses, setEditedVerses] = useState({});

  const handleLanguageChange = (language) => {
    setSelectedLanguage(language);
  };

  // Load transcription statuses from local storage
  const loadTranscriptionStatuses = async () => {
    const keys = await projectInstance.keys();
    const statuses = {};
    
    // First, initialize all chapters as "Not Started"
    bookData.chapters.forEach((chapter) => {
      const bookChapterKey = `${selectedBook}-${chapter.chapterNumber}`;
      statuses[bookChapterKey] = "Not Started";
    });
  
    const chapterVersesMap = {};
    
    for (const key of keys) {
      // Only process keys that match the book-chapter-verse format
      const match = key.match(/^([^-]+)-(\d+)-(\d+)$/);
      if (match && match[1] === selectedBook) {
        const chapter = match[2];
        if (!chapterVersesMap[chapter]) {
          chapterVersesMap[chapter] = [];
        }
        chapterVersesMap[chapter].push({
          key: key,
          verse: match[3]
        });
      }
    }
  
    // Process each chapter
    for (const chapter of bookData.chapters) {
      const chapterNumber = String(chapter.chapterNumber);
      const bookChapterKey = `${selectedBook}-${chapter.chapterNumber}`;
      const chapterVerses = chapterVersesMap[chapterNumber] || [];
  
      if (chapterVerses.length > 0) {
        try {
          // Get data for all verses in this chapter
          const verseDataPromises = chapterVerses.map(({ key }) => 
            projectInstance.getItem(key)
          );
          
          const verseData = await Promise.all(verseDataPromises);
          
          const allVersesTranscribed = verseData.every(data => 
            data && 
            data.transcribedText && 
            data.transcribedText.trim() !== '' &&
            data.book === selectedBook &&
            String(data.chapter) === chapterNumber
          );
          
          const expectedVerseCount = chapter.verses.length;
          const actualTranscribedCount = chapterVerses.length;
  
          if (allVersesTranscribed && expectedVerseCount === actualTranscribedCount) {
            statuses[bookChapterKey] = "Done";
          } else if (actualTranscribedCount > 0) {
            statuses[bookChapterKey] = "In Progress";
          }
        } catch (error) {
          console.error(`Error checking chapter ${chapterNumber} status:`, error);
          statuses[bookChapterKey] = "Error";
        }
      }
    }
  
    console.log("Updated chapter statuses:", statuses);
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

  useEffect(() => {
    if (chapterContent.length > 0) {
      console.log("Chapter content has been updated", chapterContent);
    }
  }, [chapterContent]);

  useEffect(() => {
    if (Object.keys(editedVerses).length > 0) {
      console.log("Edited verses have been updated", editedVerses);
    }
  }, [editedVerses]);

  const handleChapterClick = async (chapter) => {
    const chapterKey = `${selectedBook}-${chapter.chapterNumber}`;

    if (chapterStatuses[chapterKey] === "Done") {
      console.log("coming inside done");

      const keys = await projectInstance.keys();
      const filteredKeys = keys.filter((key) => key.startsWith(chapterKey));

      if (filteredKeys.length === 0) {
        Swal.fire(
          "Content Unavailable",
          `Transcription for this chapter is not available`,
          "error"
        );
        return;
      }

      const verses = await Promise.all(
        chapter.verses.map(async (verse) => {
          const { verseNumber } = extractChapterVerse(verse.audioFileName);
          const verseKey = `${chapterKey}-${verseNumber}`;
          console.log("verse key inside handleChapterClick", verseKey);

          const transcribedData = await projectInstance.getItem(verseKey);
          const transcribedText = transcribedData?.transcribedText || "";
          console.log(
            "transcribed text inside handleChapterClick",
            transcribedText
          );

          return {
            chapterNumber: chapter.chapterNumber,
            verseNumber: verseNumber,
            text: transcribedText || "",
          };
        })
      );
      setEditedVerses({});
      setChapterContent(verses);
      setModalOpen(true);
    }
  };

  const handleTextChange = (chapterNumber, verseNumber, newText) => {
    const chapterVerseKey = `${chapterNumber}-${verseNumber}`;
    setEditedVerses((prev) => ({
      ...prev,
      [chapterVerseKey]: newText,
    }));
  };

  const handleCloseModal = async () => {
    for (const verse of chapterContent) {
      const editedText =
        editedVerses[`${verse.chapterNumber}-${verse.verseNumber}`] ||
        verse.text;
      const storageKey = `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`;
      await projectInstance.setItem(storageKey, {
        book: selectedBook,
        chapter: verse.chapterNumber,
        verse: verse.verseNumber,
        transcribedText: editedText,
      });
    }
    setModalOpen(false);
  };

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
    if (!selectedLanguage) {
      Swal.fire("Error", "Please select a language", "error");
      setProcessing(false);
      return;
    }
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
      console.log("file mime type", verse.file.type);
      const codec = await AudioCodecDetector.detectCodec(verse.file);
      console.log("Detected codec:", codec);
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
        setCurrentVerse(null);
        setCurrentChapter(null);
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

      <LanguageDropdown onLanguageChange={handleLanguageChange} />

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
                  width: "20%",
                }}
              >
                Chapter
              </TableCell>
              <TableCell
                sx={{
                  border: "1px solid #ddd",
                  padding: "10px",
                  fontSize: "16px",
                  width: "60%",
                }}
              >
                Verses
              </TableCell>
              <TableCell
                sx={{
                  border: "1px solid #ddd",
                  padding: "10px",
                  fontSize: "16px",
                  width: "20%",
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
                    <Button
                      variant="contained"
                      sx={{
                        backgroundColor:
                          chapterStatuses[chapterKey] === "Done"
                            ? "green"
                            : "white",
                        color:
                          chapterStatuses[chapterKey] === "Done"
                            ? "white"
                            : "black",
                        fontSize: { xs: "8px", sm: "12px", md: "14px" },
                        width: "auto",
                      }}
                      disabled={chapterStatuses[chapterKey] !== "Done"}
                      onClick={() => handleChapterClick(chapter)}
                    >
                      Chapter {chapterNumber}
                    </Button>
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

      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "auto",
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "90%",
            maxHeight: "60vh",
            overflowY: "auto",
            maxWidth: 800,
            bgcolor: "background.paper",
            borderRadius: 2,
            boxShadow: 24,
            padding: 3,
          }}
        >
          <IconButton
            onClick={handleCloseModal}
            sx={{
              position: "absolute",
              top: "10px",
              right: "10px",
            }}
          >
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={{ marginBottom: "10px" }}>
            {selectedBook} - Chapter {chapterContent[0]?.chapterNumber}
          </Typography>
          {chapterContent.map((verse) => (
            <Box
              key={verse.verseNumber}
              sx={{
                display: "flex",
                alignItems: "center",
                marginBottom: "10px",
                flexWrap: "nowrap",
              }}
            >
              <Typography
                sx={{
                  marginRight: "10px",
                  whiteSpace: { xs: "normal", sm: "nowrap" },
                }}
              >
                Verse {verse.verseNumber}:
              </Typography>
              <TextField
                fullWidth
                variant="outlined"
                value={
                  editedVerses[`${verse.chapterNumber}-${verse.verseNumber}`] ||
                  verse.text
                }
                onChange={(e) =>
                  handleTextChange(
                    verse.chapterNumber,
                    verse.verseNumber,
                    e.target.value
                  )
                }
              />
            </Box>
          ))}
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "20px",
            }}
          >
            <Button variant="contained" onClick={handleCloseModal}>
              Close
            </Button>
          </Box>
        </Box>
      </Modal>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: "center",
          justifyContent: { xs: "center", sm: "flex-start" },
        }}
      >
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
    </Box>
  );
};

export default AudioTranscription;
