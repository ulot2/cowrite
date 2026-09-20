import { createAuthClient } from 'better-auth/react'

// Browser side of Better Auth. Same origin, so no base URL is needed.
export const authClient = createAuthClient()
