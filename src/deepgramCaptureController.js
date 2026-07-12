(function initDeepgramCaptureController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.deepgramCaptureController = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEEPGRAM_AUDIO_TIMESLICE_MS = 500;
  const DEEPGRAM_RECORDER_DRAIN_TIMEOUT_MS = 1000;
  const DEEPGRAM_ROLE_THEM = 'Them';
  const DEEPGRAM_ROLE_ME = 'Me';

  class DeepgramCaptureController {
    constructor({
      mediaDevices,
      MediaRecorderImpl,
      MediaStreamImpl,
      sendAudioChunk,
      onFailure = () => {},
      recorderMimeType = '',
      timesliceMs = DEEPGRAM_AUDIO_TIMESLICE_MS,
      recorderDrainTimeoutMs = DEEPGRAM_RECORDER_DRAIN_TIMEOUT_MS,
      setTimeoutFn = setTimeout,
      clearTimeoutFn = clearTimeout
    } = {}) {
      this.mediaDevices = mediaDevices;
      this.MediaRecorderImpl = MediaRecorderImpl;
      this.MediaStreamImpl = MediaStreamImpl;
      this.sendAudioChunk = sendAudioChunk;
      this.onFailure = onFailure;
      this.recorderMimeType = recorderMimeType;
      this.timesliceMs = timesliceMs;
      this.recorderDrainTimeoutMs = recorderDrainTimeoutMs;
      this.setTimeoutFn = setTimeoutFn;
      this.clearTimeoutFn = clearTimeoutFn;
      this.generation = 0;
      this.state = 'inactive';
      this.startPromise = null;
      this.recorders = new Set();
      this.ownedTracks = new Set();
      this.stoppedTracks = new Set();
      this.pendingChunkSends = new Set();
      this.failurePromise = null;
    }

    isActive() {
      return this.state === 'active';
    }

    ownStream(stream) {
      for (const track of stream?.getTracks?.() || []) {
        if (!this.ownedTracks.has(track) && track?.kind === 'audio') {
          track.addEventListener?.('ended', () => {
            if (!this.stoppedTracks.has(track) && (this.state === 'starting' || this.state === 'active')) {
              this.handleFailure(new Error('Deepgram audio track ended unexpectedly.'));
            }
          }, { once: true });
        }
        this.ownedTracks.add(track);
      }
      return stream;
    }

    stopTrackOnce(track) {
      if (!track || this.stoppedTracks.has(track)) {
        return;
      }

      this.stoppedTracks.add(track);
      try {
        track.stop?.();
      } catch (_) {
        // Track ownership still ends even if the platform stop call throws.
      }
    }

    releaseOwnedTracks() {
      for (const track of this.ownedTracks) {
        this.stopTrackOnce(track);
      }
      this.ownedTracks.clear();
    }

    createAudioOnlyStream(sourceStream) {
      const audioTracks = sourceStream?.getAudioTracks?.() || [];
      if (audioTracks.length === 0) {
        return null;
      }
      return this.ownStream(new this.MediaStreamImpl(audioTracks));
    }

    queueRecorderChunk(role, blob, recorder) {
      if (!this.recorders.has(recorder) || !blob || blob.size <= 0) {
        return;
      }

      const sendPromise = Promise.resolve(blob.arrayBuffer())
        .then((chunk) => {
          if (!this.recorders.has(recorder)) {
            return undefined;
          }
          return this.sendAudioChunk?.(role, chunk);
        });
      this.pendingChunkSends.add(sendPromise);
      sendPromise
        .catch((error) => {
          if (this.recorders.has(recorder) && (this.state === 'starting' || this.state === 'active')) {
            this.handleFailure(error);
          }
        })
        .finally(() => this.pendingChunkSends.delete(sendPromise));
    }

    createRecorder(role, stream) {
      const recorder = this.recorderMimeType
        ? new this.MediaRecorderImpl(stream, { mimeType: this.recorderMimeType })
        : new this.MediaRecorderImpl(stream);

      recorder.addEventListener('dataavailable', (event) => {
        this.queueRecorderChunk(role, event?.data, recorder);
      });
      recorder.addEventListener('error', (event) => {
        if (this.recorders.has(recorder) && (this.state === 'starting' || this.state === 'active')) {
          this.handleFailure(event?.error || event || new Error('Deepgram recorder failed.'));
        }
      });
      recorder.start(this.timesliceMs);
      this.recorders.add(recorder);
      return recorder;
    }

    async start() {
      if (this.isActive()) {
        return true;
      }
      if (this.startPromise) {
        return this.startPromise;
      }
      if (!this.mediaDevices?.getDisplayMedia || !this.mediaDevices?.getUserMedia) {
        throw new Error('Media capture is not available in this browser context.');
      }

      const generation = ++this.generation;
      this.state = 'starting';
      this.startPromise = this.startCapture(generation)
        .finally(() => {
          this.startPromise = null;
        });
      return this.startPromise;
    }

    async startCapture(generation) {
      try {
        const displayStream = this.ownStream(await this.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        }));
        const systemAudioStream = this.createAudioOnlyStream(displayStream);
        for (const videoTrack of displayStream?.getVideoTracks?.() || []) {
          this.stopTrackOnce(videoTrack);
        }

        if (generation !== this.generation) {
          this.releaseOwnedTracks();
          return false;
        }

        const microphoneStream = this.ownStream(await this.mediaDevices.getUserMedia({
          audio: true
        }));
        const microphoneAudioStream = this.createAudioOnlyStream(microphoneStream);
        if (!microphoneAudioStream) {
          throw new Error('Deepgram capture requires microphone access.');
        }

        if (generation !== this.generation) {
          this.releaseOwnedTracks();
          return false;
        }

        if (systemAudioStream) {
          this.createRecorder(DEEPGRAM_ROLE_THEM, systemAudioStream);
        }
        this.createRecorder(DEEPGRAM_ROLE_ME, microphoneAudioStream);

        if (generation !== this.generation) {
          await this.stopRecordersAndTracks();
          return false;
        }

        this.state = 'active';
        return true;
      } catch (error) {
        await this.stopRecordersAndTracks();
        if (generation === this.generation) {
          this.state = 'inactive';
        }
        throw error;
      }
    }

    waitForRecorderStop(recorder) {
      if (!recorder || recorder.state === 'inactive') {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        recorder.addEventListener('stop', resolve, { once: true });
        try {
          recorder.stop();
        } catch (_) {
          resolve();
        }
      });
    }

    async stopRecordersAndTracks() {
      const recorderStops = [...this.recorders].map((recorder) => this.waitForRecorderStop(recorder));
      if (recorderStops.length > 0) {
        let timeoutId;
        await Promise.race([
          Promise.allSettled(recorderStops).then(() => Promise.allSettled([...this.pendingChunkSends])),
          new Promise((resolve) => {
            timeoutId = this.setTimeoutFn(resolve, this.recorderDrainTimeoutMs);
          })
        ]);
        if (timeoutId !== undefined) {
          this.clearTimeoutFn(timeoutId);
        }
      }

      this.recorders.clear();
      this.releaseOwnedTracks();
    }

    async stop() {
      this.generation += 1;
      if (this.state === 'inactive' && this.recorders.size === 0 && this.ownedTracks.size === 0) {
        return false;
      }

      this.state = 'stopping';
      await this.stopRecordersAndTracks();
      this.state = 'inactive';
      return true;
    }

    handleFailure(rawError) {
      if (this.failurePromise) {
        return this.failurePromise;
      }

      const error = rawError instanceof Error
        ? rawError
        : new Error(String(rawError || 'Deepgram capture failed.'));
      this.failurePromise = this.stop()
        .then(() => this.onFailure(error))
        .finally(() => {
          this.failurePromise = null;
        });
      return this.failurePromise;
    }
  }

  return {
    DEEPGRAM_AUDIO_TIMESLICE_MS,
    DEEPGRAM_RECORDER_DRAIN_TIMEOUT_MS,
    DeepgramCaptureController
  };
});
