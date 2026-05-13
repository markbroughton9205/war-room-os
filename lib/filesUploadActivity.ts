let activeUploads = 0

export function beginFileUpload() {
  activeUploads += 1
}

export function endFileUpload() {
  activeUploads = Math.max(0, activeUploads - 1)
}

export function fileUploadInProgress() {
  return activeUploads > 0
}
