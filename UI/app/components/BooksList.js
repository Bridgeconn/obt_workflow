import React, { useState, useEffect } from "react";
import {
  Box,
  Card,
  Typography,
  Button,
  IconButton,
  Table,
  TableBody,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { Modal, TextField } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottom";
import {
  ChapterCircle,
  StyledTableRow,
  StyledTableCell,
  styles,
} from "../StyledComponents";
import Swal from "sweetalert2";
import { processUSFM } from "../utils/usfmProcessor";
import LanguageDropdown from "../components/LanguageDropdown";
import useAudioTranscription from "./useAudioTranscription";
import TextToAudioConversion from "./TextToAudioConversion";
import source_languages from "../store/source_languages.json";
import major_languages from "../store/major_languages.json";

const BooksList = ({
  projectInstance,
  files,
  setFiles,
  projectName,
  bibleMetaData,
}) => {
  const [books, setBooks] = useState([]);
  const [bookData, setBookData] = useState(null);
  const [chapterData, setChapterData] = useState(null);
  const [scriptLanguage, setScriptLanguage] = useState("");
  const [audioLanguage, setAudiolanguage] = useState("");
  const [chapterStatuses, setChapterStatuses] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [chapterContent, setChapterContent] = useState([]);
  const [editedVerses, setEditedVerses] = useState({});
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [playingAudio, setPlayingAudio] = useState(null);

  useEffect(() => {
    if (files.length != 0) {
      const formattedBooks = files.map((book) => ({
        name: book.bookName,
        totalChapters: book.chapters.length,
        displayChapters: book.chapters.map((chapter) => ({
          chapterNumber: parseInt(chapter.chapterNumber),
          verses: chapter.verses.map((verse) => {
            return {
              audioFileName: verse.audioFileName,
              file: verse.file,
            };
          }),
        })),
        status: "pending",
        completed: [],
        converted: [],
        inProgress: [],
        approved: [],
        failed: [],
        hasDownload: false,
      }));
      setBooks(formattedBooks);
    }
  }, [files]);

  // Load transcription statuses for all books and chapters
  const loadTranscriptionStatuses = async () => {
    const keys = await projectInstance.keys();
    const statuses = {};

    // Initialize all chapters as "pending" for every book
    files.forEach((book) => {
      book.chapters.forEach((chapter) => {
        const bookChapterKey = `${book.bookName}-${chapter.chapterNumber}`;
        statuses[bookChapterKey] = "pending";
      });
    });

    const chapterVersesMap = {};

    for (const key of keys) {
      // Only process keys that match the book-chapter-verse format
      const match = key.match(/^([^-]+)-(\d+)-(\d+)$/);
      if (match) {
        const bookName = match[1];
        const chapter = match[2];
        if (!chapterVersesMap[bookName]) {
          chapterVersesMap[bookName] = {};
        }
        if (!chapterVersesMap[bookName][chapter]) {
          chapterVersesMap[bookName][chapter] = [];
        }
        chapterVersesMap[bookName][chapter].push({
          key: key,
          verse: match[3],
        });
      }
    }

    // Process each book and chapter
    for (const book of files) {
      for (const chapter of book.chapters) {
        const chapterNumber = String(chapter.chapterNumber);
        const bookChapterKey = `${book.bookName}-${chapter.chapterNumber}`;
        const chapterVerses =
          chapterVersesMap[book.bookName]?.[chapterNumber] || [];

        if (chapterVerses.length > 0) {
          try {
            // Get data for all verses in this chapter
            const verseDataPromises = chapterVerses.map(({ key }) =>
              projectInstance.getItem(key)
            );

            const verseData = await Promise.all(verseDataPromises);

            const allVersesApproved = verseData.every(
              (data) => data && data.isApproved === true
            );

            if (allVersesApproved) {
              statuses[bookChapterKey] = "Approved";
            } else {
              const allVersesTranscribed = verseData.every(
                (data) =>
                  data &&
                  data.transcribedText &&
                  data.transcribedText.trim() !== "" &&
                  data.book === book.bookName &&
                  String(data.chapter) === chapterNumber
              );

              const expectedVerseCount = chapter.verses.length;
              const actualTranscribedCount = chapterVerses.length;

              if (
                allVersesTranscribed &&
                expectedVerseCount === actualTranscribedCount
              ) {
                statuses[bookChapterKey] = "Transcribed";
              } else if (actualTranscribedCount > 0) {
                statuses[bookChapterKey] = "inProgress";
              }
            }
            const allVersesConverted = verseData.every(
              (data) => data && data.generatedAudio
            );
            if (allVersesConverted) {
              statuses[bookChapterKey] = "Converted";
            }
          } catch (error) {
            console.error(
              `Error checking status for ${book.bookName} chapter ${chapterNumber}:`,
              error
            );
            statuses[bookChapterKey] = "Error";
          }
        }
      }
    }

    console.log("Updated chapter statuses:", statuses);
    setChapterStatuses(statuses);

    setBooks((prevBooks) =>
      prevBooks.map((book) => {
        const allChaptersTranscribed = book.displayChapters.every(
          (chapter) =>
            statuses[`${book.name}-${chapter.chapterNumber}`] === "Transcribed"
        );

        const allChaptersApproved = book.displayChapters.every(
          (chapter) =>
            statuses[`${book.name}-${chapter.chapterNumber}`] === "Approved"
        );

        const allChaptersConverted = book.displayChapters.every(
          (chapter) =>
            statuses[`${book.name}-${chapter.chapterNumber}`] === "Converted"
        );

        let status = book.status;
        if (allChaptersConverted) {
          status = "Done";
        } else if (allChaptersApproved) {
          status = "Approved";
        } else if (allChaptersTranscribed) {
          status = "Transcribed";
        }

        return allChaptersApproved ||
          allChaptersTranscribed ||
          allChaptersConverted
          ? { ...book, status, hasDownload: true }
          : book;
      })
    );
  };

  const getChapterStatus = (book, chapter) => {
    const bookChapterKey = `${book.name}-${chapter.chapterNumber}`;

    if (chapterStatuses[bookChapterKey]) {
      return chapterStatuses[bookChapterKey];
    }
    //fallback  checks
    if (book.completed.includes(chapter.chapterNumber)) return "Transcribed";
    if (book.converted.includes(chapter.chapterNumber)) return "Converted";
    if (book.inProgress.includes(chapter.chapterNumber)) return "inProgress";
    if (book.approved.includes(chapter.chapterNumber)) return "Approved";
    if (book.failed.includes(chapter.chapterNumber)) return "Failed";

    //default return
    return "pending";
  };

  const showCurrentStatus = (book) => {
    console.log("book status", book.status);

    if (book.status === "pending") {
      return "Transcribe";
    }
    if (book.status === "inProgress") {
      for (const chapter of book.displayChapters) {
        if (
          String(chapter.chapterNumber) ===
          String(currentChapter?.chapterNumber)
        ) {
          const { verseNumber } = extractChapterVerse(
            currentVerse?.audioFileName
          );

          return `[${verseNumber} out of ${chapter.verses.length}]`;
        }
      }
    }
    if (book.status === "converting") {
      for (const chapter of book.displayChapters) {
        if (
          String(chapter.chapterNumber) ===
          String(processingChapter?.chapterNumber)
        ) {
          const { verseNumber } = extractChapterVerse(
            processingVerse?.audioFileName
          );

          return `[${verseNumber} out of ${chapter.verses.length}]`;
        }
      }
    }
    if (book.approved.length === book.totalChapters) {
      return "Approved";
    }
    if (book.converted.length === book.totalChapters) {
      return "Done";
    }
    return book.status;
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

  useEffect(() => {
    if (files.length !== 0 && projectInstance) {
      loadTranscriptionStatuses();
    }
  }, [files, projectInstance]);

  useEffect(() => {
    if (chapterStatuses) {
      console.log("changed the chapter status");
    }
  }, [chapterStatuses]);

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

  useEffect(() => {
    if (selectedBook) {
      console.log("currently selected book in the Modal", selectedBook);
    }
  }, [selectedBook]);

  useEffect(() => {
    if (books) {
      console.log("updating the books");
    }
  }, [books]);

  const handleTextChange = (chapterNumber, verseNumber, newText) => {
    const bookChapterVerse = `${selectedBook}-${chapterNumber}-${verseNumber}`;
    setEditedVerses((prev) => ({
      ...prev,
      [bookChapterVerse]: newText,
    }));
  };

  const handleLanguageChange = (type, language) => {
    console.log("selected language", language);
    type === "audio" ? setAudiolanguage(language) : setScriptLanguage(language);
  };

  const isBookReady = projectInstance && scriptLanguage && bookData;

  const { startTranscription, currentChapter, currentVerse, isTranscribing } =
    useAudioTranscription({
      projectInstance,
      selectedBook: bookData?.bookName,
      setBooks,
      bookData,
      scriptLanguage,
      setChapterStatuses,
      extractChapterVerse,
    });

  useEffect(() => {
    if (isBookReady && bookData) {
      startTranscription(bookData.chapters[0]);
    }
  }, [isBookReady, bookData]);

  const processBook = (name) => {
    const selectedData = files.find(({ bookName }) => bookName === name);
    if (!scriptLanguage) {
      Swal.fire("Error", "Please select a script language", "error");
      return;
    }
    if (selectedData) {
      setBookData(selectedData);
    }
  };

  const handleChapterClick = async (book, chapter) => {
    setSelectedBook(book.name);
    setSelectedChapter(chapter.chapterNumber);
    const chapterKey = `${book.name}-${chapter.chapterNumber}`;
    if (
      chapterStatuses[chapterKey] === "Transcribed" ||
      chapterStatuses[chapterKey] === "Approved" ||
      chapterStatuses[chapterKey] === "Disapproved" ||
      chapterStatuses[chapterKey] === "Converted" ||
      chapterStatuses[chapterKey] === "converting"
    ) {
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

          const transcribedData = await projectInstance.getItem(verseKey);
          const transcribedText = transcribedData?.transcribedText || "";

          return {
            chapterNumber: chapter.chapterNumber,
            verseNumber: verseNumber,
            text: transcribedText || "",
            generatedAudio: transcribedData?.generatedAudio,
          };
        })
      );
      setEditedVerses({});
      setChapterContent(verses);
      setModalOpen(true);
    }
  };

  const handleCloseModal = async () => {
    for (const verse of chapterContent) {
      const editedText =
        editedVerses[
          `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`
        ] || verse.text;
      const storageKey = `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`;
      const existingData = await projectInstance.getItem(storageKey);
      await projectInstance.setItem(storageKey, {
        ...existingData,
        transcribedText: editedText,
      });
    }
    setModalOpen(false);
    setSelectedBook("");
    setSelectedChapter(null);
  };

  const handleChapterApproval = async () => {
    const isCurrentlyApproved =
      chapterStatuses[`${selectedBook}-${selectedChapter}`] === "Approved";
    for (const verse of chapterContent) {
      const editedText =
        editedVerses[
          `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`
        ] || verse.text;
      const storageKey = `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`;
      const existingData = await projectInstance.getItem(storageKey);
      await projectInstance.setItem(storageKey, {
        ...existingData,
        transcribedText: editedText,
        isApproved: !isCurrentlyApproved,
      });
    }

    const newChapterStatuses = {
      ...chapterStatuses,
      [`${selectedBook}-${selectedChapter}`]: isCurrentlyApproved
        ? "Disapproved"
        : "Approved",
    };
    setBooks((prevBooks) =>
      prevBooks.map((book) => {
        if (book.name === selectedBook) {
          const updatedApproved = [...book.approved];
          const updatedTranscribed = [...book.completed];
          const updatedConverted = [...book.converted];

          if (isCurrentlyApproved) {
            // Remove from approved and add to transcribed or converted
            const index = updatedApproved.indexOf(selectedChapter);
            if (index !== -1) updatedApproved.splice(index, 1);
            if (book?.status === "Done") {
              updatedConverted.push(selectedChapter);
            } else {
              updatedTranscribed.push(selectedChapter);
            }
          } else {
            // Remove from transcribed or converted and add to approved
            if (book?.status === "Transcribed") {
              const index = updatedTranscribed.indexOf(selectedChapter);
              if (index !== -1) updatedTranscribed.splice(index, 1);
            } else {
              const index = updatedConverted.indexOf(selectedChapter);
              if (index !== -1) updatedConverted.splice(index, 1);
            }
            updatedApproved.push(selectedChapter);
          }
          const allChaptersApproved = book.displayChapters.every(
            (chapter) =>
              newChapterStatuses[`${book.name}-${chapter.chapterNumber}`] ===
              "Approved"
          );

          let status = book?.status;
          if (allChaptersApproved) {
            status = "Approved";
            Swal.fire(
              "Success",
              "All chapters approved successfully",
              "success"
            );
          }

          return {
            ...book,
            status,
            approved: updatedApproved,
            completed: updatedTranscribed,
            converted: updatedConverted,
            hasDownload: allChaptersApproved,
          };
        }
        return book;
      })
    );
    setChapterStatuses(newChapterStatuses);
    setModalOpen(false);
    setSelectedBook("");
    setSelectedChapter(null);
  };

  const isChapterReady = projectInstance && audioLanguage && chapterData;
  useEffect(() => {
    if (isChapterReady && chapterData) {
      startConversion(chapterData);
    }
  }, [isChapterReady, chapterData]);

  const { isConverting, startConversion, processingChapter, processingVerse } =
    TextToAudioConversion({
      projectInstance,
      selectedBook,
      setBooks,
      chapterData,
      audioLanguage,
      setChapterStatuses,
      extractChapterVerse,
    });

  const handleSpeechConversion = () => {
    const fetchedChapter = files
      .find((file) => file.bookName === selectedBook)
      ?.chapters.find(
        (chapter) => String(chapter.chapterNumber) === String(selectedChapter)
      );
    if (!audioLanguage) {
      setModalOpen(false);
      Swal.fire("Error", "Please select an audio language", "error");
      return;
    }
    console.log("fetched chapter", fetchedChapter);
    if (fetchedChapter) {
      setChapterData(fetchedChapter);
    }
    const isCurrentlyConverted =
      chapterStatuses[`${selectedBook}-${selectedChapter}`] === "Converted";
    setBooks((prevBooks) =>
      prevBooks.map((book) => {
        if (book.name === selectedBook) {
          const updatedConvertedChapters = [...book.converted];

          if (
            isCurrentlyConverted &&
            !updatedConvertedChapters.includes(selectedChapter)
          ) {
            updatedConvertedChapters.push(selectedChapter);
          }

          const allChaptersConverted = book.displayChapters.every((chapter) =>
            updatedConvertedChapters.includes(chapter.chapterNumber)
          );

          return {
            ...book,
            converted: updatedConvertedChapters,
            status: allChaptersConverted ? "Done" : book.status,
            hasDownload: allChaptersConverted || book.hasDownload,
          };
        }
        return book;
      })
    );
    setModalOpen(false);
  };

  const handleAudioToggle = (file, verseKey) => {
    if (playingAudio?.key === verseKey) {
      playingAudio.audio.pause();
      if (playingAudio.url) {
        URL.revokeObjectURL(playingAudio.url);
      }
      setPlayingAudio(null);
      return;
    }

    if (playingAudio) {
      playingAudio.audio.pause();
      if (playingAudio.url) {
        URL.revokeObjectURL(playingAudio.url);
      }
    }

    const url = URL.createObjectURL(file);
    const audio = new Audio(url);

    audio.play();

    setPlayingAudio({
      key: verseKey,
      audio,
      url,
    });

    audio.onended = () => {
      URL.revokeObjectURL(url);
      setPlayingAudio(null);
    };

    audio.onerror = () => {
      console.error("Error playing audio");
      URL.revokeObjectURL(url);
      setPlayingAudio(null);
    };
  };

  useEffect(() => {
    return () => {
      if (playingAudio) {
        playingAudio.audio.pause();
        if (playingAudio.url) {
          URL.revokeObjectURL(playingAudio.url);
        }
      }
    };
  }, [playingAudio]);

  const downloadUSFM = (book) => {
    processUSFM(projectInstance, book.name, bibleMetaData);
  };

  const resetProject = () => {
    setFiles([]);
  };

  return (
    <Card sx={styles.cardRoot}>
      <Box sx={styles.header}>
        <Box sx={styles.HeadingContainer}>
        <Typography variant="h6">Project Name</Typography>
          <Typography variant="h4" sx={styles.headerTitle}>
            {projectName}
          </Typography>
        </Box>
        <Box sx={styles.selectBox}>
        <Box sx={styles.TitleContainer}>
          <Typography variant="h6">Source Language Uploaded</Typography>
          <LanguageDropdown
            languages={source_languages}
            type="audio"
            onLanguageChange={handleLanguageChange}
          />
        </Box>
        <Box sx={styles.TitleContainer}>
          <Typography variant="h6">Script Language</Typography>
          <LanguageDropdown
            languages={major_languages}
            type="script"
            onLanguageChange={handleLanguageChange}
          />
        </Box>
        </Box>
      </Box>

      <TableContainer sx={styles.tableContainer}>
        <Table>
          <TableHead>
            <TableRow>
              <StyledTableCell width="25%">
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  fontWeight={500}
                >
                  Books
                </Typography>
              </StyledTableCell>
              <StyledTableCell width="45%">
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  fontWeight={500}
                >
                  Chapters
                </Typography>
              </StyledTableCell>
              <StyledTableCell width="20%" sx={{textAlign: "center"}}>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  fontWeight={500}
                >
                  Status
                </Typography>
              </StyledTableCell>
              <StyledTableCell width="10%">
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  fontWeight={500}
                >
                  USFM
                </Typography>
              </StyledTableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {books.map((book, index) => (
              <StyledTableRow key={index}>
                <StyledTableCell>
                  <Typography fontWeight={600}>
                    {book.name}
                  </Typography>
                </StyledTableCell>
                <StyledTableCell>
                  <Box sx={styles.chaptersContainer}>
                    {book.displayChapters.map((chapter, idx) => (
                      <ChapterCircle
                        key={`${book.name}-${chapter.chapterNumber}-${idx}`}
                        status={getChapterStatus(book, chapter)}
                        onClick={() => handleChapterClick(book, chapter)}
                      >
                        {chapter.chapterNumber}
                      </ChapterCircle>
                    ))}
                  </Box>
                </StyledTableCell>
                <StyledTableCell sx={{display: "flex", justifyContent: "center"}}>
                  <Button
                    variant={book.status === "pending" && "outlined"}
                    onClick={() => {
                      if (book.status === "pending") {
                        processBook(book.name);
                      }
                    }}
                    disabled={!(book.status == "pending")}
                  >
                    {showCurrentStatus(book)}
                  </Button>
                </StyledTableCell>
                <StyledTableCell>
                  {book.hasDownload && (
                    <IconButton
                      size="small"
                      color="inherit"
                      sx={styles.iconButton}
                      onClick={() => downloadUSFM(book)}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  )}
                </StyledTableCell>
              </StyledTableRow>
            ))}
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
            overflow: "hidden",
            maxWidth: 800,
            bgcolor: "background.paper",
            borderRadius: 2,
            boxShadow: 24,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            sx={{
              position: "sticky",
              top: 0,
              backgroundColor: "background.paper",
              zIndex: 1,
              padding: "16px",
              borderBottom: "1px solid rgba(0, 0, 0, 0.12)",
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
          </Box>

          <Box
            sx={{
              flex: 1,
              overflowY: "auto",
              padding: "16px",
            }}
          >
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
                    editedVerses[
                      `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`
                    ] || verse.text
                  }
                  onChange={(e) =>
                    handleTextChange(
                      verse.chapterNumber,
                      verse.verseNumber,
                      e.target.value
                    )
                  }
                />
                {verse?.generatedAudio ? (
                  <IconButton
                    onClick={() =>
                      handleAudioToggle(
                        verse?.generatedAudio,
                        `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`
                      )
                    }
                  >
                    {isConverting ? (
                      verse?.generatedAudio ? (
                        playingAudio?.key ===
                        `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}` ? (
                          <PauseCircleIcon sx={{ height: 30, width: 30 }} />
                        ) : (
                          <PlayCircleIcon sx={{ height: 30, width: 30 }} />
                        )
                      ) : (
                        <HourglassBottomIcon sx={{ height: 30, width: 30 }} />
                      )
                    ) : playingAudio?.key ===
                      `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}` ? (
                      <PauseCircleIcon sx={{ height: 30, width: 30 }} />
                    ) : (
                      <PlayCircleIcon sx={{ height: 30, width: 30 }} />
                    )}
                  </IconButton>
                ) : (
                  <IconButton sx={{ opacity: 0, width: 30, height: 30 }} />
                )}
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 2,
              position: "sticky",
              bottom: 0,
              backgroundColor: "background.paper",
              zIndex: 1,
              borderTop: "1px solid rgba(0, 0, 0, 0.12)",
              padding: "16px",
            }}
          >
            <Button variant="contained" onClick={handleCloseModal} sx={styles.Button} >
              Close
            </Button>
            <Button variant="contained" onClick={handleChapterApproval} sx={styles.Button}>
              {chapterStatuses[`${selectedBook}-${selectedChapter}`] ===
              "Approved"
                ? "Disapprove"
                : "Approve"}
            </Button>
            <Button variant="contained" onClick={handleSpeechConversion} sx={styles.Button}>
              Convert to speech
            </Button>
          </Box>
        </Box>
      </Modal>

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "40px",
          px: 2 
        }}
      >
        <Button
          variant="contained"
          onClick={resetProject}
          sx={styles.Button}
        >
          Reset Project
        </Button>
        <Button variant="contained" sx={styles.Button}>
          Download Project
        </Button>
      </Box>
    </Card>
  );
};

export default BooksList;
