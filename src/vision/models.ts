import { FaceLandmarker, FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
import { config } from '../config';
import { pickPersonMaskIndex } from './geometry';

export type Delegate = 'GPU' | 'CPU';

export interface VisionModels {
  face: FaceLandmarker;
  pose: PoseLandmarker;
  segmenter: ImageSegmenter;
  delegate: Delegate;
  /** Індекс маски «людина» серед confidenceMasks сегментатора. */
  personMaskIndex: number;
  /** Скільки мілісекунд зайняло завантаження. */
  loadMs: number;
}

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

async function create(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: Delegate) {
  const m = config.models;
  const created: { close(): void }[] = [];
  try {
    const face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: url(m.faceLandmarker), delegate },
      runningMode: 'VIDEO',
      numFaces: m.maxPeople,
      minFaceDetectionConfidence: m.minFaceDetectionConfidence,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    });
    created.push(face);
    const pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: url(m.poseLandmarker), delegate },
      runningMode: 'VIDEO',
      numPoses: m.maxPeople,
      minPoseDetectionConfidence: m.minPoseDetectionConfidence,
      outputSegmentationMasks: false,
    });
    created.push(pose);
    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: url(m.segmenter), delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    created.push(segmenter);
    return { face, pose, segmenter };
  } catch (err) {
    created.forEach((task) => task.close());
    throw err;
  }
}

/** Завантажує моделі з локальних файлів. Спершу GPU, якщо не вдалося — CPU. */
export async function loadVisionModels(): Promise<VisionModels> {
  const started = performance.now();
  const fileset = await FilesetResolver.forVisionTasks(url(config.models.wasmPath));
  let delegate: Delegate = 'GPU';
  let tasks: Awaited<ReturnType<typeof create>>;
  try {
    tasks = await create(fileset, 'GPU');
  } catch (err) {
    console.warn('GPU-делегат недоступний, перемикаємося на CPU', err);
    delegate = 'CPU';
    tasks = await create(fileset, 'CPU');
  }
  return {
    ...tasks,
    delegate,
    personMaskIndex: pickPersonMaskIndex(tasks.segmenter.getLabels()),
    loadMs: performance.now() - started,
  };
}
