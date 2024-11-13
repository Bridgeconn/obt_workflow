"use client";
import { useState, useEffect } from "react";
import localforage from "localforage";
import Swal from "sweetalert2";
import { Container, Box, Button } from "@mui/material";
import DragAndDrop from "./components/DragAndDrop";
import BooksList from "./components/BooksList";
import AudioTranscription from "./components/AudioTranscription";

export default function Home() {
  const [files, setFiles] = useState([]);
  const [jsonFiles, setJsonFiles] = useState([]);
  const [maxVerses, setMaxVerses] = useState(null);
  const [bibleMetaData, setBibleMetadata] = useState(null);
  const [selectedBook, setSelectedBook] = useState("");
  const [projectName, setProjectName] = useState("");
  const [bookData, setBookData] = useState(null);
  const [projectDB, setProjectDB] = useState(null);


  useEffect(() => {
    if (projectName) {
      const dbInstance = localforage.createInstance({
        name: projectName,
        storeName: "transcriptions",
      });
      setProjectDB(dbInstance);
    }
  }, [projectName]);

  const handleFilesExtracted = (
    extractedFiles,
    jsonFiles,
    projectName,
    maxVersesData,
    bibleMetaData
  ) => {
    setJsonFiles(jsonFiles);
    setProjectName(projectName);
    setMaxVerses(maxVersesData);
    setBibleMetadata(bibleMetaData);

    validateBooks(extractedFiles, maxVersesData);
    const sortedBooks = sortBooks(extractedFiles);
    setFiles(sortedBooks);
  };

  const sortBooks = (books) => {
    return books.map((book) => {
      const sortedChapters = book.chapters.map((chapter) => {
        const sortedVerses = chapter.verses.sort((a, b) => {
          const audioA = parseInt(
            a.audioFileName.split("_")[1].split(".")[0],
            10
          );
          const audioB = parseInt(
            b.audioFileName.split("_")[1].split(".")[0],
            10
          );
          return audioA - audioB;
        });
        return { ...chapter, verses: sortedVerses };
      });
      return { ...book, chapters: sortedChapters };
    });
  };

  function validateBooks(books, maxVersesData) {
    console.log("max verses", maxVersesData)
    for (const book of books) {
      const bookName = book.bookName;
      const maxChapters = maxVersesData[bookName];

      if (!maxChapters) {
        Swal.fire({
          icon: "warning",
          title: "Missing Data",
          text: `No max verse data for ${bookName} in maxVerses.`,
        });
        continue;
      }

      for (const chapter of book.chapters) {
        const chapterIndex = parseInt(chapter.chapterNumber) - 1;
        const expectedVerses = maxChapters[chapterIndex];

        if (expectedVerses == null) {
          Swal.fire({
            icon: "warning",
            title: "Missing Data",
            text: `No max verses data for ${bookName} chapter ${chapter.chapterNumber}.`,
          });
          continue;
        }

        const actualVerseCount = chapter.verses.length;

        if (actualVerseCount < expectedVerses) {
          Swal.fire({
            icon: "error",
            title: "Incomplete Data",
            text: `${bookName}, chapter ${chapter.chapterNumber} has ${actualVerseCount} verses; expected ${expectedVerses}.`,
          });
          return;
        }
      }
    }
    Swal.fire({
      icon: "success",
      title: "Validation Successful",
      text: "All books and chapters have the expected verse counts.",
    });
  }

  const handleBookSelection = (event) => {
    setSelectedBook(event.target.value);
  };

  const handleProcessing = () => {
    const selectedData = files.find(
      ({ bookName }) => bookName === selectedBook
    );
    if (selectedData) {
      setBookData(selectedData);
    }
  };

  const handleTranscriptionComplete = (storageKey, 
    { book, chapter, verse, transcribedText }
  ) => {
    const transcriptionData = {
      book: book,
      chapter: chapter,
      verse: verse,
      transcribedText: transcribedText,
    };

    const transcriptionKey = `${book}-${chapter}-${verse}`;
  
    projectDB
      .setItem(transcriptionKey, transcriptionData)
      .then(() => console.log(`Stored transcription for ${transcriptionKey} in project ${projectName}`))
      .catch((err) => console.error(`Failed to store transcription: ${err}`));
  };

  return (
    <Container
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        minWidth: "100vw",
        padding: 2,
      }}
    >
      {files.length === 0 ? (
        <Box
          sx={{
            width: { xs: "90vw", sm: "60vw" },
            height: { xs: "200px", sm: "300px" },
            padding: 2,
            border: "2px dashed #888",
            borderRadius: "8px",
            backgroundColor: "#f9f9f9",
          }}
        >
          <DragAndDrop onFilesExtracted={handleFilesExtracted} />
        </Box>
      ) : bookData ? (
        <Box
          sx={{
            width: "80vw",
            height: "auto",
            padding: 2,
            border: "2px solid #888",
            borderRadius: "8px",
            backgroundColor: "#f9f9f9",
          }}
        >
        
          <AudioTranscription
            projectInstance={projectDB}
            projectName={projectName}
            selectedBook={selectedBook}
            bookData={bookData}
            bibleMetaData={bibleMetaData}
            onTranscriptionComplete={handleTranscriptionComplete}
          />
        </Box>
      ) : (
        <Box
          sx={{
            width: "80vw",
            height: "auto",
            padding: 4,
            border: "2px solid #888",
            borderRadius: "8px",
            backgroundColor: "#f9f9f9",
          }}
        >
          <BooksList
            files={files}
            selectedBooks={selectedBook}
            handleBookSelection={handleBookSelection}
            projectName={projectName}
            jsonFiles={jsonFiles}
          />
          <Button
            variant="contained"
            color="primary"
            sx={{ marginTop: "20px", padding: "8px 16px" }}
            onClick={handleProcessing}
            disabled={!selectedBook}
          >
            Process
          </Button>
        </Box>
      )}
    </Container>
  );
}
