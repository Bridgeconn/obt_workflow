"use client";
import { useState, useEffect } from "react";
import localforage from "localforage";
import Swal from "sweetalert2";
import { Container, Box, Typography } from "@mui/material";
import DragAndDrop from "./components/DragAndDrop";
import BooksList from "./components/BooksList";
import AppBar from "@mui/material/AppBar";

export default function Home() {
  const [files, setFiles] = useState([]);
  const [jsonFiles, setJsonFiles] = useState([]);
  const [maxVerses, setMaxVerses] = useState(null);
  const [bibleMetaData, setBibleMetadata] = useState(null);
  const [projectName, setProjectName] = useState("");
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

  return (
    <>
      <AppBar
        color="transparent"
        sx={(theme) => ({
          position: "static",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          p: 4,
          pb: 2,
          boxShadow: "unset",
          borderBottom: `1px solid ${theme.palette.grey[300]}`,
        })}
      >
        <Typography
          variant="h4"
          sx={{
            display: { md: "flex" },
            fontFamily: "Arial",
            fontWeight: 700,
          }}
        >
          AI OBT Assistant
        </Typography>
      </AppBar>
      {files.length === 0 ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "85vh",
            minWidth: "100vw",
            padding: 2,
          }}
        >
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
        </Box>
      ) : (
        <Box>
          <BooksList
            projectInstance={projectDB}
            files={files}
            setFiles={setFiles}
            projectName={projectName}
            bibleMetaData={bibleMetaData}
          />
        </Box>
      )}
    </>
  );
}
