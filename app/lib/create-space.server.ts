import { redirect } from 'react-router'
import { createSpace } from './access.server'

export type CreateSpaceError = { error: string; field?: 'name' | 'description' }

// Guided onboarding and quick creation use the same field limits and private defaults.
export function readSpaceDetails(form: FormData): CreateSpaceError | { name: string; description: string } {
  const name = String(form.get('name') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  if (!name) return { error: 'Give the space a name.', field: 'name' }
  if (name.length > 60) return { error: 'Keep the space name to 60 characters or fewer.', field: 'name' }
  if (description.length > 140) return { error: 'Keep the description to 140 characters or fewer.', field: 'description' }
  return { name, description }
}

export async function createSpaceFromForm(userId: string, form: FormData): Promise<CreateSpaceError> {
  const details = readSpaceDetails(form)
  if ('error' in details) return details
  let id: string
  try {
    id = await createSpace(userId, details.name, details.description)
  } catch (error) {
    console.error('Could not create space', error)
    return { error: 'The space could not be created. Your details are still here. Try again.' }
  }
  throw redirect(`/space/${id}`)
}
