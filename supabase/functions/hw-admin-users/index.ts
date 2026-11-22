import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function readDefaultKeyMap(variableName: string, legacyName: string): string {
  const raw = Deno.env.get(variableName);
  if (raw) {
    const keyMap = JSON.parse(raw) as Record<string, string>;
    const value = keyMap.default;
    if (typeof value === "string" && value) return value;
  }
  const legacyValue = Deno.env.get(legacyName);
  if (legacyValue) return legacyValue;
  throw new Error("Environment variable " + variableName + " tidak tersedia.");
}

const ANON_KEY = readDefaultKeyMap("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = readDefaultKeyMap("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const LOGIN_DOMAIN = "accounts.hub-workspace.invalid";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sesi login tidak ditemukan." }, 401);

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sesi login tidak valid." }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const callerId = authData.user.id;
    const [{ data: callerAccount }, { data: superAdminRow }] = await Promise.all([
      adminClient.from("hw_user_accounts")
        .select("user_id,login_id,display_name,account_role,is_active,hub_code")
        .eq("user_id", callerId).maybeSingle(),
      adminClient.from("hw_platform_admins")
        .select("user_id").eq("user_id", callerId).maybeSingle(),
    ]);

    if (!callerAccount || callerAccount.is_active !== true) {
      return json({ error: "Akun tidak aktif atau tidak terdaftar di HUB WORKSPACE." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "self-update-profile") {
      const fullName = String(body.fullName || "").trim();
      const hubCode = String(body.hubCode || "").trim().toUpperCase();
      if (fullName.length < 2 || fullName.length > 100) {
        return json({ error: "Nama tampilan harus 2–100 karakter." }, 400);
      }
      if (!hubCode) return json({ error: "Pilih HUB untuk akun ini." }, 400);
      const { data: targetHub, error: hubError } = await adminClient.from("hw_hubs")
        .select("hub_code").eq("hub_code", hubCode).maybeSingle();
      if (hubError || !targetHub) return json({ error: "HUB yang dipilih tidak ditemukan." }, 400);

      const now = new Date().toISOString();
      const { error: accountUpdateError } = await adminClient.from("hw_user_accounts")
        .update({ display_name: fullName, hub_code: hubCode, updated_at: now })
        .eq("user_id", callerId);
      if (accountUpdateError) return json({ error: accountUpdateError.message }, 400);

      const { error: profileUpdateError } = await adminClient.from("hw_user_profiles")
        .upsert({ user_id: callerId, display_name: fullName, updated_at: now }, { onConflict: "user_id" });
      if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);

      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(callerId, {
        user_metadata: { ...(authData.user.user_metadata || {}), full_name: fullName },
      });
      if (authUpdateError) return json({ error: authUpdateError.message }, 400);

      return json({ ok: true, displayName: fullName, hubCode });
    }

    const isSuperAdmin = Boolean(superAdminRow);
    const isAdmin = isSuperAdmin || callerAccount.account_role === "admin";
    if (!isAdmin) return json({ error: "Hanya Admin yang dapat mengelola akun." }, 403);

    if (action === "create") {
      const loginId = String(body.loginId || "").trim().toLowerCase().replace(/\s+/g, "");
      const fullName = String(body.fullName || "").trim();
      const password = String(body.password || "");
      const role = String(body.role || "user");
      const hubCode = String(body.hubCode || "").trim().toUpperCase();

      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(loginId)) {
        return json({ error: "ID Login harus 3–32 karakter, huruf kecil, angka, titik, strip, atau underscore." }, 400);
      }
      if (fullName.length < 2 || fullName.length > 100) {
        return json({ error: "Nama lengkap wajib diisi (2–100 karakter)." }, 400);
      }
      if (!hubCode) return json({ error: "Pilih HUB untuk pengguna baru." }, 400);
      const { data: selectedHub, error: selectedHubError } = await adminClient.from("hw_hubs")
        .select("hub_code").eq("hub_code", hubCode).maybeSingle();
      if (selectedHubError || !selectedHub) return json({ error: "HUB yang dipilih tidak ditemukan." }, 400);
      if (password.length < 8 || password.length > 128) {
        return json({ error: "Password harus 8–128 karakter." }, 400);
      }
      if (!["admin", "user"].includes(role)) return json({ error: "Role tidak valid." }, 400);
      if (role === "admin" && !isSuperAdmin) {
        return json({ error: "Hanya Super Admin yang dapat membuat akun Admin." }, 403);
      }

      const workspaceRole = String(body.workspaceRole || "member");
      if (!["admin", "member", "viewer"].includes(workspaceRole)) {
        return json({ error: "Role akses workspace tidak valid." }, 400);
      }

      // HUB WORKSPACE uses one shared workspace for all application accounts.
      const { data: targetWorkspace, error: workspaceError } = await adminClient
        .from("hw_workspaces").select("id,owner_id").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (workspaceError || !targetWorkspace) {
        return json({ error: "Workspace utama HUB WORKSPACE belum tersedia." }, 404);
      }
      const workspaceId = targetWorkspace.id;

      if (!isSuperAdmin && targetWorkspace.owner_id !== callerId) {
        const { data: callerMembership } = await adminClient.from("hw_workspace_members")
          .select("role").eq("workspace_id", workspaceId).eq("user_id", callerId).maybeSingle();
        if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
          return json({ error: "Kamu tidak memiliki izin untuk mendaftarkan pengguna ke workspace utama." }, 403);
        }
      }

      const email = `${loginId}@${LOGIN_DOMAIN}`;
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, login_id: loginId, auth_mode: "username" },
        app_metadata: { auth_mode: "username" },
      });
      if (createError || !created.user) {
        return json({ error: createError?.message || "Gagal membuat akun." }, 400);
      }

      const userId = created.user.id;
      const { error: accountError } = await adminClient.from("hw_user_accounts").insert({
        user_id: userId,
        login_id: loginId,
        display_name: fullName,
        account_role: role,
        hub_code: hubCode,
        is_active: true,
        created_by: callerId,
      });

      if (accountError) {
        await adminClient.auth.admin.deleteUser(userId);
        return json({ error: accountError.message }, 400);
      }

      const { error: profileError } = await adminClient.from("hw_user_profiles").upsert({
        user_id: userId,
        display_name: fullName,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      if (profileError) {
        await adminClient.from("hw_user_accounts").delete().eq("user_id", userId);
        await adminClient.auth.admin.deleteUser(userId);
        return json({ error: profileError.message }, 400);
      }

      const { error: membershipError } = await adminClient.from("hw_workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: workspaceRole,
      });
      if (membershipError) {
        await adminClient.from("hw_user_profiles").delete().eq("user_id", userId);
        await adminClient.from("hw_user_accounts").delete().eq("user_id", userId);
        await adminClient.auth.admin.deleteUser(userId);
        return json({ error: membershipError.message }, 400);
      }

      return json({ ok: true, userId, loginId: loginId.toUpperCase(), role, workspaceId, workspaceRole, hubCode });
    }

    const targetUserId = String(body.userId || "");
    if (!targetUserId || targetUserId === callerId) {
      return json({ error: "Pilih akun lain yang akan dikelola." }, 400);
    }

    const { data: targetAccount, error: targetError } = await adminClient.from("hw_user_accounts")
      .select("user_id,login_id,display_name,account_role,is_active,hub_code")
      .eq("user_id", targetUserId).maybeSingle();
    if (targetError || !targetAccount) return json({ error: "Akun tidak ditemukan." }, 404);

    const { data: targetSuperAdmin } = await adminClient.from("hw_platform_admins")
      .select("user_id").eq("user_id", targetUserId).maybeSingle();
    if (targetSuperAdmin) return json({ error: "Akun Super Admin dilindungi dan tidak dapat diubah dari menu ini." }, 403);

    if (action === "update-account") {
      const fullName = String(body.fullName || "").trim();
      const workspaceRole = String(body.workspaceRole || "");
      const requestedAppRole = body.accountRole === undefined ? targetAccount.account_role : String(body.accountRole);
      const password = String(body.password || "");
      const hubCode = String(body.hubCode || "").trim().toUpperCase();

      if (fullName.length < 2 || fullName.length > 100) {
        return json({ error: "Nama pengguna harus 2–100 karakter." }, 400);
      }
      if (!["admin", "member", "viewer"].includes(workspaceRole)) {
        return json({ error: "Role akses workspace tidak valid." }, 400);
      }
      if (!hubCode) return json({ error: "Pilih HUB untuk akun ini." }, 400);
      const { data: selectedHub, error: selectedHubError } = await adminClient.from("hw_hubs")
        .select("hub_code").eq("hub_code", hubCode).maybeSingle();
      if (selectedHubError || !selectedHub) return json({ error: "HUB yang dipilih tidak ditemukan." }, 400);
      if (!["admin", "user"].includes(requestedAppRole)) {
        return json({ error: "Role aplikasi tidak valid." }, 400);
      }
      if (!isSuperAdmin && requestedAppRole !== targetAccount.account_role) {
        return json({ error: "Hanya Super Admin yang dapat mengubah role aplikasi." }, 403);
      }
      if (password && (password.length < 8 || password.length > 128)) {
        return json({ error: "Password baru harus 8–128 karakter." }, 400);
      }

      const { data: mainWorkspace, error: mainWorkspaceError } = await adminClient
        .from("hw_workspaces").select("id,owner_id").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (mainWorkspaceError || !mainWorkspace) {
        return json({ error: "Workspace utama tidak ditemukan." }, 404);
      }
      if (!isSuperAdmin && mainWorkspace.owner_id !== callerId) {
        const { data: callerMembership } = await adminClient.from("hw_workspace_members")
          .select("role").eq("workspace_id", mainWorkspace.id).eq("user_id", callerId).maybeSingle();
        if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
          return json({ error: "Kamu tidak memiliki izin mengatur akses pengguna." }, 403);
        }
      }

      const now = new Date().toISOString();
      const { error: accountUpdateError } = await adminClient.from("hw_user_accounts")
        .update({ display_name: fullName, account_role: requestedAppRole, hub_code: hubCode, updated_at: now })
        .eq("user_id", targetUserId);
      if (accountUpdateError) return json({ error: accountUpdateError.message }, 400);

      const { error: profileUpdateError } = await adminClient.from("hw_user_profiles")
        .upsert({ user_id: targetUserId, display_name: fullName, updated_at: now }, { onConflict: "user_id" });
      if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);

      const { data: existingMembership, error: membershipReadError } = await adminClient.from("hw_workspace_members")
        .select("id").eq("workspace_id", mainWorkspace.id).eq("user_id", targetUserId).maybeSingle();
      if (membershipReadError) return json({ error: membershipReadError.message }, 400);

      const membershipResult = existingMembership
        ? await adminClient.from("hw_workspace_members").update({ role: workspaceRole }).eq("id", existingMembership.id)
        : await adminClient.from("hw_workspace_members").insert({ workspace_id: mainWorkspace.id, user_id: targetUserId, role: workspaceRole });
      if (membershipResult.error) return json({ error: membershipResult.error.message }, 400);

      const { data: targetAuthResult, error: targetAuthReadError } = await adminClient.auth.admin.getUserById(targetUserId);
      if (targetAuthReadError || !targetAuthResult.user) {
        return json({ error: "Data autentikasi pengguna tidak dapat dibaca." }, 400);
      }
      const authChanges: Record<string, unknown> = {
        user_metadata: {
          ...(targetAuthResult.user.user_metadata || {}),
          full_name: fullName,
          login_id: targetAccount.login_id,
          auth_mode: "username",
        },
      };
      if (password) authChanges.password = password;
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(targetUserId, authChanges);
      if (authUpdateError) return json({ error: authUpdateError.message }, 400);

      return json({ ok: true, displayName: fullName, workspaceRole, accountRole: requestedAppRole, hubCode, passwordChanged: Boolean(password) });
    }

    if (action === "delete-account") {
      if (targetAccount.account_role === "admin" && !isSuperAdmin) {
        return json({ error: "Hanya Super Admin yang dapat menghapus akun Admin aplikasi." }, 403);
      }
      const { data: ownedWorkspace, error: ownerCheckError } = await adminClient
        .from("hw_workspaces").select("id").eq("owner_id", targetUserId).limit(1).maybeSingle();
      if (ownerCheckError) return json({ error: ownerCheckError.message }, 400);
      if (ownedWorkspace) return json({ error: "Akun ini merupakan pemilik workspace dan tidak dapat dihapus sebelum kepemilikan workspace dialihkan." }, 409);

      const wctChecks = await Promise.all([
        adminClient.from("wct_actions").select("id", { count: "exact", head: true }).eq("created_by", targetUserId),
        adminClient.from("wct_actions").select("id", { count: "exact", head: true }).eq("updated_by", targetUserId),
        adminClient.from("wct_app_settings").select("id", { count: "exact", head: true }).eq("updated_by", targetUserId),
        adminClient.from("wct_cases").select("id", { count: "exact", head: true }).eq("created_by", targetUserId),
        adminClient.from("wct_cases").select("id", { count: "exact", head: true }).eq("updated_by", targetUserId),
        adminClient.from("wct_cases").select("id", { count: "exact", head: true }).eq("closed_by", targetUserId),
        adminClient.from("wct_meetings").select("id", { count: "exact", head: true }).eq("created_by", targetUserId),
        adminClient.from("wct_progress_log_edits").select("id", { count: "exact", head: true }).eq("edited_by", targetUserId),
        adminClient.from("wct_progress_logs").select("id", { count: "exact", head: true }).eq("created_by", targetUserId),
        adminClient.from("wct_progress_logs").select("id", { count: "exact", head: true }).eq("edited_by", targetUserId),
        adminClient.from("wct_users").select("id", { count: "exact", head: true }).eq("id", targetUserId),
        adminClient.from("wct_users").select("id", { count: "exact", head: true }).eq("created_by", targetUserId),
      ]);
      if (wctChecks.some((result) => result.error)) {
        return json({ error: "Tidak dapat memeriksa keterkaitan akun dengan Weekly Case Tracker. Akun tidak dihapus." }, 500);
      }
      const hasOtherAppHistory = wctChecks.some((result) => (result.count ?? 0) > 0);

      const inviteByCleanup = await adminClient.from("hw_workspace_invites").delete().eq("invited_by", targetUserId);
      if (inviteByCleanup.error) return json({ error: inviteByCleanup.error.message }, 400);
      const inviteTargetCleanup = await adminClient.from("hw_workspace_invites").delete().eq("login_id", targetAccount.login_id);
      if (inviteTargetCleanup.error) return json({ error: inviteTargetCleanup.error.message }, 400);

      if (hasOtherAppHistory) {
        const memberCleanup = await adminClient.from("hw_workspace_members").delete().eq("user_id", targetUserId);
        if (memberCleanup.error) return json({ error: memberCleanup.error.message }, 400);
        const profileCleanup = await adminClient.from("hw_user_profiles").delete().eq("user_id", targetUserId);
        if (profileCleanup.error) return json({ error: profileCleanup.error.message }, 400);
        const accountCleanup = await adminClient.from("hw_user_accounts").delete().eq("user_id", targetUserId);
        if (accountCleanup.error) return json({ error: accountCleanup.error.message }, 400);
        return json({
          ok: true,
          authIdentityRetained: true,
          message: "Akun berhasil dihapus dari HUB WORKSPACE. Identitas login dipertahankan karena masih dipakai oleh Weekly Case Tracker.",
        });
      }

      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
      if (authDeleteError) {
        return json({ error: "Gagal menghapus identitas login: " + authDeleteError.message }, 400);
      }
      return json({ ok: true, authIdentityRetained: false, message: "Akun dan identitas login berhasil dihapus." });
    }

    if (action === "set-active") {
      const active = body.active;
      if (typeof active !== "boolean") return json({ error: "Status akun tidak valid." }, 400);

      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
        ban_duration: active ? "none" : "876000h",
      });
      if (authUpdateError) return json({ error: authUpdateError.message }, 400);

      const { error } = await adminClient.from("hw_user_accounts")
        .update({ is_active: active, updated_at: new Date().toISOString() })
        .eq("user_id", targetUserId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "reset-password") {
      const password = String(body.password || "");
      if (password.length < 8 || password.length > 128) {
        return json({ error: "Password harus 8–128 karakter." }, 400);
      }
      const { error } = await adminClient.auth.admin.updateUserById(targetUserId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "update-profile") {
      const fullName = String(body.fullName || "").trim();
      if (fullName.length < 2 || fullName.length > 100) {
        return json({ error: "Nama lengkap tidak valid." }, 400);
      }
      const { error: accountUpdateError } = await adminClient.from("hw_user_accounts")
        .update({ display_name: fullName, updated_at: new Date().toISOString() })
        .eq("user_id", targetUserId);
      if (accountUpdateError) return json({ error: accountUpdateError.message }, 400);

      const { error: profileUpdateError } = await adminClient.from("hw_user_profiles")
        .upsert({ user_id: targetUserId, display_name: fullName, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);

      return json({ ok: true });
    }

    if (action === "set-role") {
      if (!isSuperAdmin) return json({ error: "Hanya Super Admin yang dapat mengubah role Admin." }, 403);
      const role = String(body.role || "");
      if (!["admin", "user"].includes(role)) return json({ error: "Role tidak valid." }, 400);
      const { error } = await adminClient.from("hw_user_accounts")
        .update({ account_role: role, updated_at: new Date().toISOString() })
        .eq("user_id", targetUserId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Aksi tidak dikenal." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Terjadi kesalahan server." }, 500);
  }
});