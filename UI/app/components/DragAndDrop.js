"use client";
import React, { useState } from "react";
import { useDropzone } from "react-dropzone";
import { Box } from "@mui/material";
import JSZip from "jszip";

const DragAndDrop = ({ onFilesExtracted }) => {
  const [fileName, setFileName] = useState("");

  const isAudioFile = (fileName) => /\.(mp3|wav|ogg|m4a)$/i.test(fileName);

  const handleZipFileProcessing = async (file) => {
    try {
      const zip = new JSZip();
      const zipContents = await zip.loadAsync(file);
      const extractedBooks = [];
      const jsonFiles = [];
      let maxVersesData = {};
      let bibleMetaData = {};
      let projectName = "";
      let sourceLanguage = "";

      console.log("Zip contents:", zipContents.files);

      const processAudioFile = (
        bookName,
        chapterName,
        audioFileName,
        fileData
      ) => {
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

        existingChapter.verses.push({ audioFileName, file: fileData });
      };

      for (const relativePath in zipContents.files) {
        const file = zipContents.files[relativePath];
        if (file.dir === false) {
          const pathParts = relativePath.split("/");

          if (!projectName) projectName = pathParts[0];

          if (relativePath.endsWith(".json")) {
            const fileData = await file.async("string");
            const parsedContent = JSON.parse(fileData);
            jsonFiles.push({ name: file.name, content: parsedContent });

            if (
              (pathParts[1] === "ingredients" ||
                (pathParts[1] === "audio" && pathParts[2] === "ingredients")) &&
              file.name.endsWith("versification.json")
            ) {
              try {
                const maxVerses = parsedContent["maxVerses"];
                maxVersesData =
                  typeof maxVerses === "string"
                    ? JSON.parse(maxVerses)
                    : maxVerses;
              } catch (e) {
                console.error("Error parsing maxVerses JSON:", e);
              }
            }

            if (
              pathParts[1] === "metadata.json" ||
              file.name.endsWith("metadata.json")
            ) {
              try {
                const localizedBibles = parsedContent["localizedNames"];
                bibleMetaData =
                  typeof localizedBibles === "string"
                    ? JSON.parse(localizedBibles)
                    : localizedBibles;
                sourceLanguage = parsedContent["languages"][0]?.name?.en
              } catch (e) {
                console.error("Error parsing metadata JSON:", e);
              }
            }
            continue;
          }

          if (pathParts[1] === "ingredients" && isAudioFile(file.name)) {
            processAudioFile(
              pathParts[2],
              pathParts[3],
              pathParts[4],
              await file.async("blob")
            );
          } else if (
            pathParts[1] === "audio" &&
            pathParts[2] === "ingredients" &&
            isAudioFile(file.name)
          ) {
            processAudioFile(
              pathParts[3],
              pathParts[4],
              pathParts[5],
              await file.async("blob")
            );
          }
        }
      }

      onFilesExtracted(
        extractedBooks,
        jsonFiles,
        projectName,
        maxVersesData,
        bibleMetaData,
        sourceLanguage
      );
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
        cursor: "pointer",
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
            : "Drag and drop your Scribe project ZIP file here, or click to browse and upload."}
        </p>
      )}
    </Box>
  );
};

export default DragAndDrop;
