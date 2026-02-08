/**
 * Chat Asset Uploads Component
 * Displays upload progress for chat attachments
 */

import { useEffect } from 'react'

import { useDirectChatAssetUpload, type UploadingFile } from '../hooks/useDirectChatAssetUpload'

interface ChatAssetUploadsProps {
  isVisible: boolean
  onClose: () => void
}

export function ChatAssetUploads({ isVisible, onClose }: ChatAssetUploadsProps) {
  const { uploadingFiles, cancelFile, retryFile, removeFile, clearCompleted, completedAssetIds } =
    useDirectChatAssetUpload()

  const activeFiles = uploadingFiles.filter(
    (f) => f.status !== 'complete' && f.status !== 'cancelled' && f.status !== 'failed',
  )

  useEffect(() => {
    if (completedAssetIds.length > 0 && activeFiles.length === 0) {
      clearCompleted()
    }
  }, [completedAssetIds.length, activeFiles.length, clearCompleted])

  if (!isVisible || uploadingFiles.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Uploads</h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
          type="button"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {uploadingFiles.map((file) => (
          <UploadItem
            key={file.localId}
            file={file}
            onCancel={() => cancelFile(file.localId)}
            onRetry={() => retryFile(file.localId)}
            onRemove={() => removeFile(file.localId)}
          />
        ))}
      </div>

      {activeFiles.length === 0 && uploadingFiles.length > 0 && (
        <button
          onClick={() => {
            clearCompleted()
            onClose()
          }}
          className="w-full text-sm text-muted-foreground hover:text-foreground py-2 rounded-md hover:bg-muted/50"
          type="button"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

interface UploadItemProps {
  file: UploadingFile
  onCancel: () => void
  onRetry: () => void
  onRemove: () => void
}

function UploadItem({ file, onCancel, onRetry, onRemove }: UploadItemProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getStatusText = (): string => {
    switch (file.status) {
      case 'queued':
        return 'Pending'
      case 'uploading':
        return `Uploading... ${file.progress}%`
      case 'uploaded':
        return 'Uploaded'
      case 'finalizing':
        return 'Processing...'
      case 'complete':
        return 'Complete'
      case 'failed':
        return file.error || 'Failed'
      case 'cancelled':
        return 'Cancelled'
      default:
        return ''
    }
  }

  const getStatusClass = (): string => {
    switch (file.status) {
      case 'complete':
        return 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
      case 'failed':
        return 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
      case 'cancelled':
        return 'border-muted bg-muted/50'
      default:
        return 'border-border bg-card'
    }
  }

  const isInProgress = file.status === 'uploading' || file.status === 'finalizing'

  return (
    <div className={`flex flex-col gap-1 rounded-md border p-2 ${getStatusClass()}`}>
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-medium truncate max-w-[180px]" title={file.file.name}>
          {file.file.name}
        </div>
        <div className="text-xs text-muted-foreground flex gap-2">
          <span>{formatFileSize(file.file.size)}</span>
          <span>{getStatusText()}</span>
        </div>
      </div>

      {isInProgress && (
        <div className="mt-1">
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${file.progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mt-1">
        {isInProgress && (
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-destructive p-1 rounded"
            type="button"
          >
            Cancel
          </button>
        )}
        {file.status === 'failed' && (
          <button
            onClick={onRetry}
            className="text-xs text-muted-foreground hover:text-yellow-600 p-1 rounded"
            type="button"
          >
            Retry
          </button>
        )}
        {(file.status === 'complete' ||
          file.status === 'cancelled' ||
          file.status === 'failed') && (
          <button
            onClick={onRemove}
            className="text-xs text-muted-foreground hover:text-destructive p-1 rounded"
            type="button"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
