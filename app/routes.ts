import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  route('login', 'routes/login.tsx'),
  route('api/auth/*', 'routes/api.auth.ts'),
  route('s/:token', 'routes/share.tsx'),
  // Everything behind the shell needs a signed-in user. The shell route checks once.
  layout('routes/shell.tsx', [
    index('routes/home.tsx'),
    route('documents', 'routes/documents.tsx'),
    route('doc/:id', 'routes/doc.tsx'),
    route('doc/:id/history', 'routes/history.tsx'),
    route('space/:id', 'routes/space.tsx'),
  ]),
] satisfies RouteConfig
