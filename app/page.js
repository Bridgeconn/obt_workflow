"use client";
import { useState } from "react";
import { Container, Box, Typography } from "@mui/material";
import DragAndDrop from "./components/DragAndDrop";
import BooksList from "./components/BooksList";

export default function Home() {
  const [files, setFiles] = useState([]);
  const [jsonFiles, setJsonFiles] = useState([]);
  const [selectedBook, setSelectedBook] = useState("");
  const [projectName, setProjectName] = useState("");

  const handleFilesExtracted = (extractedFiles, jsonFiles, projectName) => {
    console.log("Extracted books:", extractedFiles);
    console.log("Extracted JSON files:", jsonFiles);
    setFiles(extractedFiles);
    setJsonFiles(jsonFiles);
    setProjectName(projectName);
  };

  const handleBookSelection = (event) => {
    setSelectedBook(event.target.value);
    console.log("book", event.target.value)
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
            width: "100%",
            height: "300px",
            padding: 2,
            border: "2px dashed #888",
            borderRadius: "8px",
            backgroundColor: "#f9f9f9",
          }}
        >
          <DragAndDrop onFilesExtracted={handleFilesExtracted} />
        </Box>
      ) : (
        <Box
          sx={{
            width: "100%",
            height: "auto",
            padding: 2,
            border: "2px solid #888",
            borderRadius: "8px",
            backgroundColor: "#f9f9f9",
          }}
        >
          <BooksList
            files={files}
            selectedBook={selectedBook}
            handleBookSelection={handleBookSelection}
            projectName={projectName}
            jsonFiles={jsonFiles}
          />
        </Box>
      )}
    </Container>
  );
}
