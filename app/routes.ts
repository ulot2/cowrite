import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  route('doc/:id', 'routes/doc.tsx'),
  route('api/auth/*', 'routes/api.auth.ts'),
] satisfies RouteConfig
