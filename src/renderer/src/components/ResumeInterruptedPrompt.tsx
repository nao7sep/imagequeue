import { useEffect } from 'react'
import { useConfirm } from '../context/ConfirmContext'

// Listens for the main-process signal fired after a session is resumed that
// still has tasks left unfinished when it was last open, and asks whether to
// re-queue them all. It reuses the shared confirm dialog (the common Modal
// base) so it shows a title and closes on Esc / backdrop / ✕ like every other
// modal; dismissing is equivalent to "Not Now" and leaves the tasks
// interrupted for per-task retry.
//
// Driven by the event (not the Sessions modal) so it survives that modal
// closing on resume, and mounted once at app level. Renders nothing itself —
// the confirm dialog is owned by ConfirmProvider.
//
// Labelled Retry, never Resume: "Resume" belongs to the Sessions modal, where it
// means switching the app to another session, and two different actions reading
// as the same word is what made this dialog confusing. This one is the bulk form
// of a task row's own `retry` button, so it takes that verb.
export function ResumeInterruptedPrompt(): null {
  const confirm = useConfirm()

  useEffect(() => {
    return window.electronAPI.onInterruptedTasksOnResume(({ count }) => {
      const label = count === 1 ? 'task' : 'tasks'
      const message =
        `This session has ${count} ${label} that ${count === 1 ? 'was' : 'were'} left unfinished ` +
        `when it was last open. Retry ${count === 1 ? 'it' : 'them all'} to re-queue for generation, ` +
        `or keep ${count === 1 ? 'it' : 'them'} paused to retry individually later.`

      void confirm({
        title: 'Retry Interrupted Tasks',
        message,
        confirmLabel: 'Retry All',
        cancelLabel: 'Not Now'
      }).then((ok) => {
        if (ok) void window.electronAPI.resumeInterruptedTasks()
      })
    })
  }, [confirm])

  return null
}
