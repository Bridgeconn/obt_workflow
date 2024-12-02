import React, { useState, useEffect, useMemo } from "react";
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
import CircularProgress from "@mui/material/CircularProgress";
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
import DownloadProject from "./DownloadProject";

const BooksList = ({
  projectInstance,
  files,
  setFiles,
  jsonFiles,
  projectName,
  licenseData
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
  const [inProgressVerse, setInProgressVerse] = useState({});

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

    // Collect verse data for each chapter
    for (const key of keys) {
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

    // Track book-level updates
    const bookUpdates = files.map(async (book) => {
      try {
        const chapterLevelStatuses = await Promise.all(
          book.chapters.map(async (chapter) => {
            const chapterNumber = String(chapter.chapterNumber);
            const bookChapterKey = `${book.bookName}-${chapterNumber}`;
            const chapterVerses =
              chapterVersesMap[book.bookName]?.[chapterNumber] || [];

            if (chapterVerses.length === 0) {
              statuses[bookChapterKey] = "pending";
              return {
                chapterNumber: chapterNumber,
                status: "pending",
              };
            }

            try {
              // Fetch data for all verses in this chapter
              const verseData = await Promise.all(
                chapterVerses.map(({ key }) => projectInstance.getItem(key))
              );

              // Check for transcribed text
              const allVersesTranscribed = verseData.every(
                (data) =>
                  data &&
                  data.transcribedText &&
                  data.transcribedText.trim() !== ""
              );
              // Check for audio conversion
              const allVersesConverted = verseData.every(
                (data) => data && data.generatedAudio
              );

              // Check for approved status
              const allVersesApproved = verseData.every(
                (data) => data && data.isApproved === true
              );

              // Determine and update chapter status
              let chapterStatus = "pending";
              if (allVersesApproved) {
                chapterStatus = "Approved";
              } else if (allVersesConverted) {
                chapterStatus = "Converted";
              } else if (allVersesTranscribed) {
                chapterStatus = "Transcribed";
              }

              statuses[bookChapterKey] = chapterStatus;

              return {
                chapterNumber: chapterNumber,
                status: chapterStatus,
              };
            } catch (error) {
              console.error(
                `Error fetching verse data for ${book.bookName} chapter ${chapterNumber}:`,
                error
              );
              statuses[bookChapterKey] = "Error";
              return {
                chapterNumber: chapterNumber,
                status: "Error",
              };
            }
          })
        );

        const chapterStatusCounts = chapterLevelStatuses.reduce(
          (acc, chapter) => {
            acc[chapter.status] = (acc[chapter.status] || 0) + 1;
            return acc;
          },
          {}
        );

        let newStatus = "pending";
        if (chapterStatusCounts["Approved"] === chapterLevelStatuses.length) {
          newStatus = "Approved";
        } else if (
          chapterStatusCounts["Converted"] === chapterLevelStatuses.length
        ) {
          newStatus = "Done";
        } else if (
          chapterStatusCounts["Transcribed"] === chapterLevelStatuses.length
        ) {
          newStatus = "Transcribed";
        } else if (chapterStatusCounts["Transcribed"] > 0) {
          newStatus = "Transcribed";
        } else if (chapterStatusCounts["Converted"] > 0) {
          newStatus = "Done";
        } else if (chapterStatusCounts["Error"] > 0) {
          newStatus = "pending";
        }

        return {
          book,
          status: newStatus,
          hasDownload: newStatus === "Done" || newStatus === "Approved",
        };
      } catch (error) {
        console.error(`Error processing book ${book.bookName}:`, error);
        return {
          book,
          status: "pending",
          hasDownload: false,
        };
      }
    });

    // Resolve book updates and update states
    const resolvedBookUpdates = await Promise.all(bookUpdates);


    // Update chapter statuses
    setChapterStatuses(statuses);

    // Update books state
    setBooks((prevBooks) =>
      prevBooks.map((prevBook) => {
        const updatedBook = resolvedBookUpdates.find(
          (update) => update.book.bookName === prevBook.name
        );
        return updatedBook
          ? {
              ...prevBook,
              status: updatedBook.status,
              hasDownload: updatedBook.hasDownload,
            }
          : prevBook;
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
    if (book.status === "pending") {
      return "Transcribe";
    }
    if (book.status === "Error") {
      return "Retry";
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
    return book.status;
  };

  const bookInProgress = useMemo(() => {
    for (const book of books) {
      if (book.status === "inProgress") {
        return true;
      }
    }
    return false;
  }, [books]);

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
    type === "audio" ? setAudiolanguage(language) : setScriptLanguage(language);
  };

  const isBookReady = projectInstance && scriptLanguage && bookData;
  const areLanguagesChosen = audioLanguage && scriptLanguage;

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
    setBookData(null);
    setTimeout(() => {
      if (selectedData) {
        setBookData(selectedData);
      }
    }, 0);
  };

  const handleChapterClick = async (book, chapter) => {
    setSelectedBook(book.name);
    setSelectedChapter(chapter.chapterNumber);
    const chapterKey = `${book.name}-${chapter.chapterNumber}`;
    if (
      !(
        chapterStatuses[chapterKey] === "pending" ||
        chapterStatuses[chapterKey] === "inProgress"
      )
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
    if (playingAudio) {
      playingAudio.audio.pause();
      if (playingAudio.url) {
        URL.revokeObjectURL(playingAudio.url);
      }
      setPlayingAudio(null);
    }
  };

  const handleChapterApproval = async () => {
    const isCurrentlyApproved =
      chapterStatuses[`${selectedBook}-${selectedChapter}`] === "Approved";

    // Update verses with transcribed text and approval status
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

    await loadTranscriptionStatuses();

    setModalOpen(false);
    setSelectedBook("");
    setSelectedChapter(null);
  };

  const isChapterReady = projectInstance && audioLanguage && chapterData;
  useEffect(() => {
    const isFailedChapter =
      chapterStatuses[`${selectedBook}-${selectedChapter}`] === "Failed";
    if ((isChapterReady && chapterData) || (chapterData && isFailedChapter)) {
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
      setInProgressVerse,
      setChapterStatuses,
      extractChapterVerse,
      setChapterContent,
    });

  const handleSpeechConversion = async () => {
    const fetchedChapter = files
      .find((file) => file.bookName === selectedBook)
      ?.chapters.find(
        (chapter) => String(chapter.chapterNumber) === String(selectedChapter)
      );
    setChapterData(null);
    if (!audioLanguage) {
      setModalOpen(false);
      Swal.fire("Error", "Please select an audio language", "error");
      return;
    }

    setTimeout(() => {
      if (fetchedChapter) {
        setChapterData(fetchedChapter);
      }
    }, 0);
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
    try {
      const updatedVerses = await Promise.all(
        chapterContent.map(async (verse) => {
          const verseKey = `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`;
          const verseData = await projectInstance.getItem(verseKey);
          return {
            ...verse,
            generatedAudio: verseData?.generatedAudio || verse.generatedAudio,
          };
        })
      );

      setChapterContent(updatedVerses);
    } catch (error) {
      console.error("Error updating chapter content:", error);
    }
    // setModalOpen(false);
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

    audio
      .play()
      .then(() => {
        setPlayingAudio({
          key: verseKey,
          audio,
          url,
        });
      })
      .catch(() => {
        console.error("Error playing audio");
        URL.revokeObjectURL(url);
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
    processUSFM(projectInstance, book.name, true);
  };

  const resetProject = () => {
    setFiles([]);
    // window.location.reload();
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
            <Typography variant="h6">Source Audio Uploaded</Typography>
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
              <StyledTableCell width="20%" sx={{ textAlign: "center" }}>
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
                  <Typography fontWeight={600}>{book.name}</Typography>
                </StyledTableCell>
                <StyledTableCell>
                  <Box
                    sx={styles.chaptersContainer}
                    disabled={!areLanguagesChosen}
                  >
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
                <StyledTableCell
                  sx={{ display: "flex", justifyContent: "center" }}
                >
                  <Button
                    {...(book.status === "pending" && { variant: "outlined" })}
                    {...(book.status === "Error" && { variant: "contained" })}
                    sx={{
                      ...(book.status === "Error" && {
                        backgroundColor: "#FAA49D",
                        color: "#F44336",
                        "&:hover": {
                          backgroundColor: "#FFCCCB",
                        },
                      }),
                    }}
                    onClick={() => {
                      if (
                        book.status === "pending" ||
                        book.status === "Error"
                      ) {
                        processBook(book.name);
                      }
                    }}
                    disabled={
                      !(book.status == "pending" || book.status === "Error") ||
                      !areLanguagesChosen ||
                      bookInProgress
                    }
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
                  multiline
                  minRows={1}
                  maxRows={10}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                    }
                  }}
                  sx={{
                    overflow: "hidden",
                  }}
                />
                <IconButton sx={{ minWidth: "50px" }}>
                  {inProgressVerse[
                    `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`
                  ] ? (
                    <CircularProgress size={24} sx={{ color: 'black' }} />
                  ) : verse?.generatedAudio ? (
                    playingAudio?.key ===
                    `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}` ? (
                      <PauseCircleIcon
                        sx={{ height: 30, width: 30 }}
                        onClick={() =>
                          handleAudioToggle(
                            verse?.generatedAudio,
                            `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`
                          )
                        }
                      />
                    ) : (
                      <PlayCircleIcon
                        sx={{ height: 30, width: 30 }}
                        onClick={() =>
                          handleAudioToggle(
                            verse?.generatedAudio,
                            `${selectedBook}-${verse.chapterNumber}-${verse.verseNumber}`
                          )
                        }
                      />
                    )
                  ) : (
                    <span style={{ visibility: "hidden", height: "30px", width: "30px" }}></span>
                  )}
                </IconButton>
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
            <Button
              variant="contained"
              onClick={handleCloseModal}
              sx={styles.Button}
            >
              Close
            </Button>
            <Button
              variant="contained"
              onClick={handleChapterApproval}
              sx={styles.Button}
            >
              {chapterStatuses[`${selectedBook}-${selectedChapter}`] ===
              "Approved"
                ? "Unapprove"
                : "Approve"}
            </Button>
            <Button
              variant="contained"
              onClick={handleSpeechConversion}
              disabled={isConverting}
              sx={{
                ...styles.Button,
                ...(chapterStatuses[`${selectedBook}-${selectedChapter}`] ===
                  "Failed" && {
                  backgroundColor: "#FAA49D",
                  color: "#F44336",
                  "&:hover": {
                    backgroundColor: "#FFCCCB",
                  },
                }),
              }}
            >
              {chapterStatuses[`${selectedBook}-${selectedChapter}`] ===
              "Failed"
                ? "Retry Conversion"
                : "Convert to Speech"}
            </Button>
          </Box>
        </Box>
      </Modal>

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "40px",
          px: 2,
        }}
      >
        <Button
          variant="contained"
          onClick={resetProject}
          sx={styles.Button}
          disabled={isTranscribing || isConverting}
        >
          Reset Project
        </Button>
        <DownloadProject projectName = {projectName} projectInstance={projectInstance} jsonFiles={jsonFiles} licenseData= {licenseData} />
      </Box>
    </Card>
  );
};

export default BooksList;
