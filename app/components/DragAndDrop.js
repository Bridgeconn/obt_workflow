"use client";
import React, { useState } from "react";
import { useDropzone } from "react-dropzone";
import { Box } from "@mui/material";
import JSZip from "jszip";

const DragAndDrop = ({ onFilesExtracted }) => {
  const [fileName, setFileName] = useState("");

  const isAudioFile = (fileName) => {
    const audioExtensions = /\.(mp3|wav|ogg|m4a)$/i;
    return audioExtensions.test(fileName);
  };

  const handleZipFileProcessing = async (file) => {
    try {
      const zip = new JSZip();
      const zipContents = await zip.loadAsync(file);
      const extractedBooks = [];
      const jsonFiles = [];
      let maxVersesData = {};
      let bibleMetaData = {};
      let projectName = "";
      
      console.log("Zip contents:", zipContents.files);

      for (const relativePath in zipContents.files) {
        const file = zipContents.files[relativePath];
        if (file.dir === false) {
          console.log("Found file: ", relativePath);

          const pathParts = relativePath.split("/");

          if (!projectName) {
            projectName = pathParts[0];
          }

          if (relativePath.endsWith(".json")) {
            const fileData = await file.async("string");
            const parsedContent = JSON.parse(fileData);
            jsonFiles.push({ name: file.name, content: parsedContent });
            // if (
            //   pathParts[1] === "audio" &&
            //   file.name.endsWith("versification.json")
            // ) 
            if (
              pathParts[1] === "ingredients" &&
              file.name.endsWith("versification.json")
            ) 
            {
              const maxVerses = parsedContent["maxVerses"];
              maxVersesData =
                typeof maxVerses === "string"
                  ? JSON.parse(maxVerses)
                  : maxVerses;
            }
            if (pathParts[1] === "metadata.json") {
              const localizedBibles = parsedContent["localizedNames"];
              bibleMetaData =
                typeof localizedBibles === "string"
                  ? JSON.parse(localizedBibles)
                  : localizedBibles;
            }
            continue;
          }

          // Only process audio files
          // if (
          //   pathParts[1] === "audio" &&
          //   pathParts[2] === "ingredients" &&
          //   isAudioFile(file.name)
          // )
          if (
            pathParts[1] === "ingredients" &&
            isAudioFile(file.name)
          ) 
          {
            const bookName = pathParts[2];
            const chapterName = pathParts[3];
            const audioFileName = pathParts[4];
            console.log("audio file", file);
            const fileData = await file.async("blob");

            let existingBook = extractedBooks.find(
              (book) => book.bookName === bookName
            );
            if (!existingBook) {
              existingBook = { bookName, chapters: [] };
              extractedBooks.push(existingBook);
            }

            let existingChapter = existingBook.chapters.find(
              (chapter) => chapter.chapterNumber === chapterName
            );
            if (!existingChapter) {
              existingChapter = { chapterNumber: chapterName, verses: [] };
              existingBook.chapters.push(existingChapter);
            }

            existingChapter.verses.push({
              audioFileName,
              file: fileData,
            });
          }
        }
      }

      console.log("Extracted books:", extractedBooks);
      console.log("Stored JSON files:", jsonFiles);

      onFilesExtracted(extractedBooks, jsonFiles, projectName, maxVersesData, bibleMetaData);
    } catch (error) {
      console.error("Error extracting zip file:", error);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: async (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];

        if (file && file.name.endsWith(".zip")) {
          setFileName(file.name);
          await handleZipFileProcessing(file);
        } else {
          setFileName("");
          console.error("Please upload a valid zip file.");
        }
      } else {
        console.warn("No files dropped.");
      }
    },
    accept: ".zip",
    onDropRejected: () => {
      setFileName("");
      console.error("Only .zip files are allowed.");
    },
  });

  return (
    <Box
      {...getRootProps()}
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        textAlign: "center",
        alignItems: "center",
        backgroundColor: isDragActive ? "#e0f7fa" : "#f9f9f9",
        transition: "background-color 0.2s ease",
      }}
    >
      <input {...getInputProps()} />
      {isDragActive ? (
        <p style={{ color: "#00796b" }}>Drop the zip file here...</p>
      ) : (
        <p>
          {fileName
            ? `Uploaded File: ${fileName}, Please wait`
            : "Drag and drop a zip file here, or click to select"}
        </p>
      )}
    </Box>
  );
};

export default DragAndDrop;
