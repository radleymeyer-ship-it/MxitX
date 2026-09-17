# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:


## React Compiler
MxitX is a React/Vite social chat app powered by Supabase Auth and Postgres.
The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and anon key.
3. In Supabase, create `profiles` with `id` as a unique UUID foreign key to `auth.users`, plus `username`, `mx_pin`, `status`, and `presence` columns.
4. Enable RLS and add an insert policy allowing an authenticated user to insert only their own row (`auth.uid() = id`). Add a select policy for profiles your app should display.
5. Run `npm run dev`.

Signup creates a unique `MX-` plus five-character PIN, such as `MX-89A12`. When email confirmation is enabled, Supabase does not return a session during signup, so the profile insert requires either a confirmation-time session or a database trigger on `auth.users` for fully automatic profile creation.

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
