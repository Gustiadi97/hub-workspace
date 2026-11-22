# HUB WORKSPACE

A focused personal + team workspace built with Next.js and Supabase.

## Included in v1

- Admin-created user accounts: ID Login + password (no email entry or self-registration)
- Super Admin and Admin account management
- Reset password, rename user, activate/deactivate accounts
- Personal workspace bootstrap and workspace switching
- Personal and team workspaces
- Task list, PIC assignment, status, priority, due dates, progress, and Kanban drag-and-drop
- Shared calendar events
- Notes with pinning and editing
- Workspace member roles and ID-based invitations
- Row-level security on all `hw_*` tables
- Responsive desktop and mobile layouts

## Stack

- Next.js 16.4.6
- React 19.3.1
- Supabase JS 2.119.2
- Supabase Edge Function for privileged account administration

## Environment variables

Copy `.env.example` to `.env.local` and set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Only the Supabase publishable key belongs in browser-visible variables. Never add a service-role or secret key to `NEXT_PUBLIC_*`. The `hw-admin-users` Edge Function reads the Supabase secret key from Edge Function environment variables.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Supabase project

The connected Supabase project is provisioned with these application-owned tables:

- `hw_workspaces`
- `hw_workspace_members`
- `hw_categories`
- `hw_tasks`
- `hw_notes`
- `hw_calendar_events`
- `hw_activity_logs`
- `hw_user_profiles`
- `hw_platform_admins`
- `hw_user_accounts`
- `hw_workspace_invites`

All HUB WORKSPACE data uses the `hw_` prefix. Existing non-HUB tables and functions are intentionally left untouched.

### Account model

Users sign in with a login ID and password. Internally, Supabase Auth receives a generated non-routable account address of the form:

```
<login-id>@accounts.hub-workspace.invalid
```

This is an internal identifier only. Users do not need an email address, do not receive email, and cannot register themselves. New accounts are created by an Admin from **User Management**.

- **Super Admin**: can create Admin and User accounts, change application roles, reset passwords, and manage account status.
- **Admin**: can create User accounts, reset passwords, edit display names, and activate/deactivate User accounts.
- **User**: can use the workspaces assigned to them.

The password is stored and verified by Supabase Auth, never in the `hw_user_accounts` table. Privileged actions run through the `hw-admin-users` Edge Function and its server-side secret key.

### First Super Admin bootstrap

One initial Super Admin must be provisioned once from the Supabase Dashboard. This avoids an unsafe public first-user registration route.

1. Open Supabase Dashboard → Authentication → Users → **Add user**.
2. Use an internal address such as `superadmin@accounts.hub-workspace.invalid`, set the password you choose, and mark the user as confirmed.
3. Copy the newly created user's UUID.
4. Run the following SQL in Supabase SQL Editor, replacing the UUID and display name:

```sql
insert into public.hw_user_accounts
  (user_id, login_id, display_name, account_role, is_active)
values
  ('AUTH-USER-UUID', 'superadmin', 'Super Admin', 'admin', true)
on conflict (user_id) do update
set login_id = excluded.login_id,
    display_name = excluded.display_name,
    account_role = 'admin',
    is_active = true;

insert into public.hw_platform_admins (user_id)
values ('AUTH-USER-UUID')
on conflict (user_id) do nothing;

update public.hw_user_profiles
set display_name = 'Super Admin', updated_at = now()
where user_id = 'AUTH-USER-UUID';
```

5. Open the production app and sign in with ID `superadmin` and the password set in step 2.

After this one-time bootstrap, create all other users from **User Management** in the app. Do not add a service-role/secret key to the frontend.

## Deployment

The repository is linked to Vercel. Set both environment variables above for Preview, Production, and Development, then deploy the `main` branch. The Supabase Edge Function `hw-admin-users` must also be deployed and active.

## Notes

The initial release focuses on the core personal/team workspace. Reporting/export, richer task assignment, additional workspace settings, and administrative audit screens are planned follow-on work.
