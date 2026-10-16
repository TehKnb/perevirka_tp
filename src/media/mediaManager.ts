import { config } from '../config';
import { getSupportProblem, readSupportEnv } from '../env';
import {
  MediaAccessError,
  classifyMediaError,
  missingKind,
  type DeviceKind,
} from './mediaErrors';

export interface DeviceOption {
  deviceId: string;
  label: string;
}

function videoConstraints(deviceId?: string, withMin = true): MediaTrackConstraints {
  const c = config.camera;
  const constraints: MediaTrackConstraints = {
    width: withMin ? { ideal: c.idealWidth, min: c.minWidth } : { ideal: c.idealWidth },
    height: withMin ? { ideal: c.idealHeight, min: c.minHeight } : { ideal: c.idealHeight },
    frameRate: { ideal: c.idealFrameRate },
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  return constraints;
}

function audioConstraints(deviceId?: string): MediaTrackConstraints {
  const m = config.microphone;
  const constraints: MediaTrackConstraints = {
    echoCancellation: m.echoCancellation,
    noiseSuppression: m.noiseSuppression,
    autoGainControl: m.autoGainControl,
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  return constraints;
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Керує доступом до камери й мікрофона: перший запит, перемикання пристроїв,
 * розпізнавання помилок. Відео нікуди не записується.
 */
export class MediaManager {
  videoTrack: MediaStreamTrack | null = null;
  audioTrack: MediaStreamTrack | null = null;

  /** Пристрій відключили або він перестав працювати під час роботи сторінки. */
  onTrackEnded: ((kind: DeviceKind) => void) | null = null;
  /** Змінився список пристроїв (щось підключили чи відключили). */
  onDevicesChanged: (() => void) | null = null;

  private listening = false;

  /** Перший запит: камера й мікрофон одним викликом getUserMedia. */
  async start(): Promise<void> {
    const problem = getSupportProblem(readSupportEnv());
    if (problem) throw new MediaAccessError({ code: problem, kind: 'both' });

    this.stop();
    let stream: MediaStream;
    try {
      stream = await this.getMediaWithFallback(videoConstraintsFor(undefined), audioConstraints());
    } catch (err) {
      throw await this.diagnose(err, null);
    }
    const video = stream.getVideoTracks()[0];
    const audio = stream.getAudioTracks()[0];
    if (!video || !audio) {
      stopStream(stream);
      throw new MediaAccessError({ code: 'notFound', kind: video ? 'microphone' : 'camera' });
    }
    this.setVideoTrack(video);
    this.setAudioTrack(audio);
    this.listenDeviceChanges();
  }

  /** Перемикає камеру. Стара камера працює, доки нова не ввімкнулася. */
  async switchCamera(deviceId: string): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await this.getMediaWithFallback(videoConstraintsFor(deviceId), false);
    } catch (err) {
      throw await this.diagnose(err, 'camera');
    }
    const track = stream.getVideoTracks()[0];
    if (!track) throw new MediaAccessError({ code: 'notFound', kind: 'camera' });
    this.videoTrack?.stop();
    this.setVideoTrack(track);
  }

  /** Перемикає мікрофон. Старий працює, доки новий не ввімкнувся. */
  async switchMicrophone(deviceId: string): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
    } catch (err) {
      throw await this.diagnose(err, 'microphone');
    }
    const track = stream.getAudioTracks()[0];
    if (!track) throw new MediaAccessError({ code: 'notFound', kind: 'microphone' });
    this.audioTrack?.stop();
    this.setAudioTrack(track);
  }

  async listDevices(): Promise<{ cameras: DeviceOption[]; microphones: DeviceOption[] }> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind: MediaDeviceKind) =>
      devices
        .filter((d) => d.kind === kind && d.deviceId)
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    return { cameras: pick('videoinput'), microphones: pick('audioinput') };
  }

  get videoDeviceId(): string | undefined {
    return this.videoTrack?.getSettings().deviceId;
  }

  get audioDeviceId(): string | undefined {
    return this.audioTrack?.getSettings().deviceId;
  }

  /** Назва мікрофона, що зараз використовується (порожня, якщо браузер її не дав). */
  get audioLabel(): string {
    return this.audioTrack?.label ?? '';
  }

  get videoLabel(): string {
    return this.videoTrack?.label ?? '';
  }

  stop() {
    this.videoTrack?.stop();
    this.audioTrack?.stop();
    this.videoTrack = null;
    this.audioTrack = null;
  }

  /**
   * Запит із мінімальною роздільністю. Якщо камера не дає 1280×720, браузер кидає
   * OverconstrainedError — тоді повторюємо без мінімуму, щоб людина побачила картинку,
   * а критерій роздільності просто не пройде і ми запропонуємо іншу камеру.
   */
  private async getMediaWithFallback(
    makeVideo: (withMin: boolean) => MediaTrackConstraints,
    audio: MediaTrackConstraints | false,
  ): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: makeVideo(true), audio });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name !== 'OverconstrainedError') throw err;
      return navigator.mediaDevices.getUserMedia({ video: makeVideo(false), audio });
    }
  }

  /** Уточнює, якого саме пристрою стосується помилка спільного запиту. */
  private async diagnose(err: unknown, knownKind: DeviceKind | null): Promise<MediaAccessError> {
    const info = classifyMediaError(err, knownKind ?? 'both');
    if (knownKind) return new MediaAccessError(info, err);

    if (info.code === 'notFound') {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      info.kind = missingKind(devices);
    } else if (info.code === 'busy') {
      info.kind = await this.probeBusyKind();
    }
    return new MediaAccessError(info, err);
  }

  /** Пробуємо лише камеру: якщо вмикається, то зайнятий мікрофон. */
  private async probeBusyKind(): Promise<DeviceKind> {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      stopStream(probe);
      return 'microphone';
    } catch {
      return 'camera';
    }
  }

  private setVideoTrack(track: MediaStreamTrack) {
    this.videoTrack = track;
    track.addEventListener('ended', () => {
      if (this.videoTrack === track) this.onTrackEnded?.('camera');
    });
  }

  private setAudioTrack(track: MediaStreamTrack) {
    this.audioTrack = track;
    track.addEventListener('ended', () => {
      if (this.audioTrack === track) this.onTrackEnded?.('microphone');
    });
  }

  private listenDeviceChanges() {
    if (this.listening) return;
    this.listening = true;
    navigator.mediaDevices.addEventListener('devicechange', () => this.onDevicesChanged?.());
  }
}

function videoConstraintsFor(deviceId: string | undefined) {
  return (withMin: boolean) => videoConstraints(deviceId, withMin);
}
