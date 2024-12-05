import { useState, useEffect } from "react";
import { Button } from "@mui/material";
import { styles } from "../StyledComponents";
import JSZip from "jszip";
import { processUSFM } from "../utils/usfmProcessor";
import Swal from "sweetalert2";

const DownloadProject = ({
  projectName,
  projectInstance,
  books,
  jsonFiles,
  licenseData,
  isConverting,
  isTranscribing,
}) => {
  const [isDownloadReady, setIsDownloadReady] = useState(false);

  useEffect(() => {
    const validateBooksCompletion = async () => {
      try {
        const keys = await projectInstance.keys();
        const fetchedData = (
          await Promise.all(keys.map((key) => projectInstance.getItem(key)))
        ).filter((data) => data !== null);
  
        const bookDataMap = {};
        fetchedData.forEach((data) => {
          if (!data.book) return;
          if (!bookDataMap[data.book]) {
            bookDataMap[data.book] = [];
          }
          bookDataMap[data.book].push(data);
        });
  
        const areBooksDownloadable = books.map((book) => {
          const records = bookDataMap[book.name] || [];
  
          const chaptersStatus = book.displayChapters.map((chapter) => {
            const chapterRecords = records.filter(
              (record) => record.chapter === chapter.chapterNumber
            );
  
            const totalVersesInChapter = chapter.verses.length;
            const completedVerses = chapterRecords.filter(
              (record) => record.transcribedText && record.generatedAudio
            ).length;
            const approvedVerses = chapterRecords.filter(
              (record) =>
                record.transcribedText &&
                record.generatedAudio &&
                record.isApproved
            ).length;
  
            return {
              chapterNumber: chapter.chapterNumber,
              isConvertible: completedVerses === totalVersesInChapter,
              isApproved: approvedVerses === totalVersesInChapter,
            };
          });
  
          const isBookReady = chaptersStatus.some(
            (status) => status.isConvertible || status.isApproved
          );
  
          return isBookReady;
        });
  
        setIsDownloadReady(areBooksDownloadable.some((ready) => ready));
      } catch (error) {
        console.error("Error validating book completion:", error);
        setIsDownloadReady(false);
      }
    };
  
    if (books.length > 0) {
      validateBooksCompletion();
    } else {
      setIsDownloadReady(false);
    }
  }, [books, projectInstance]);
  

  const downloadProject = async () => {
    const zip = new JSZip();
    const textFolder = zip.folder("text-1");
    const audioFolder = zip.folder("audio");
    const audioIngredientsFolder = audioFolder?.folder("ingredients");
    const textIngredientsFolder = textFolder?.folder("ingredients");
    let metaData;
    let versification;
    let projectSetting;

    if (licenseData) {
      textIngredientsFolder?.file("license.md", licenseData);
      audioIngredientsFolder?.file("license.md", licenseData);
    }

    for (const json of jsonFiles) {
      if (json?.name.endsWith("metadata.json")) {
        metaData = json?.content || null;
        zip.file("metadata.json", JSON.stringify(metaData, null, 2));
        textFolder?.file("metadata.json", JSON.stringify(metaData, null, 2));
      } else if (json?.name.endsWith("versification.json")) {
        versification = json?.content || null;
        textIngredientsFolder?.file(
          "versification.json",
          JSON.stringify(versification, null, 2)
        );
        audioIngredientsFolder?.file(
          "versification.json",
          JSON.stringify(versification, null, 2)
        );
      } else if (
        json?.name.endsWith("ag-settings.json") ||
        json?.name.endsWith("scribe-settings.json")
      ) {
        projectSetting = json?.content || null;
        const fileName = json?.name.endsWith("scribe-settings.json")
          ? "scribe-settings.json"
          : "ag-settings.json";

        textIngredientsFolder?.file(
          fileName,
          JSON.stringify(projectSetting, null, 2)
        );
        audioIngredientsFolder?.file(
          fileName,
          JSON.stringify(projectSetting, null, 2)
        );
      }
    }

    try {
      const keys = await projectInstance.keys();
      const fetchedData = (
        await Promise.all(keys.map((key) => projectInstance.getItem(key)))
      ).filter((data) => data !== null);

      for (const data of fetchedData) {
        if (!data?.book) continue;

        const usfmBookData = await processUSFM(
          projectInstance,
          data.book,
          false
        );
        if (usfmBookData) {
          const encoder = new TextEncoder();
          const usfmBytes = encoder.encode(usfmBookData);

          textIngredientsFolder?.file(`${data.book}.usfm`, usfmBytes, {
            binary: true,
            compression: "DEFLATE",
            compressionOptions: {
              level: 6,
            },
            comment: "UTF-8 encoded USFM file",
          });
        }

        if (data?.generatedAudio) {
          const bookAudioFolder = audioIngredientsFolder?.folder(data.book);
          const chapterFolder = bookAudioFolder?.folder(data.chapter);
          const audioBlob = await data.generatedAudio.arrayBuffer();
          const audioExtension = data.generatedAudio.name.split(".").pop();
          const audioFileName = `${data.chapter}_${data.verse}.${audioExtension}`;
          chapterFolder?.file(audioFileName, audioBlob);
        }
      }

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 6,
        },
      });

      const blobUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${projectName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Error during project download:", error);
      Swal.fire("Error", `Error during downloading project`, "error");
    }
  };

  return (
    <Button
      variant="contained"
      sx={styles.downloadButton}
      onClick={downloadProject}
      disabled={!isDownloadReady || isConverting || isTranscribing}
    >
      Download Project
    </Button>
  );
};

export default DownloadProject;
