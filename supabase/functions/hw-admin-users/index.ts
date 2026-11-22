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
        .select("user_id,login_id,display_name,account_role,is_active")
        .eq("user_id", callerId).maybeSingle(),
      adminClient.from("hw_platform_admins")
        .select("user_id").eq("user_id", callerId).maybeSingle(),
    ]);

    if (!callerAccount || callerAccount.is_active !== true) {
      return json({ error: "Akun tidak aktif atau tidak terdaftar di HUB WORKSPACE." }, 403);
    }
    const isSuperAdmin = Boolean(superAdminRow);
    const isAdmin = isSuperAdmin || callerAccount.account_role === "admin";
    if (!isAdmin) return json({ error: "Hanya Admin yang dapat mengelola akun." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "create") {
      const loginId = String(body.loginId || "").trim().toLowerCase().replace(/\s+/g, "");
      const fullName = String(body.fullName || "").trim();
      const password = String(body.password || "");
      const role = String(body.role || "user");

      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(loginId)) {
        return json({ error: "ID Login harus 3–32 karakter, huruf kecil, angka, titik, strip, atau underscore." }, 400);
      }
      if (fullName.length < 2 || fullName.length > 100) {
        return json({ error: "Nama lengkap wajib diisi (2–100 karakter)." }, 400);
      }
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

      return json({ ok: true, userId, loginId: loginId.toUpperCase(), role, workspaceId, workspaceRole });
    }

    const targetUserId = String(body.userId || "");
    if (!targetUserId || targetUserId === callerId) {
      return json({ error: "Pilih akun lain yang akan dikelola." }, 400);
    }

    const { data: targetAccount, error: targetError } = await adminClient.from("hw_user_accounts")
      .select("user_id,login_id,display_name,account_role,is_active")
      .eq("user_id", targetUserId).maybeSingle();
    if (targetError || !targetAccount) return json({ error: "Akun tidak ditemukan." }, 404);

    const { data: targetSuperAdmin } = await adminClient.from("hw_platform_admins")
      .select("user_id").eq("user_id", targetUserId).maybeSingle();
    if (targetSuperAdmin) return json({ error: "Akun Super Admin dilindungi dan tidak dapat diubah dari menu ini." }, 403);

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