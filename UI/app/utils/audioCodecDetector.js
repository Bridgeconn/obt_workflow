export class AudioCodecDetector {
    // Common audio file signatures
    static SIGNATURES = {
      // WebM/EBML header
      EBML: [0x1A, 0x45, 0xDF, 0xA3], // WebM/Matroska header
      
      // Opus in Ogg container
      OGG: [0x4F, 0x67, 0x67, 0x53], // "OggS"
      OPUS_HEAD: [0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], // "OpusHead"
    };
  
    static async detectCodec(blob) {
      try {
  
        // First check MIME type as it's most reliable for Opus
        const mimeCodec = this.getCodecFromMimeType(blob.type);
        if (mimeCodec !== 'Unknown') {
          console.log('Codec detected from MIME type:', mimeCodec);
          return mimeCodec;
        }
  
        // Read a larger portion of the file for Opus detection
        const buffer = await this.readFileHeader(blob);
        const codec = await this.identifyCodecFromSignature(buffer, blob);
        
        return codec;
      } catch (error) {
        console.error('Error detecting codec:', error);
        return 'Unknown';
      }
    }
  
    static getCodecFromMimeType(mimeType) {
      const mimeCodecMap = {
        'audio/webm': 'Opus',
        'audio/webm; codecs="opus"': 'Opus',
        'audio/ogg': 'Ogg',
        'audio/ogg; codecs="opus"': 'Opus',
        'audio/opus': 'Opus',
      };
  
      // Check for Opus in the codecs parameter
      if (mimeType.includes('opus')) {
        return 'Opus';
      }
  
      return mimeCodecMap[mimeType] || 'Unknown';
    }
  
    static async readFileHeader(blob) {
      // Read first 4KB to catch container metadata
      const headerSize = Math.min(4096, blob.size);
      const headerBlob = blob.slice(0, headerSize);
      const buffer = await headerBlob.arrayBuffer();
      return new Uint8Array(buffer);
    }
  
    static async identifyCodecFromSignature(header, blob) {
      // Check for WebM/EBML header (common container for Opus)
      if (this.matchSignature(header, this.SIGNATURES.EBML, 0)) {
        console.log('WebM/EBML container detected');
        return 'Opus'; // WebM usually contains Opus for audio
      }
      
      // Check for Opus in Ogg container
      if (this.matchSignature(header, this.SIGNATURES.OGG, 0)) {
        // Search for "OpusHead" in the first 4KB
        for (let i = 0; i < header.length - 8; i++) {
          if (this.matchSignature(header, this.SIGNATURES.OPUS_HEAD, i)) {
            console.log('Opus in Ogg container detected');
            return 'Opus';
          }
        }
      }
  
      // If we still haven't identified it, try reading metadata using Web Audio API
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await blob.arrayBuffer();
        await audioContext.decodeAudioData(arrayBuffer, 
          (audioBuffer) => {
            console.log('Audio format details:', {
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: audioBuffer.numberOfChannels,
              length: audioBuffer.length,
              duration: audioBuffer.duration
            });
          },
          (error) => {
            console.error('Error decoding audio:', error);
          }
        );
      } catch (error) {
        console.error('Web Audio API detection failed:', error);
      }
  
      return 'Unknown';
    }
  
    static matchSignature(header, signature, offset) {
      return signature.every((byte, index) => header[offset + index] === byte);
    }
  }