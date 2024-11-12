export class OpusToWavConverter {
  constructor() {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  async convertOpusToWav(opusBlob) {
      try {
          // First decode the opus file to audio buffer
          const audioBuffer = await this.decodeOpusToAudioBuffer(opusBlob);

          // Resample to 48kHz if necessary and mix to mono
          const resampledBuffer = await this.resampleTo48kHz(audioBuffer);
          const monoBuffer = await this.convertToMono(resampledBuffer);

          // Convert the audio buffer to WAV format
          const wavBlob = await this.audioBufferToWav(monoBuffer);

          return wavBlob;
      } catch (error) {
          console.error('Error converting Opus to WAV:', error);
          throw error;
      }
  }

  // Decode Opus file into an audio buffer
  async decodeOpusToAudioBuffer(opusBlob) {
      const arrayBuffer = await opusBlob.arrayBuffer();
      return new Promise((resolve, reject) => {
          this.audioContext.decodeAudioData(arrayBuffer, (audioBuffer) => {
              if (audioBuffer) {
                  resolve(audioBuffer);
              } else {
                  reject(new Error('Failed to decode Opus file.'));
              }
          }, (error) => {
              reject(new Error('Error decoding Opus file: ' + error));
          });
      });
  }

  // Resample audio to 48kHz if needed
  async resampleTo48kHz(audioBuffer) {
      if (audioBuffer.sampleRate === 48000) {
          return audioBuffer; // No resampling needed if already 48kHz
      }

      // Create a new audio context to resample
      const offlineContext = new OfflineAudioContext(
          audioBuffer.numberOfChannels,
          audioBuffer.length,
          48000 // Desired sample rate of 48kHz
      );

      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineContext.destination);
      source.start();

      // Render the resampled audio
      const renderedBuffer = await offlineContext.startRendering();
      return renderedBuffer;
  }

  // Convert multi-channel audio buffer to mono
  async convertToMono(audioBuffer) {
      if (audioBuffer.numberOfChannels === 1) {
          return audioBuffer; // No need to convert if already mono
      }

      const monoBuffer = this.audioContext.createBuffer(
          1, // 1 channel (mono)
          audioBuffer.length,
          audioBuffer.sampleRate
      );

      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = audioBuffer.getChannelData(1);
      const monoData = monoBuffer.getChannelData(0);

      // Mix down stereo to mono (average both channels)
      for (let i = 0; i < audioBuffer.length; i++) {
          monoData[i] = (leftChannel[i] + rightChannel[i]) / 2;
      }

      return monoBuffer;
  }

  // Convert AudioBuffer to WAV format
  audioBufferToWav(audioBuffer) {
      const numberOfChannels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length * numberOfChannels * 2; // 2 bytes per sample (16-bit PCM)
      const buffer = new ArrayBuffer(44 + length); // 44 bytes for WAV header
      const view = new DataView(buffer);
      const channels = [];
      let offset = 0;

      // Get audio channels
      for (let i = 0; i < numberOfChannels; i++) {
          channels.push(audioBuffer.getChannelData(i));
      }

      // Write WAV header
      setUint8Array(view, 0, [0x52, 0x49, 0x46, 0x46]); // "RIFF"
      view.setUint32(4, 36 + length, true); // File size
      setUint8Array(view, 8, [0x57, 0x41, 0x56, 0x45]); // "WAVE"
      setUint8Array(view, 12, [0x66, 0x6D, 0x74, 0x20]); // "fmt "
      view.setUint32(16, 16, true); // Format chunk length
      view.setUint16(20, 1, true); // Format type (PCM)
      view.setUint16(22, numberOfChannels, true); // Number of channels (1 for mono)
      view.setUint32(24, 48000, true); // Sample rate 48kHz
      view.setUint32(28, 48000 * 2 * numberOfChannels, true); // Byte rate
      view.setUint16(32, numberOfChannels * 2, true); // Block align
      view.setUint16(34, 16, true); // Bits per sample (16-bit)
      setUint8Array(view, 36, [0x64, 0x61, 0x74, 0x61]); // "data"
      view.setUint32(40, length, true); // Data chunk length

      // Write audio data (16-bit PCM)
      offset = 44;
      for (let i = 0; i < audioBuffer.length; i++) {
          for (let channel = 0; channel < numberOfChannels; channel++) {
              let sample = Math.max(-1, Math.min(1, channels[channel][i]));
              sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
              view.setInt16(offset, sample, true); // Little-endian 16-bit PCM
              offset += 2;
          }
      }

      // Return the resulting WAV file as a Blob
      return new Blob([buffer], { type: 'audio/wav' });
  }
}

// Helper function to write uint8 arrays to DataView
function setUint8Array(view, offset, arr) {
  arr.forEach((value, index) => {
      view.setUint8(offset + index, value);
  });
}
