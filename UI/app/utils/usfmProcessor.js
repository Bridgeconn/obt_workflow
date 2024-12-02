import Swal from "sweetalert2";
import LocalizedNames from "../store/localizedNames.json";

export const processUSFM = async (projectInstance, selectedBook, download = true) => {
  const keys = await projectInstance.keys();
  const filteredKeys = keys.filter((key) => key.startsWith(selectedBook));

  if (filteredKeys.length === 0) {
    Swal.fire("Content Unavailable", `Transcription for the book "${selectedBook}" is not available`, "error");
    return;
  }
  const fetchedData = (
    await Promise.all(filteredKeys.map((key) => projectInstance.getItem(key)))
  ).filter((data) => data !== null);

  // Sort data by chapter and verse
  const sortedData = fetchedData.sort((a, b) => {
    if (a.chapter === b.chapter) {
      return a.verse - b.verse; // Sort by verse if chapters are the same
    }
    return a.chapter - b.chapter; // Sort by chapter
  });
  const metaData = LocalizedNames[selectedBook]
  const usfmContent = generateUSFMContent(sortedData, selectedBook, metaData);

 if (download) {
    const blob = new Blob([usfmContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedBook}.usfm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else {
    return usfmContent;
  }
};

const generateUSFMContent = (sortedData, selectedBook, metaData) => {
  let usfmText = `\\id ${selectedBook}\n\\usfm 3.0\n\\ide UTF-8\n\\h ${metaData?.short?.en}\n\\toc1 ${metaData?.abbr?.en}\n\\toc2 ${metaData?.short?.en}\n\\toc3 ${metaData?.long?.en}\n\\mt ${metaData?.abbr?.en}\n`;

  let currentChapter = null;
  sortedData.forEach((entry) => {
    if (entry.chapter !== currentChapter) {
      usfmText += `\\c ${entry.chapter}\n\\p\n`;
      currentChapter = entry.chapter;
    }
    usfmText += `\\v ${entry.verse} ${entry.transcribedText}\n`;
  });

  return usfmText;
};
