import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

const ffmpeg = new FFmpeg({ log: true });

export const convertAudio = async (inputFile) => {
  try {
    await ffmpeg.load();

    const audioData = await fetchFile(inputFile);
    await ffmpeg.writeFile("audio_0.wav", audioData);

    // Execute the conversion command
    await ffmpeg.exec([
      "-i", "audio_0.wav",
      "-ar", "48000", // Set sample rate to 48 kHz
      "-ac", "1",     // Convert to mono
      "-sample_fmt", "s16", // Set sample format to 16-bit PCM
      "output.wav"    // Output file name
    ]);

    // Read the converted file
    const outputData = await ffmpeg.readFile("output.wav");

    // Return the converted file as a Blob
    return new Blob([outputData.buffer], { type: "audio/wav" });
  } catch (error) {
    console.error("Error during audio conversion:", error);
    throw error;
  }
};