import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  route('login', 'routes/login.tsx'),
  route('api/auth/*', 'routes/api.auth.ts'),
  route('api/inbox', 'routes/api.inbox.ts'),
  route('api/ai', 'routes/api.ai.ts'),
  route('s/:token', 'routes/share.tsx'),
  route('p/:slug', 'routes/public.tsx'),
  // Outside the shell: a download, a print page, and full-screen slides.
  route('doc/:id/export', 'routes/export.ts'),
  route('doc/:id/print', 'routes/print.tsx'),
  route('doc/:id/present', 'routes/present.tsx'),
  // Everything behind the shell needs a signed-in user. The shell route checks once.
  layout('routes/shell.tsx', [
    index('routes/home.tsx'),
    route('documents', 'routes/documents.tsx'),
    route('tasks', 'routes/tasks.tsx'),
    route('review', 'routes/review.tsx'),
    route('doc/:id', 'routes/doc.tsx'),
    route('doc/:id/history', 'routes/history.tsx'),
    route('space/:id', 'routes/space.tsx'),
  ]),
] satisfies RouteConfig
