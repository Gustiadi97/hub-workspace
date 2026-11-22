"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type Workspace = {
  id: string;
  name: string;
  workspace_type: "personal" | "team";
  owner_id: string;
  description?: string;
};
type Task = {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "waiting" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  progress: number;
  due_date: string | null;
  assigned_to: string | null;
  created_at: string;
  created_by: string;
};
type Note = { id: string; title: string; content: string; is_pinned: boolean; updated_at: string };
type EventItem = { id: string; title: string; description: string; location: string; starts_at: string; ends_at: string | null; all_day: boolean };
type Member = { id: string; user_id: string; role: string; display_name: string };
type Invite = { id: string; workspace_id: string; email: string | null; login_id: string | null; role: string; accepted_at: string | null; created_at: string; invited_by: string };
type UserAccount = { user_id: string; login_id: string; display_name: string; account_role: "admin" | "user"; is_active: boolean; created_at: string; is_super_admin?: boolean };

const statusMeta = {
  todo: { label: "To do", tone: "slate" },
  in_progress: { label: "In progress", tone: "orange" },
  waiting: { label: "Waiting", tone: "purple" },
  done: { label: "Done", tone: "green" },
  cancelled: { label: "Cancelled", tone: "slate" },
} as const;
const priorityMeta = {
  low: { label: "Low", tone: "slate" },
  medium: { label: "Medium", tone: "blue" },
  high: { label: "High", tone: "orange" },
  urgent: { label: "Urgent", tone: "red" },
} as const;
const navItems = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "tasks", label: "My tasks", icon: "☷" },
  { id: "board", label: "Kanban board", icon: "▥" },
  { id: "calendar", label: "Calendar", icon: "▦" },
  { id: "notes", label: "Notes", icon: "▤" },
  { id: "team", label: "Team & access", icon: "♧" },
  { id: "users", label: "User management", icon: "♙" },
] as const;
type ViewId = (typeof navItems)[number]["id"];

function dateLabel(value?: string | null) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value + (value.length === 10 ? "T00:00:00" : "")));
}
function timeLabel(value: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "HW";
}
function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profileName, setProfileName] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceRole, setWorkspaceRole] = useState("owner");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState("");
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [loginInput, setLoginInput] = useState("");
  const [loginId, setLoginId] = useState("");
  const [isAppAdmin, setIsAppAdmin] = useState(false);
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountForm, setAccountForm] = useState({ loginId: "", fullName: "", password: "", role: "user" });
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "", priority: "medium", due_date: "", assigned_to: "", status: "todo", progress: 0 });
  const [noteForm, setNoteForm] = useState({ title: "", content: "" });
  const [eventForm, setEventForm] = useState({ title: "", description: "", location: "", starts_at: "", ends_at: "" });
  const [workspaceForm, setWorkspaceForm] = useState({ name: "", workspace_type: "team" as "personal" | "team" });
  const [inviteLoginId, setInviteLoginId] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const activeWorkspace = workspaces.find((item) => item.id === workspaceId) ?? null;
  const canManage = workspaceRole === "owner" || workspaceRole === "admin";
  const completedCount = tasks.filter((task) => task.status === "done").length;
  const activeCount = tasks.filter((task) => task.status === "in_progress").length;
  const overdueCount = tasks.filter((task) => task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== "done" && task.status !== "cancelled").length;
  const completion = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const loadBase = useCallback(async (client: SupabaseClient, account: User) => {
    const { data: accountInfo, error: accountError } = await client.from("hw_user_accounts").select("login_id,display_name,account_role,is_active").eq("user_id", account.id).maybeSingle();
    if (accountError || !accountInfo || accountInfo.is_active !== true) {
      await client.auth.signOut();
      throw new Error("Akun tidak aktif atau belum didaftarkan oleh Admin HUB WORKSPACE.");
    }
    setLoginId(accountInfo.login_id);
    setProfileName(accountInfo.display_name || account.user_metadata?.full_name || accountInfo.login_id);
    setIsAppAdmin(accountInfo.account_role === "admin");
    const { data: spaceData, error: spaceError } = await client.from("hw_workspaces").select("id,name,workspace_type,owner_id,description").order("created_at", { ascending: true });
    if (spaceError) throw spaceError;
    let available = (spaceData ?? []) as Workspace[];
    if (!available.length) {
      const { data: created, error } = await client.from("hw_workspaces")
        .insert({ name: "My workspace", workspace_type: "personal", owner_id: account.id, description: "Your personal space to plan and focus." })
        .select("id,name,workspace_type,owner_id,description").single();
      if (error) throw error;
      available = [created as Workspace];
    }
    setWorkspaces(available);
    setWorkspaceId((current) => available.some((space) => space.id === current) ? current : available[0].id);
    const { data: admin } = await client.from("hw_platform_admins").select("user_id").eq("user_id", account.id).maybeSingle();
    setIsPlatformAdmin(Boolean(admin));
  }, []);

  useEffect(() => {
    let mounted = true;
    const client = getSupabase();
    setSupabase(client);
    if (!client) {
      setReady(true);
      return;
    }
    const initialize = async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (session?.user && mounted) {
          setUser(session.user);
          await loadBase(client, session.user);
        }
      } catch (error) {
        if (mounted) flash(messageFrom(error));
      } finally {
        if (mounted) setReady(true);
      }
    };
    void initialize();
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT" || !session?.user) {
        setUser(null);
        setProfileName("");
        setWorkspaces([]);
        setWorkspaceId("");
        setTasks([]);
        setNotes([]);
        setEvents([]);
        setMembers([]);
        setInvites([]);
        setIsPlatformAdmin(false);
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        setUser(session.user);
        window.setTimeout(() => {
          if (mounted) void loadBase(client, session.user).catch((error) => flash(messageFrom(error)));
        }, 0);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [flash, loadBase]);

  useEffect(() => {
    if (!supabase || !user || !workspaceId) return;
    let mounted = true;
    const load = async () => {
      setBusy(true);
      const [taskRes, noteRes, eventRes, memberRes, inviteRes] = await Promise.all([
        supabase.from("hw_tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
        supabase.from("hw_notes").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        supabase.from("hw_calendar_events").select("*").eq("workspace_id", workspaceId).order("starts_at", { ascending: true }),
        supabase.from("hw_workspace_members").select("id,user_id,role").eq("workspace_id", workspaceId).order("joined_at", { ascending: true }),
        supabase.from("hw_workspace_invites").select("*").order("created_at", { ascending: false }),
      ]);
      if (!mounted) return;
      if (taskRes.error || noteRes.error || eventRes.error || memberRes.error || inviteRes.error) {
        flash(messageFrom(taskRes.error || noteRes.error || eventRes.error || memberRes.error || inviteRes.error));
      }
      setTasks((taskRes.data ?? []) as Task[]);
      setNotes((noteRes.data ?? []) as Note[]);
      setEvents((eventRes.data ?? []) as EventItem[]);
      setInvites((inviteRes.data ?? []) as Invite[]);
      const memberRows = (memberRes.data ?? []) as { id: string; user_id: string; role: string }[];
      setWorkspaceRole(memberRows.find((member) => member.user_id === user.id)?.role ?? (activeWorkspace?.owner_id === user.id ? "owner" : "viewer"));
      if (memberRows.length) {
        const { data: profileRows } = await supabase.from("hw_user_profiles").select("user_id,display_name").in("user_id", memberRows.map((member) => member.user_id));
        const profiles = new Map((profileRows ?? []).map((profile: { user_id: string; display_name: string }) => [profile.user_id, profile.display_name]));
        setMembers(memberRows.map((member) => ({
          ...member,
          display_name: profiles.get(member.user_id) || "Workspace member",
        })));
      } else {
        setMembers([]);
      }
      setBusy(false);
    };
    void load();
    return () => { mounted = false; };
  }, [supabase, user, workspaceId, refreshKey, flash, activeWorkspace?.owner_id]);

  const doAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setAuthMessage("");
    try {
      const normalizedId = loginInput.trim().toLowerCase().replace(/\\s+/g, "");
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizedId)) throw new Error("Format ID Login tidak valid.");
      const internalEmail = `${normalizedId}@accounts.hub-workspace.invalid`;
      const { error } = await supabase.auth.signInWithPassword({ email: internalEmail, password: authPassword });
      if (error) throw error;
      setAuthMessage("Login berhasil. Menyiapkan workspace…");
    } catch (error) {
      setAuthMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user) return;
    setBusy(true);
    try {
      const name = workspaceForm.name.trim();
      if (!name) throw new Error("Workspace name is required.");
      const { data, error } = await supabase.from("hw_workspaces")
        .insert({ name, workspace_type: workspaceForm.workspace_type, owner_id: user.id })
        .select("id,name,workspace_type,owner_id,description").single();
      if (error) throw error;
      setWorkspaces((current) => [...current, data as Workspace]);
      setWorkspaceId(data.id);
      setShowWorkspaceModal(false);
      setWorkspaceForm({ name: "", workspace_type: "team" });
      flash("Workspace created.");
    } catch (error) {
      flash(messageFrom(error));
    } finally { setBusy(false); }
  };

  const openTaskEditor = (task?: Task) => {
    setEditingTaskId(task?.id ?? null);
    setTaskForm(task ? {
      title: task.title,
      description: task.description ?? "",
      priority: task.priority,
      due_date: task.due_date ?? "",
      assigned_to: task.assigned_to ?? "",
      status: task.status,
      progress: task.progress ?? 0,
    } : { title: "", description: "", priority: "medium", due_date: "", assigned_to: user?.id ?? "", status: "todo", progress: 0 });
    setShowTaskModal(true);
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user || !activeWorkspace) return;
    setBusy(true);
    try {
      const payload = {
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        priority: taskForm.priority,
        due_date: taskForm.due_date || null,
        assigned_to: taskForm.assigned_to || null,
        status: taskForm.status,
        progress: taskForm.status === "done" ? 100 : Math.max(0, Math.min(100, Number(taskForm.progress) || 0)),
      };
      const { error } = editingTaskId
        ? await supabase.from("hw_tasks").update(payload).eq("id", editingTaskId)
        : await supabase.from("hw_tasks").insert({ workspace_id: activeWorkspace.id, created_by: user.id, ...payload });
      if (error) throw error;
      setShowTaskModal(false);
      setEditingTaskId(null);
      setTaskForm({ title: "", description: "", priority: "medium", due_date: "", assigned_to: user.id, status: "todo", progress: 0 });
      setRefreshKey((value) => value + 1);
      flash(editingTaskId ? "Task updated." : "Task added.");
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
  };

  const changeTask = async (taskId: string, patch: Partial<Task>) => {
    if (!supabase) return;
    const previous = tasks;
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...patch } : task));
    const { error } = await supabase.from("hw_tasks").update(patch).eq("id", taskId);
    if (error) {
      setTasks(previous);
      flash(messageFrom(error));
    } else setRefreshKey((value) => value + 1);
  };

  const deleteTask = async (taskId: string) => {
    if (!supabase || !window.confirm("Delete this task?")) return;
    const { error } = await supabase.from("hw_tasks").delete().eq("id", taskId);
    if (error) flash(messageFrom(error));
    else { setTasks((current) => current.filter((task) => task.id !== taskId)); flash("Task deleted."); }
  };

  const createNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user || !activeWorkspace) return;
    setBusy(true);
    try {
      const payload = { title: noteForm.title.trim() || "Untitled note", content: noteForm.content.trim() };
      const { error } = editingNoteId
        ? await supabase.from("hw_notes").update(payload).eq("id", editingNoteId)
        : await supabase.from("hw_notes").insert({ workspace_id: activeWorkspace.id, created_by: user.id, ...payload });
      if (error) throw error;
      setShowNoteModal(false);
      setEditingNoteId(null);
      setNoteForm({ title: "", content: "" });
      setRefreshKey((value) => value + 1);
      flash("Note saved.");
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
  };

  const togglePin = async (note: Note) => {
    if (!supabase) return;
    const { error } = await supabase.from("hw_notes").update({ is_pinned: !note.is_pinned }).eq("id", note.id);
    if (error) flash(messageFrom(error)); else setRefreshKey((value) => value + 1);
  };

  const deleteNote = async (noteId: string) => {
    if (!supabase || !window.confirm("Delete this note?")) return;
    const { error } = await supabase.from("hw_notes").delete().eq("id", noteId);
    if (error) flash(messageFrom(error));
    else { setNotes((current) => current.filter((note) => note.id !== noteId)); flash("Note deleted."); }
  };

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user || !activeWorkspace) return;
    setBusy(true);
    try {
      if (!eventForm.title.trim() || !eventForm.starts_at) throw new Error("Event title and start time are required.");
      const { error } = await supabase.from("hw_calendar_events").insert({
        workspace_id: activeWorkspace.id, created_by: user.id, title: eventForm.title.trim(),
        description: eventForm.description.trim(), location: eventForm.location.trim(),
        starts_at: new Date(eventForm.starts_at).toISOString(),
        ends_at: eventForm.ends_at ? new Date(eventForm.ends_at).toISOString() : null,
      });
      if (error) throw error;
      setShowEventModal(false);
      setEventForm({ title: "", description: "", location: "", starts_at: "", ends_at: "" });
      setRefreshKey((value) => value + 1);
      flash("Event added to calendar.");
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
  };

  const sendInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user || !activeWorkspace) return;
    setBusy(true);
    try {
      const targetId = inviteLoginId.trim().toLowerCase().replace(/\\s+/g, "");
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(targetId)) throw new Error("Format ID pengguna tidak valid.");
      const { data: targetAccount, error: lookupError } = await supabase.from("hw_user_accounts").select("login_id,is_active").eq("login_id", targetId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!targetAccount || !targetAccount.is_active) throw new Error("ID pengguna tidak ditemukan atau tidak aktif.");
      const { error } = await supabase.from("hw_workspace_invites").insert({
        workspace_id: activeWorkspace.id, email: null, login_id: targetAccount.login_id, role: inviteRole, invited_by: user.id,
      });
      if (error) throw error;
      setInviteLoginId("");
      setRefreshKey((value) => value + 1);
      flash("Undangan dibuat. Pengguna dapat menerimanya setelah login.");
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
  };

  const acceptInvite = async (invite: Invite) => {
    if (!supabase) return;
    const { error } = await supabase.from("hw_workspace_invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
    if (error) flash(messageFrom(error));
    else {
      if (user) await loadBase(supabase, user);
      setWorkspaceId(invite.workspace_id);
      setRefreshKey((value) => value + 1);
      flash("Invitation accepted. Workspace joined.");
    }
  };

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const query = taskQuery.toLowerCase();
    const matchesQuery = !query || task.title.toLowerCase().includes(query) || task.description?.toLowerCase().includes(query);
    const matchesFilter = taskFilter === "all" || task.status === taskFilter;
    return matchesQuery && matchesFilter;
  }), [tasks, taskQuery, taskFilter]);

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setActiveView("overview");
  };

  if (!ready) return <div className="boot-screen"><div className="brand-mark">H</div><span>Preparing your workspace…</span></div>;

  if (!supabase) return (
    <div className="config-screen">
      <div className="auth-card config-card">
        <div className="brand-lockup"><div className="brand-mark">H</div><div><b>HUB WORKSPACE</b><span>Work, clearly.</span></div></div>
        <div className="eyebrow">SETUP REQUIRED</div>
        <h1>Connect your workspace.</h1>
        <p>Add the Supabase environment variables to the deployment before signing in.</p>
        <div className="code-panel"><code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code></div>
        <p className="muted small">Use the values from your Supabase project. Never add a service-role or secret key to these public variables.</p>
      </div>
    </div>
  );

  if (!user) return (
    <div className="auth-screen">
      <div className="auth-left">
        <div className="brand-lockup light"><div className="brand-mark">H</div><div><b>HUB WORKSPACE</b><span>Work, clearly.</span></div></div>
        <div className="auth-pitch">
          <div className="eyebrow light-text">YOUR WORK, IN ONE PLACE</div>
          <h1>Make room<br />for <em>good work.</em></h1>
          <p>One calm space for your priorities, projects, notes, and the people you work with.</p>
          <div className="auth-points"><span>↗&nbsp; Personal focus</span><span>↗&nbsp; Team alignment</span><span>↗&nbsp; Clear next steps</span></div>
        </div>
        <div className="auth-footer">HUB WORKSPACE <span>•</span> Personal + Team</div>
      </div>
      <div className="auth-right">
        <form className="auth-form" onSubmit={doAuth}>
          <div className="mobile-brand brand-lockup"><div className="brand-mark">H</div><div><b>HUB WORKSPACE</b><span>Work, clearly.</span></div></div>
          <div className="eyebrow">ACCOUNT ACCESS</div>
          <h2>Sign in to your space.</h2>
          <p className="muted">Masuk menggunakan ID pengguna dan password yang diberikan Admin.</p>
          <label>ID Pengguna<input value={loginInput} onChange={(e) => setLoginInput(e.target.value)} placeholder="Contoh: imam01" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></label>
          <label>Password<input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Masukkan password" autoComplete="current-password" minLength={8} required /></label>
          {authMessage && <div className="inline-message">{authMessage}</div>}
          <button className="primary-button full-button" disabled={busy}>{busy ? "Memeriksa akun…" : "Masuk ke workspace"} <span>↗</span></button>
          <div className="auth-secure">◈ &nbsp; Akun dibuat dan dikelola oleh Admin HUB WORKSPACE</div>
        </form>
      </div>
    </div>
  );

  const title = navItems.find((item) => item.id === activeView)?.label ?? "Overview";
  const pendingInvites = invites.filter((invite) => !invite.accepted_at && (invite.login_id?.toLowerCase() === loginId.toLowerCase() || invite.email?.toLowerCase() === (user.email ?? "").toLowerCase()));
  const upcomingEvents = events.filter((event) => new Date(event.starts_at).getTime() >= Date.now()).slice(0, 4);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark">H</div><div><b>HUB WORKSPACE</b><span>Work, clearly.</span></div></div>
        <div className="workspace-picker">
          <div className="workspace-symbol">{activeWorkspace?.workspace_type === "team" ? "⌘" : "◒"}</div>
          <div className="workspace-picker-copy"><small>WORKSPACE</small><strong>{activeWorkspace?.name ?? "Loading…"}</strong></div>
          <select aria-label="Switch workspace" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
          </select>
        </div>
        <button className="new-workspace" onClick={() => setShowWorkspaceModal(true)}>＋ <span>New workspace</span></button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav">
          {navItems.filter((item) => item.id !== "users" || isAppAdmin || isPlatformAdmin).map((item) => (
            <button key={item.id} className={activeView === item.id ? "nav-item active" : "nav-item"} onClick={() => setActiveView(item.id)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === "tasks" && tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length > 0 && <small>{tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-card"><div className="plan-icon">✳</div><b>Make work flow.</b><p>Your space for focused work and shared progress.</p><span>{isPlatformAdmin ? "SUPER ADMIN" : "PERSONAL + TEAM"}</span></div>
          <div className="profile-row">
            <div className="avatar">{initials(profileName)}</div>
            <div className="profile-copy"><b>{profileName}</b><span>ID: {loginId.toUpperCase()}</span></div>
            <button className="icon-button" onClick={signOut} title="Sign out">↗</button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{title}</strong></div>
          <div className="topbar-right">
            <span className="sync-label"><i /> Cloud synced</span>
            <button className="avatar top-avatar" onClick={signOut} title="Sign out">{initials(profileName)}</button>
          </div>
        </header>
        <div className="page-content">
          <div className="mobile-page-heading">
            <div className="brand-mark">H</div>
            <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label="Switch workspace">
              {workspaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
            </select>
            <button className="icon-button" onClick={signOut}>↗</button>
          </div>

          {pendingInvites.length > 0 && <div className="invite-banner"><div><b>You have {pendingInvites.length} workspace invitation{pendingInvites.length > 1 ? "s" : ""}</b><span>Accept it in Team & access to join the workspace.</span></div><button onClick={() => setActiveView("team")}>Review invitations ↗</button></div>}

          {activeView === "overview" && <>
            <div className="page-heading">
              <div><div className="eyebrow">YOUR OVERVIEW</div><h1>Good work starts<br className="mobile-break" /> with <em>clarity.</em></h1><p>Here’s what’s happening in {activeWorkspace?.name ?? "your workspace"}.</p></div>
              <div className="heading-actions"><button className="secondary-button" onClick={() => setShowEventModal(true)}>＋ Add event</button><button className="primary-button" onClick={() => openTaskEditor()}>＋ New task</button></div>
            </div>
            <div className="stats-grid">
              <StatCard label="Total tasks" value={tasks.length} detail="Across this workspace" icon="☷" />
              <StatCard label="In progress" value={activeCount} detail="Work happening now" icon="◷" accent="orange" />
              <StatCard label="Completed" value={completedCount} detail={tasks.length ? `${completion}% completion rate` : "No tasks completed yet"} icon="✓" accent="green" />
              <StatCard label="Overdue" value={overdueCount} detail="Need your attention" icon="!" accent="red" />
            </div>
            <div className="overview-grid">
              <section className="panel-card progress-panel">
                <div className="section-head"><div><div className="eyebrow">WORK PULSE</div><h3>Progress at a glance</h3></div><button className="text-button" onClick={() => setActiveView("board")}>Open board ↗</button></div>
                <div className="progress-summary"><strong>{completion}%</strong><span>of tasks completed</span></div>
                <div className="progress-track"><i style={{ width: `${completion}%` }} /></div>
                <div className="progress-legend"><span><i className="dot dot-orange" /> In progress <b>{activeCount}</b></span><span><i className="dot dot-green" /> Completed <b>{completedCount}</b></span><span><i className="dot dot-gray" /> To do <b>{tasks.filter((task) => task.status === "todo").length}</b></span></div>
                <div className="focus-note"><span>✳</span><div><b>Keep the next step visible.</b><p>Small, clear actions make team progress easier to follow.</p></div></div>
              </section>
              <section className="panel-card">
                <div className="section-head"><div><div className="eyebrow">UP NEXT</div><h3>Upcoming events</h3></div><button className="text-button" onClick={() => setActiveView("calendar")}>View calendar ↗</button></div>
                {upcomingEvents.length === 0 ? <EmptyInline title="Nothing scheduled" detail="Add an event to make space for what matters." action="＋ Add event" onClick={() => setShowEventModal(true)} /> :
                  <div className="event-list">{upcomingEvents.map((item) => <div className="event-row" key={item.id}><div className="event-date"><b>{new Date(item.starts_at).getDate()}</b><span>{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(item.starts_at))}</span></div><div className="event-copy"><b>{item.title}</b><span>{timeLabel(item.starts_at)}{item.location ? ` · ${item.location}` : ""}</span></div><span className="event-arrow">↗</span></div>)}</div>}
              </section>
              <section className="panel-card task-preview wide-panel">
                <div className="section-head"><div><div className="eyebrow">YOUR PRIORITIES</div><h3>Tasks to move forward</h3></div><button className="text-button" onClick={() => setActiveView("tasks")}>All tasks ↗</button></div>
                {tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").slice(0, 5).length === 0 ? <EmptyInline title="A clean slate." detail="Add a task to give your next idea a place to go." action="＋ Create task" onClick={() => openTaskEditor()} /> :
                  <div className="task-rows">{tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").slice(0, 5).map((task) => <TaskRow key={task.id} task={task} onStatus={(status) => changeTask(task.id, { status, progress: status === "done" ? 100 : task.progress })} />)}</div>}
              </section>
              <section className="panel-card notes-preview">
                <div className="section-head"><div><div className="eyebrow">QUICK NOTES</div><h3>On your mind</h3></div><button className="text-button" onClick={() => setActiveView("notes")}>All notes ↗</button></div>
                {notes.slice(0, 3).length === 0 ? <EmptyInline title="Capture a thought." detail="Keep useful context close to the work." action="＋ New note" onClick={() => { setEditingNoteId(null); setNoteForm({ title: "", content: "" }); setShowNoteModal(true); }} /> : notes.slice(0, 3).map((note) => <button className="note-mini" key={note.id} onClick={() => { setEditingNoteId(note.id); setNoteForm({ title: note.title, content: note.content }); setShowNoteModal(true); }}><span>{note.is_pinned ? "◆" : "◇"}</span><b>{note.title}</b><small>{dateLabel(note.updated_at.slice(0, 10))}</small></button>)}
              </section>
            </div>
          </>}

          {activeView === "tasks" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">GET IT DONE</div><h1>Your <em>tasks.</em></h1><p>Keep priorities clear and progress moving.</p></div><button className="primary-button" onClick={() => openTaskEditor()}>＋ New task</button></div>
            <div className="toolbar"><div className="search-box"><span>⌕</span><input value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} placeholder="Search tasks…" /></div><select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}><option value="all">All statuses</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><button className="secondary-button" onClick={() => setActiveView("board")}>▥ Board view</button></div>
            <section className="panel-card table-card">
              {visibleTasks.length === 0 ? <EmptyState title="No tasks match this view." detail="Try another filter or create a new task." action="＋ New task" onClick={() => openTaskEditor()} /> :
                <div className="task-table-wrap"><table className="task-table"><thead><tr><th>Task</th><th>PIC</th><th>Status</th><th>Priority</th><th>Due date</th><th>Progress</th><th /></tr></thead><tbody>
                  {visibleTasks.map((task) => <tr key={task.id}><td><div className="table-task-title"><b>{task.title}</b><span>{task.description || "No description"}</span></div></td><td><select className="status-select assignee-select" value={task.assigned_to ?? ""} onChange={(e) => changeTask(task.id, { assigned_to: e.target.value || null })}><option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></td><td><select className="status-select" value={task.status} onChange={(e) => changeTask(task.id, { status: e.target.value as Task["status"], progress: e.target.value === "done" ? 100 : task.progress })}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></td><td><span className={`pill ${priorityMeta[task.priority].tone}`}>{priorityMeta[task.priority].label}</span></td><td className="date-cell">{dateLabel(task.due_date)}</td><td><div className="table-progress"><span>{task.progress}%</span><i><b style={{ width: `${task.progress}%` }} /></i></div></td><td><div className="row-actions"><button className="icon-button" title="Edit task" onClick={() => openTaskEditor(task)}>✎</button><button className="icon-button danger-hover" title="Delete task" onClick={() => deleteTask(task.id)}>×</button></div></td></tr>)}
                </tbody></table></div>}
            </section>
          </>}

          {activeView === "board" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">VISUAL WORKFLOW</div><h1>Kanban <em>board.</em></h1><p>Move a task between columns as work changes.</p></div><button className="primary-button" onClick={() => openTaskEditor()}>＋ New task</button></div>
            <div className="board-scroll"><div className="kanban-grid">
              {(["todo", "in_progress", "waiting", "done"] as const).map((status) => {
                const columnTasks = tasks.filter((task) => task.status === status);
                return <section className="kanban-column" key={status} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (draggedTask) { void changeTask(draggedTask, { status, progress: status === "done" ? 100 : (tasks.find((task) => task.id === draggedTask)?.progress ?? 0) }); setDraggedTask(null); } }}>
                  <div className="kanban-head"><span className={`status-dot ${statusMeta[status].tone}`} /><b>{statusMeta[status].label}</b><small>{columnTasks.length}</small></div>
                  {columnTasks.map((task) => <article className="kanban-card" key={task.id} draggable onDragStart={() => setDraggedTask(task.id)} onDragEnd={() => setDraggedTask(null)}>
                    <div className="kanban-card-top"><span className={`pill ${priorityMeta[task.priority].tone}`}>{priorityMeta[task.priority].label}</span><div className="row-actions"><button className="icon-button tiny" title="Edit task" onClick={() => openTaskEditor(task)}>✎</button><button className="icon-button tiny danger-hover" title="Delete task" onClick={() => deleteTask(task.id)}>×</button></div></div>
                    <h4>{task.title}</h4><p>{task.description || "No description added."}</p>
                    <div className="kanban-progress"><span><i style={{ width: `${task.progress}%` }} /></span><small>{task.progress}%</small></div>
                    <div className="kanban-card-bottom"><span>◷ {dateLabel(task.due_date)}</span><span className="kanban-assignee">{members.find((member) => member.user_id === task.assigned_to)?.display_name ?? "Unassigned"}</span><select value={task.status} aria-label="Change task status" onChange={(e) => changeTask(task.id, { status: e.target.value as Task["status"], progress: e.target.value === "done" ? 100 : task.progress })}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="done">Done</option></select></div>
                  </article>)}
                  {columnTasks.length === 0 && <div className="kanban-empty">Drop a task here</div>}
                </section>;
              })}
            </div></div>
          </>}

          {activeView === "calendar" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">MAKE TIME FOR IT</div><h1>Team <em>calendar.</em></h1><p>Events and important moments in one shared timeline.</p></div><button className="primary-button" onClick={() => setShowEventModal(true)}>＋ Add event</button></div>
            <div className="calendar-layout">
              <section className="panel-card calendar-main"><div className="section-head"><div><div className="eyebrow">SCHEDULE</div><h3>Upcoming events</h3></div><span className="subtle-count">{events.length} total</span></div>
                {events.length === 0 ? <EmptyState title="Your calendar is open." detail="Add a meeting, milestone, or reminder." action="＋ Add event" onClick={() => setShowEventModal(true)} /> :
                  <div className="event-timeline">{events.map((item) => <div className="timeline-event" key={item.id}><div className="timeline-marker" /><div className="timeline-date">{timeLabel(item.starts_at)}</div><div className="timeline-card"><div><h4>{item.title}</h4><p>{item.description || "No additional details."}</p><span>{item.location ? `⌖ ${item.location}` : "Workspace event"}</span></div><button className="icon-button danger-hover" onClick={async () => { if (!supabase || !window.confirm("Delete this event?")) return; const { error } = await supabase.from("hw_calendar_events").delete().eq("id", item.id); if (error) flash(messageFrom(error)); else setRefreshKey((value) => value + 1); }}>×</button></div></div>)}</div>}
              </section>
              <section className="panel-card calendar-side"><div className="eyebrow">THIS WORKSPACE</div><h3>Time well spent.</h3><p>Use shared events to keep meetings, deadlines, and milestones visible to everyone.</p><div className="calendar-side-stat"><b>{events.filter((event) => new Date(event.starts_at).toDateString() === new Date().toDateString()).length}</b><span>Events today</span></div><div className="calendar-side-stat"><b>{upcomingEvents.length}</b><span>Coming up next</span></div></section>
            </div>
          </>}

          {activeView === "notes" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">THINK IT THROUGH</div><h1>Your <em>notes.</em></h1><p>Keep ideas, context, and useful details close.</p></div><button className="primary-button" onClick={() => { setEditingNoteId(null); setNoteForm({ title: "", content: "" }); setShowNoteModal(true); }}>＋ New note</button></div>
            {notes.length === 0 ? <section className="panel-card"><EmptyState title="Nothing written down yet." detail="Start with a meeting note, a quick idea, or a useful reminder." action="＋ Create note" onClick={() => setShowNoteModal(true)} /></section> :
              <div className="notes-grid">{notes.map((note) => <article className="note-card" key={note.id}><div className="note-card-head"><span className="note-symbol">▤</span><div className="note-actions"><button className={note.is_pinned ? "icon-button pinned" : "icon-button"} title="Pin note" onClick={() => togglePin(note)}>◆</button><button className="icon-button danger-hover" title="Delete note" onClick={() => deleteNote(note.id)}>×</button></div></div><button className="note-content-button" onClick={() => { setEditingNoteId(note.id); setNoteForm({ title: note.title, content: note.content }); setShowNoteModal(true); }}><h3>{note.title}</h3><p>{note.content || "An empty note. Add a few thoughts…"}</p></button><div className="note-card-foot"><span>{note.is_pinned ? "PINNED" : "NOTE"}</span><small>Updated {dateLabel(note.updated_at.slice(0, 10))}</small></div></article>)}</div>}
          </>}

          {activeView === "team" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">WORK BETTER TOGETHER</div><h1>Team & <em>access.</em></h1><p>Manage people and invitations for this workspace.</p></div><span className="workspace-type-badge">{activeWorkspace?.workspace_type === "team" ? "⌘ Team workspace" : "◒ Personal workspace"}</span></div>
            <div className="team-grid">
              <section className="panel-card team-members"><div className="section-head"><div><div className="eyebrow">PEOPLE</div><h3>Workspace members</h3></div><span className="subtle-count">{members.length} members</span></div>
                <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><div className="avatar">{initials(member.display_name)}</div><div className="member-name"><b>{member.display_name}{member.user_id === user.id ? " (You)" : ""}</b><span>{member.user_id === activeWorkspace?.owner_id ? "Workspace owner" : "Workspace member"}</span></div>{canManage && member.role !== "owner" ? <select value={member.role} aria-label="Member role" onChange={async (e) => { const { error } = await supabase!.from("hw_workspace_members").update({ role: e.target.value }).eq("id", member.id); if (error) flash(messageFrom(error)); else setRefreshKey((value) => value + 1); }}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select> : <span className={member.role === "owner" ? "role-pill owner" : "role-pill"}>{member.role}</span>}</div>)}</div>
              </section>
              <section className="panel-card invite-panel"><div className="eyebrow">BRING PEOPLE IN</div><h3>Invite a teammate.</h3><p>Send an invitation to someone with a HUB WORKSPACE account using their sign-in email.</p>
                {canManage ? <form onSubmit={sendInvite} className="invite-form"><label>Email address<input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" required /></label><label>Workspace role<select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}><option value="member">Member — can work on tasks</option><option value="admin">Admin — can manage people</option><option value="viewer">Viewer — read only</option></select></label><button className="primary-button full-button" disabled={busy}>Create invitation ↗</button></form> : <div className="permission-note">Only workspace owners and admins can invite people.</div>}
              </section>
            </div>
            <section className="panel-card invitations-panel"><div className="section-head"><div><div className="eyebrow">INVITATIONS</div><h3>Pending and received</h3></div><span className="subtle-count">{invites.filter((item) => !item.accepted_at).length} pending</span></div>
              {invites.filter((item) => !item.accepted_at).length === 0 ? <div className="empty-inline"><b>No pending invitations.</b><span>Invitations you send or receive will show up here.</span></div> :
                <div className="invite-list">{invites.filter((item) => !item.accepted_at).map((invite) => { const incoming = invite.email.toLowerCase() === (user.email ?? "").toLowerCase(); return <div className="invite-row" key={invite.id}><div className="invite-icon">{incoming ? "↙" : "↗"}</div><div className="member-name"><b>{invite.email}</b><span>{incoming ? `Received · ${invite.role}` : `Sent · ${invite.role} · Workspace ${invite.workspace_id.slice(0, 8)}`}</span></div>{incoming ? <button className="secondary-button small-button" onClick={() => acceptInvite(invite)}>Accept invitation</button> : <span className="role-pill">Awaiting response</span>}</div>;})}</div>}
            </section>
          </>}

          {busy && <div className="loading-strip"><i /> Syncing workspace data</div>}
        </div>
        <footer className="app-footer"><span>HUB WORKSPACE</span><span>Personal focus. Shared momentum.</span><span>v1.0</span></footer>
      </main>

      <nav className="mobile-nav">{navItems.filter((item) => item.id !== "users" || isAppAdmin || isPlatformAdmin).map((item) => <button key={item.id} className={activeView === item.id ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setActiveView(item.id)}><span>{item.icon}</span><small>{item.label.replace("My ", "")}</small></button>)}</nav>

      {showTaskModal && <Modal title={editingTaskId ? "Edit task" : "Create a task"} subtitle="Keep the owner, timing, and next action clear." onClose={() => { setShowTaskModal(false); setEditingTaskId(null); }}><form className="modal-form" onSubmit={createTask}><label>Task name<input autoFocus value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="What needs to get done?" required /></label><label>Description<textarea value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Add context or a clear next step…" rows={3} /></label><div className="form-two"><label>Person in charge<select value={taskForm.assigned_to} onChange={(e) => setTaskForm({ ...taskForm, assigned_to: e.target.value })}><option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}{member.user_id === user.id ? " (You)" : ""}</option>)}</select></label><label>Priority<select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div><div className="form-two"><label>Due date<input type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} /></label><label>Status<select value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label></div><label>Progress <span className="form-hint">{taskForm.progress}% complete</span><input type="range" min="0" max="100" step="5" value={taskForm.status === "done" ? 100 : taskForm.progress} onChange={(e) => setTaskForm({ ...taskForm, progress: Number(e.target.value) })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowTaskModal(false); setEditingTaskId(null); }}>Cancel</button><button className="primary-button" disabled={busy}>{editingTaskId ? "Save changes ↗" : "Create task ↗"}</button></div></form></Modal>}

      {showNoteModal && <Modal title={editingNoteId ? "Edit note" : "Write a note"} subtitle="A place for the details worth keeping." onClose={() => { setShowNoteModal(false); setEditingNoteId(null); }}><form className="modal-form" onSubmit={createNote}><label>Title<input autoFocus value={noteForm.title} onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })} placeholder="A thought to keep…" /></label><label>Your note<textarea rows={7} value={noteForm.content} onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })} placeholder="Write freely…" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowNoteModal(false); setEditingNoteId(null); }}>Cancel</button><button className="primary-button" disabled={busy}>{editingNoteId ? "Save changes ↗" : "Save note ↗"}</button></div></form></Modal>}

      {showEventModal && <Modal title="Add an event" subtitle="Put an important moment on the shared calendar." onClose={() => setShowEventModal(false)}><form className="modal-form" onSubmit={createEvent}><label>Event title<input autoFocus value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} placeholder="Team sync, project deadline…" required /></label><label>Description<textarea rows={2} value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} placeholder="What should everyone know?" /></label><label>Location<input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} placeholder="Meeting room or online link" /></label><div className="form-two"><label>Starts at<input type="datetime-local" value={eventForm.starts_at} onChange={(e) => setEventForm({ ...eventForm, starts_at: e.target.value })} required /></label><label>Ends at<input type="datetime-local" value={eventForm.ends_at} onChange={(e) => setEventForm({ ...eventForm, ends_at: e.target.value })} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowEventModal(false)}>Cancel</button><button className="primary-button" disabled={busy}>Add event ↗</button></div></form></Modal>}

      {showWorkspaceModal && <Modal title="Create a workspace" subtitle="Keep personal focus separate from shared team work." onClose={() => setShowWorkspaceModal(false)}><form className="modal-form" onSubmit={createWorkspace}><label>Workspace name<input autoFocus value={workspaceForm.name} onChange={(e) => setWorkspaceForm({ ...workspaceForm, name: e.target.value })} placeholder="e.g. Operations team" required /></label><label>Workspace type<select value={workspaceForm.workspace_type} onChange={(e) => setWorkspaceForm({ ...workspaceForm, workspace_type: e.target.value as "personal" | "team" })}><option value="personal">Personal — just for me</option><option value="team">Team — collaborate with others</option></select></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowWorkspaceModal(false)}>Cancel</button><button className="primary-button" disabled={busy}>Create workspace ↗</button></div></form></Modal>}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function StatCard({ label, value, detail, icon, accent = "" }: { label: string; value: number; detail: string; icon: string; accent?: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><i className={accent}>{icon}</i></div><strong>{value}</strong><small>{detail}</small></div>;
}
function TaskRow({ task, onStatus }: { task: Task; onStatus: (status: Task["status"]) => void }) {
  return <div className="task-row"><div className="task-check" data-done={task.status === "done"}>{task.status === "done" ? "✓" : "·"}</div><div className="task-row-copy"><b>{task.title}</b><span>{task.description || "No description"}</span></div><span className={`pill ${priorityMeta[task.priority].tone}`}>{priorityMeta[task.priority].label}</span><span className="task-row-date">{dateLabel(task.due_date)}</span><select className="status-select compact-select" value={task.status} onChange={(e) => onStatus(e.target.value as Task["status"])}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></div>;
}
function EmptyInline({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="empty-inline"><b>{title}</b><span>{detail}</span><button onClick={onClick}>{action}</button></div>;
}
function EmptyState({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><div className="empty-illustration">✳</div><h3>{title}</h3><p>{detail}</p><button className="secondary-button" onClick={onClick}>{action}</button></div>;
}
function Modal({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><div className="eyebrow">HUB WORKSPACE</div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button close-button" onClick={onClose}>×</button></div>{children}</section></div>;
}
