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

const BooksList = ({
  projectInstance,
  files,
  projectName,
  bibleMetaData,
  sourceLang,
}) => {
  const [processing, setProcessing] = useState(false);
  const [books, setBooks] = useState([]);
  const [bookData, setBookData] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [chapterStatuses, setChapterStatuses] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [chapterContent, setChapterContent] = useState([]);
  const [editedVerses, setEditedVerses] = useState({});
  const [selectedBook, setSelectedBook] = useState("");
  const [selectedChapter, setSelectedChapter] = useState(null);

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

        let status = book.status;
        if (allChaptersApproved) {
          status = "Approved";
        } else if (allChaptersTranscribed) {
          status = "Transcribed";
        }

        return allChaptersApproved || allChaptersTranscribed
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
          String(chapter.chapterNumber) === String(currentChapter.chapterNumber)
        ) {
          const { verseNumber } = extractChapterVerse(
            currentVerse.audioFileName
          );

          return `[${verseNumber} out of ${chapter.verses.length}]`;
        }
      }
    }
    if (book.approved.length === book.totalChapters) {
      return "Approved";
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

  const handleLanguageChange = (language) => {
    setSelectedLanguage(language);
  };

  const isReady = projectInstance && selectedLanguage && bookData;

  const { startTranscription, currentChapter, currentVerse } =
    useAudioTranscription({
      projectInstance,
      selectedBook: bookData?.bookName,
      setBooks,
      bookData,
      selectedLanguage,
      setChapterStatuses,
      setProcessing,
      extractChapterVerse,
    });

  useEffect(() => {
    if (isReady && bookData) {
      startTranscription(bookData.chapters[0]);
    }
  }, [isReady, bookData]);

  const processBook = (name) => {
    const selectedData = files.find(({ bookName }) => bookName === name);
    if (!selectedLanguage) {
      Swal.fire("Error", "Please select a language", "error");
      setProcessing(false);
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
      chapterStatuses[chapterKey] === "Disapproved"
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
        book: selectedBook,
        chapter: verse.chapterNumber,
        verse: verse.verseNumber,
        transcribedText: editedText,
        isApproved: existingData?.isApproved,
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
      await projectInstance.setItem(storageKey, {
        book: selectedBook,
        chapter: verse.chapterNumber,
        verse: verse.verseNumber,
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

          if (isCurrentlyApproved) {
            // Remove from approved and add to transcribed
            const index = updatedApproved.indexOf(selectedChapter);
            if (index !== -1) updatedApproved.splice(index, 1);
            updatedTranscribed.push(selectedChapter);
          } else {
            // Remove from transcribed and add to approved
            const index = updatedTranscribed.indexOf(selectedChapter);
            if (index !== -1) updatedTranscribed.splice(index, 1);
            updatedApproved.push(selectedChapter);
          }
          const allChaptersApproved = book.displayChapters.every(
            (chapter) =>
              newChapterStatuses[`${book.name}-${chapter.chapterNumber}`] ===
              "Approved"
          );

          let status = "Transcribed";
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

  const downloadUSFM = (book) => {
    processUSFM(projectInstance, book.name, bibleMetaData);
  };

  const handleSpeechConversion = () => {
    console.log("text to audio conversion component will be called here");
    setModalOpen(false);
  }

  return (
    <Card sx={styles.cardRoot}>
      <Box sx={styles.header}>
        <Box sx={styles.TitleContainer}>
          <Typography variant="h4" sx={styles.headerTitle}>
            {projectName}
          </Typography>
          <Typography variant="h6">
            [source - {sourceLang ? sourceLang : "Not found"}]
          </Typography>
        </Box>
        <LanguageDropdown onLanguageChange={handleLanguageChange} />
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
              <StyledTableCell width="20%">
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
                  <Typography color="primary" fontWeight={500}>
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
                <StyledTableCell>
                  <Button
                    variant="outlined"
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
            </Box>
          ))}
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "20px",
              gap: 2,
            }}
          >
            <Button variant="contained" onClick={handleCloseModal}>
              Close
            </Button>
            <Button variant="contained" onClick={handleChapterApproval}>
              {chapterStatuses[`${selectedBook}-${selectedChapter}`] ===
              "Approved"
                ? "Disapprove"
                : "Approve"}
            </Button>
            <Button variant="contained" onClick={handleSpeechConversion}>
              Convert to speech
            </Button>
          </Box>
        </Box>
      </Modal>

      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "40px",
        }}
      >
        <Button variant="contained" sx={styles.downloadButton}>
          Download Project
        </Button>
      </Box>
    </Card>
  );
};

export default BooksList;
