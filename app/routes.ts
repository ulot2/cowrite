import { type RouteConfig, index, layout, route } from '@react-router/dev/routes'

export default [
  route('login', 'routes/login.tsx'),
  route('api/auth/*', 'routes/api.auth.ts'),
  // Everything behind the sidebar needs a signed-in user. The shell route checks once.
  layout('routes/shell.tsx', [
    index('routes/home.tsx'),
    route('doc/:id', 'routes/doc.tsx'),
  ]),
] satisfies RouteConfig
