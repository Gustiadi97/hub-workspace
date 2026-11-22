# HUB WORKSPACE database

This folder tracks database changes owned by HUB WORKSPACE.

The live project already contains the `hw_*` core schema and the corresponding Supabase migration history. Keep future HUB WORKSPACE migrations additive and do not rename, truncate, or repurpose unrelated public tables such as `parcel_data`, `update_history`, `data_tracking`, or `wct_*`.

## Access model

- Workspace owner: full control of their workspace.
- Admin: can manage members and workspace content.
- Member: can create and update workspace content.
- Viewer: can read workspace content.
- Platform super admin: separately assigned through `hw_platform_admins`; never derive this permission from user metadata.

Workspace membership is checked through private helper functions and RLS policies. Invitation acceptance validates the authenticated user's email against the invite and inserts a membership row server-side.

## Initial administrator provisioning

After the designated owner signs up, find the user's UUID in Supabase Authentication > Users and execute:

```sql
insert into public.hw_platform_admins (user_id)
values ('AUTH-USER-UUID')
on conflict (user_id) do nothing;
```

Replace the placeholder with the real UUID from the Auth Users page. Do not expose a service-role key in the frontend.
