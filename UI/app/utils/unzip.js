import JSZip from "jszip";

export const unzipBlob = async (blob) => {
  const zip = new JSZip();
  const files = await zip.loadAsync(blob);
  const unzippedFiles = [];

  for (const filename of Object.keys(files.files)) {
    const fileData = await files.files[filename].async("blob");
    unzippedFiles.push({
      name: filename,
      data: fileData,
    });
  }

  return unzippedFiles;
};