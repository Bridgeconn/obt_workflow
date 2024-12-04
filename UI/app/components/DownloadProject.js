import { Button } from "@mui/material";
import { styles } from "../StyledComponents";
import JSZip from "jszip";
import { processUSFM } from "../utils/usfmProcessor";
import Swal from "sweetalert2";

const DownloadProject = ({
  projectName,
  projectInstance,
  jsonFiles,
  licenseData,
}) => {
  const downloadProject = async () => {
    const zip = new JSZip();
    // const projectFolder = zip.folder(projectName);
    const textFolder = zip.folder("text-1");
    const audioFolder = zip.folder("audio");
    const audioIngredientsFolder = audioFolder?.folder("ingredients");
    const textIngredientsFolder = textFolder?.folder("ingredients");
    let metaData;
    let versification;
    let projectSetting;

    console.log("json files", jsonFiles);
    console.log("licenseData", licenseData);

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

      console.log("fetched data from indexed db", fetchedData);

      for (const data of fetchedData) {
        if (!data?.book) continue;

        console.log("processing data for book:", data.book);

        // const bookTextFolder = textFolder?.folder(data.book);
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
          const audioExtension = data.generatedAudio.name.split('.').pop();
          const audioFileName = `${data.chapter}_${data.verse}.${audioExtension}`
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
    >
      Download Project
    </Button>
  );
};

export default DownloadProject;
