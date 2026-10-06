import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED } from './types'

const RUNTIME_PACKAGES = ['@mediapipe/tasks-vision', 'mediapipe', 'opencv4nodejs', 'onnxruntime-node', '@tensorflow/tfjs-tflite']

export type HvsMotionRuntimeAudit = {
  status: typeof PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED | 'AVAILABLE'
  found: string[]
  note: string
}

export function auditMotionRuntime(root = process.cwd()): HvsMotionRuntimeAudit {
  let packageText = ''
  const packagePath = path.join(root, 'package.json')
  if (existsSync(packagePath)) packageText = readFileSync(packagePath, 'utf8')
  const found = RUNTIME_PACKAGES.filter(name => packageText.includes(`"${name}"`) || existsSync(path.join(root, 'node_modules', name)))
  if (!found.length) {
    return {
      status: PERFORMANCE_CAPTURE_MODEL_APPROVAL_REQUIRED,
      found: [],
      note: 'No MediaPipe, OpenCV, ONNX Runtime, or TensorFlow Lite package is installed. Landmarks are not invented.',
    }
  }
  return {
    status: 'AVAILABLE',
    found,
    note: 'A local runtime package is present. This slice still does not load a landmark model without a separate approval.',
  }
}
