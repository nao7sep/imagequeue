import { useEffect, useRef } from 'react'
import { currentSessionImageUrl } from '../../../shared/image-url'
import { canShowImage, type SelectedImage } from '../../../shared/viewing'
import { useDecodedImage } from '../hooks/useDecodedImage'
import { useI18n } from '../i18n/I18nContext'
import { taskFailureText } from '../utils/taskPresentation'
import './Preview.css'

interface Props {
  task: SelectedImage | null
  /** Told whether the task's image loaded, each time a load settles. */
  onImageLoad?: (taskId: string, loaded: boolean) => void
}

/** The selected task's image and, when it failed, why: the preview in the main
 *  window and the whole of the preview window. */
export function Preview({ task, onImageLoad }: Props): React.JSX.Element {
  const i18n = useI18n()
  const { t } = i18n
  const url = task && canShowImage(task) ? currentSessionImageUrl(task.baseName!) : null
  const image = useDecodedImage(url)
  const failureText = task ? taskFailureText(i18n, task) : null

  const onImageLoadRef = useRef(onImageLoad)
  onImageLoadRef.current = onImageLoad
  const taskId = task?.taskId ?? null
  useEffect(() => {
    if (taskId && url && image.settled === url) onImageLoadRef.current?.(taskId, !image.failed)
  }, [image, url, taskId])

  return (
    <>
      <div className="preview-area">
        {url && image.src ? (
          <img className="preview-image" src={image.src} alt={t('prompt.previewAlt')} />
        ) : (
          <div className="preview-placeholder">
            <p>{t('prompt.noImage')}</p>
            <p className="preview-placeholder-hint">{t('prompt.noImageHint')}</p>
          </div>
        )}
      </div>

      {failureText !== null && (
        // Why the selected task failed, whole: the authored lead-in, then the
        // provider's reason. Its own strip under the preview, which gives up
        // the height, so nothing above moves.
        <div className="preview-failure">
          <p>{failureText}</p>
          {task?.providerMessage && (
            <p className="preview-failure-provider">{task.providerMessage}</p>
          )}
        </div>
      )}
    </>
  )
}
