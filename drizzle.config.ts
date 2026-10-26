// drizzle-kit config: `npm run db:generate` writes SQL migrations from server/db/schema.ts.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  casing: 'snake_case',
})
