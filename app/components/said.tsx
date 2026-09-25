import { Icon } from './icon'

type Result = { intent: string; ok?: true; error?: string } | null | undefined

// The status line next to a settings form: "Saved", or what went wrong.
export function Said({ fetcher, intent, ok = 'Saved' }: { fetcher: { state: string; data?: unknown }; intent: string; ok?: string }) {
  const data = fetcher.data as Result
  if (fetcher.state !== 'idle' || data?.intent !== intent) return null
  return data.error
    ? <p className="setting-said" data-error role="alert">{data.error}</p>
    : <p className="setting-said" role="status"><Icon name="check" />{ok}</p>
}

// Sends an image to the app's image store and returns its address. Throws the reason it failed.
export const uploadImage = async (file: File) => {
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose an image of 2 MB or smaller.')
  const res = await fetch('/upload', { method: 'POST', body: file, headers: { 'content-type': file.type, 'x-file-name': file.name } })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json() as { url: string }).url
}

// An address `uploadImage` returned, so a form cannot save any other URL.
export const isUpload = (url: string) => /^\/files\/[\w-]+\/[\w.-]+$/.test(url)
