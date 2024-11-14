import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const ffmpeg = new FFmpeg({ log: true });

export async function convertAudioFile(file, inputFileName, targetFormat) {
  try {
    // Load the FFmpeg library if it's not already loaded
    await ffmpeg.load();

    // Fetch the audio file data and write it to FFmpeg's in-memory filesystem
    const audioData = await fetchFile(file);
    const inputExtension = inputFileName.split('.').pop();
    const ffmpegInputFile = `input.${inputExtension}`;
    await ffmpeg.writeFile(ffmpegInputFile, audioData);

    // Define the output file name and conversion options
    const outputFileName = `output.${targetFormat}`;
    const outputOptions = [
      '-ac', '1',       // Convert to mono channel
      '-ar', '48000',   // Set sample rate to 48 kHz
    ];

    // Run the FFmpeg conversion command
    await ffmpeg.exec([
      '-i', ffmpegInputFile,
      ...outputOptions,
      outputFileName
    ]);

    // Retrieve the converted file data
    const outputData = await ffmpeg.readFile(outputFileName);

    // Create a new Blob with the converted data, set the correct MIME type
    const convertedBlob = new Blob([outputData.buffer], { type: `audio/${targetFormat}` });

    await ffmpeg.terminate();

    // Return the converted Blob as a File for further use
    return convertedBlob;
  } catch (error) {
    console.error("Error during audio conversion:", error);
    throw error;
  }
}
