import { redirect } from 'react-router'
import { createSpace } from './access.server'

export type CreateSpaceError = { error: string; field?: 'name' | 'description' }

// Both entry points validate and commit the same private space, membership, and event.
export async function createSpaceFromForm(userId: string, form: FormData): Promise<CreateSpaceError> {
  const name = String(form.get('name') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  if (!name) return { error: 'Give the space a name.', field: 'name' }
  if (name.length > 60) return { error: 'Keep the space name to 60 characters or fewer.', field: 'name' }
  if (description.length > 140) return { error: 'Keep the description to 140 characters or fewer.', field: 'description' }
  let id: string
  try {
    id = await createSpace(userId, name, description)
  } catch (error) {
    console.error('Could not create space', error)
    return { error: 'The space could not be created. Your details are still here. Try again.' }
  }
  throw redirect(`/space/${id}`)
}
