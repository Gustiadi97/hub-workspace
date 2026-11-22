# HUB WORKSPACE

A focused personal + team workspace built with Next.js and Supabase.

## Included in v1

- Email/password registration and sign-in using Supabase Auth
- Personal workspace bootstrap and workspace switching
- Personal and team workspaces
- Task list, status changes, priorities, due dates, and Kanban drag-and-drop
- Shared calendar events
- Notes with pinning and editing
- Workspace member roles and email-based invitations
- Row-level security on all `hw_*` tables
- Responsive desktop and mobile layouts

## Stack

- Next.js 16.4.6
- React 19.3.1
- Supabase JS 2.119.2
- Supabase SSR 0.12.7 (available for server-rendered auth routes if needed)

## Environment variables

Copy `.env.example` to `.env.local` and set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Only the Supabase publishable key belongs in browser-visible variables. Never add a service-role or secret key to `NEXT_PUBLIC_*`.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Supabase project

The connected Supabase project is provisioned with the following application-owned tables:

- `hw_workspaces`
- `hw_workspace_members`
- `hw_categories`
- `hw_tasks`
- `hw_notes`
- `hw_calendar_events`
- `hw_activity_logs`
- `hw_user_profiles`
- `hw_platform_admins`
- `hw_workspace_invites`

All HUB WORKSPACE data uses the `hw_` prefix. Existing non-HUB tables and functions are intentionally left untouched.

Database migrations applied to the connected project are recorded in Supabase migration history. The RLS and workspace-invitation migrations are also tracked in `supabase/migrations`.

## Auth configuration

Open Supabase Dashboard → Authentication → URL Configuration:

- Set **Site URL** to `https://hub-workspace-gustiadi97.vercel.app`.
- Add `https://*-gustiadi97.vercel.app/**` to **Redirect URLs** so production and Vercel preview deployments can return to the app.
- Add `http://localhost:3000/**` for local development.

The sign-up form sends the current app origin as `emailRedirectTo`, so the deployed origin must be present in the Redirect URLs allow list. Email confirmation can remain enabled; new users should confirm their email before signing in.

The app's canonical production alias is `https://hub-workspace-gustiadi97.vercel.app`.

## First administrator

The platform-admin table is intentionally not self-service. After the designated owner has registered and signed in, add that user's auth UUID to `public.hw_platform_admins` from the Supabase SQL Editor. Do not use user-editable profile metadata to grant platform privileges.

## Deployment

The repository is configured for Vercel. Add both environment variables above to Preview, Production, and Development environments, then deploy the `main` branch.

## Notes

This is the first usable application release. Reporting/export, richer task assignment, workspace settings, and administrative audit screens are planned follow-on work.
