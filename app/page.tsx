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
  start_date: string | null;
  due_date: string | null;
  category: string;
  division_ids: string[];
  assigned_to: string | null;
  created_at: string;
  created_by: string;
};
type Note = { id: string; title: string; content: string; is_pinned: boolean; updated_at: string };
type EventItem = { id: string; title: string; description: string; location: string; starts_at: string; ends_at: string | null; all_day: boolean };
type Member = { id: string; user_id: string; role: string; display_name: string };
type Invite = { id: string; workspace_id: string; email: string | null; login_id: string | null; role: string; accepted_at: string | null; created_at: string; invited_by: string };
type Category = { id: string; name: string; color: string };
type Division = { id: string; name: string; color: string };
type UserAccount = { user_id: string; login_id: string; display_name: string; account_role: "admin" | "user"; is_active: boolean; created_at: string; is_super_admin?: boolean; workspace_role?: string };

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
  { id: "overview", label: "Dashboard", icon: "⌂" },
  { id: "calendar", label: "Kalender", icon: "▦" },
  { id: "tasks", label: "Daftar Tugas", icon: "☷" },
  { id: "board", label: "Kanban", icon: "▥" },
  { id: "notes", label: "Catatan Cepat", icon: "▤" },
  { id: "settings", label: "Pengaturan", icon: "⚙" },
] as const;
type ViewId = "overview" | "calendar" | "tasks" | "board" | "notes" | "settings" | "team" | "users";

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
function localDateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
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
  const [accountForm, setAccountForm] = useState({ loginId: "", fullName: "", password: "", role: "user", workspaceRole: "member" });
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "", priority: "medium", start_date: localDateKey(new Date()), due_date: "", category: "Operasional", division_ids: [] as string[], assigned_to: "", status: "todo", progress: 0 });
  const [noteForm, setNoteForm] = useState({ title: "", content: "" });
  const [eventForm, setEventForm] = useState({ title: "", description: "", location: "", starts_at: "", ends_at: "" });
  const [categoryForm, setCategoryForm] = useState({ name: "", color: "#16836A" });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [divisionForm, setDivisionForm] = useState({ name: "", color: "#4386AE" });
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const activeWorkspace = workspaces.find((item) => item.id === workspaceId) ?? null;
  const canManage = workspaceRole === "owner" || workspaceRole === "admin";
  const completedCount = tasks.filter((task) => task.status === "done").length;
  const activeCount = tasks.filter((task) => task.status === "in_progress").length;
  const todayKey = localDateKey(new Date());
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = localDateKey(weekEnd);
  const overdueCount = tasks.filter((task) => task.due_date && task.due_date < todayKey && task.status !== "done" && task.status !== "cancelled").length;
  const todayTasks = tasks.filter((task) => task.due_date === todayKey && task.status !== "done" && task.status !== "cancelled");
  const weekTasks = tasks.filter((task) => task.due_date && task.due_date >= todayKey && task.due_date <= weekEndKey && task.status !== "done" && task.status !== "cancelled");
  const avgProgress = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + (task.progress ?? 0), 0) / tasks.length) : 0;
  const completion = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  const calendarCells = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
  }, [calendarMonth]);
  const categoryRows = useMemo(() => categories.map((category) => ({
    label: category.name, count: tasks.filter((task) => task.category === category.name).length,
  })), [tasks, categories]);
  const priorityRows = useMemo(() => (["urgent", "high", "medium", "low"] as const).map((priority) => ({
    label: priorityMeta[priority].label, count: tasks.filter((task) => task.priority === priority).length, tone: priority,
  })), [tasks]);

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
    let available = ((spaceData ?? []) as Workspace[]).slice(0, 1);
    if (!available.length) {
      const { data: created, error } = await client.from("hw_workspaces")
        .insert({ name: "HUB WORKSPACE", workspace_type: "team", owner_id: account.id, description: "Workspace utama seluruh pengguna HUB WORKSPACE." })
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
        setAccounts([]);
        setLoginId("");
        setIsAppAdmin(false);
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
      const [taskRes, noteRes, eventRes, memberRes, categoryRes, divisionRes] = await Promise.all([
        supabase.from("hw_tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
        supabase.from("hw_notes").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        supabase.from("hw_calendar_events").select("*").eq("workspace_id", workspaceId).order("starts_at", { ascending: true }),
        supabase.from("hw_workspace_members").select("id,user_id,role").eq("workspace_id", workspaceId).order("joined_at", { ascending: true }),
        supabase.from("hw_categories").select("id,name,color").eq("workspace_id", workspaceId).order("name"),
        supabase.from("hw_divisions").select("id,name,color").eq("workspace_id", workspaceId).order("name"),
      ]);
      if (!mounted) return;
      if (taskRes.error || noteRes.error || eventRes.error || memberRes.error || categoryRes.error || divisionRes.error) {
        flash(messageFrom(taskRes.error || noteRes.error || eventRes.error || memberRes.error || categoryRes.error || divisionRes.error));
      }
      setTasks((taskRes.data ?? []) as Task[]);
      setNotes((noteRes.data ?? []) as Note[]);
      setEvents((eventRes.data ?? []) as EventItem[]);
      setCategories((categoryRes.data ?? []) as Category[]);
      setDivisions((divisionRes.data ?? []) as Division[]);
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

  useEffect(() => {
    if (!supabase || !user || !(isAppAdmin || isPlatformAdmin)) {
      setAccounts([]);
      return;
    }
    let mounted = true;
    const loadAccounts = async () => {
      const [{ data: accountRows, error }, { data: superRows }, { data: memberRows }] = await Promise.all([
        supabase.from("hw_user_accounts").select("user_id,login_id,display_name,account_role,is_active,created_at").order("created_at", { ascending: false }),
        supabase.from("hw_platform_admins").select("user_id"),
        supabase.from("hw_workspace_members").select("user_id,role").eq("workspace_id", workspaceId),
      ]);
      if (!mounted) return;
      if (error) {
        flash(messageFrom(error));
        return;
      }
      const superIds = new Set((superRows ?? []).map((row: { user_id: string }) => row.user_id));
      const memberRoles = new Map((memberRows ?? []).map((row: { user_id: string; role: string }) => [row.user_id, row.role]));
      setAccounts(((accountRows ?? []) as UserAccount[]).map((row) => ({
        ...row, is_super_admin: superIds.has(row.user_id), workspace_role: memberRoles.get(row.user_id) || "Belum diberi akses",
      })));
    };
    void loadAccounts();
    return () => { mounted = false; };
  }, [supabase, user, workspaceId, isAppAdmin, isPlatformAdmin, refreshKey, flash]);

  const doAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setAuthMessage("");
    try {
      const normalizedId = loginInput.trim().toLowerCase().replace(/\s+/g, "");
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

  const defaultTaskForm = (dueDate = "") => ({
    title: "", description: "", priority: "medium", start_date: localDateKey(new Date()),
    due_date: dueDate, category: categories[0]?.name ?? "Operasional", division_ids: [] as string[],
    assigned_to: user?.id ?? "", status: "todo", progress: 0,
  });
  const openTaskEditor = (task?: Task, dueDate?: string) => {
    setEditingTaskId(task?.id ?? null);
    setTaskForm(task ? {
      title: task.title, description: task.description ?? "", priority: task.priority,
      start_date: task.start_date ?? localDateKey(new Date()), due_date: task.due_date ?? "",
      category: task.category || categories[0]?.name || "Pekerjaan Umum",
      division_ids: Array.isArray(task.division_ids) ? task.division_ids : [],
      assigned_to: task.assigned_to ?? "",
      status: task.status, progress: task.progress ?? 0,
    } : defaultTaskForm(dueDate ?? ""));
    setShowTaskModal(true);
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user || !activeWorkspace) return;
    setBusy(true);
    try {
      const payload = {
        title: taskForm.title.trim(), description: taskForm.description.trim(), priority: taskForm.priority,
        start_date: taskForm.start_date || null, due_date: taskForm.due_date || null,
        category: taskForm.category, division_ids: taskForm.division_ids.filter((id: string) => divisions.some((division) => division.id === id)),
        assigned_to: taskForm.assigned_to || null, status: taskForm.status,
        progress: taskForm.status === "done" ? 100 : Math.max(0, Math.min(100, Number(taskForm.progress) || 0)),
      };
      const { error } = editingTaskId
        ? await supabase.from("hw_tasks").update(payload).eq("id", editingTaskId)
        : await supabase.from("hw_tasks").insert({ workspace_id: activeWorkspace.id, created_by: user.id, ...payload });
      if (error) throw error;
      setShowTaskModal(false);
      setEditingTaskId(null);
      setTaskForm(defaultTaskForm());
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

  const invokeAccountAdmin = async (payload: Record<string, unknown>) => {
    if (!supabase) throw new Error("Supabase belum terhubung.");
    const { data, error } = await supabase.functions.invoke("hw-admin-users", { body: payload });
    if (error) throw new Error(data?.error || error.message || "Permintaan pengelolaan akun gagal.");
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accountForm.workspaceId) { flash("Pilih workspace yang akan diberikan ke akun ini."); return; }
    setBusy(true);
    try {
      const payload = {
        action: "create",
        loginId: accountForm.loginId.trim().toLowerCase().replace(/\s+/g, ""),
        fullName: accountForm.fullName.trim(),
        password: accountForm.password,
        role: isPlatformAdmin ? accountForm.role : "user",
        workspaceRole: accountForm.workspaceRole,
      };
      await invokeAccountAdmin(payload);
      setShowAccountModal(false);
      setAccountForm({ loginId: "", fullName: "", password: "", role: "user", workspaceRole: "member" });
      setRefreshKey((value) => value + 1);
      flash("Akun berhasil dibuat dan langsung diberi akses workspace.");
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
  };

  const changeAccountStatus = async (account: UserAccount) => {
    if (account.is_super_admin) return;
    try {
      await invokeAccountAdmin({ action: "set-active", userId: account.user_id, active: !account.is_active });
      setRefreshKey((value) => value + 1);
      flash(account.is_active ? "Akun dinonaktifkan." : "Akun diaktifkan kembali.");
    } catch (error) { flash(messageFrom(error)); }
  };

  const resetAccountPassword = async (account: UserAccount) => {
    if (account.is_super_admin) return;
    const password = window.prompt("Masukkan password sementara baru (minimal 8 karakter):");
    if (password === null) return;
    if (password.length < 8 || password.length > 128) {
      flash("Password harus 8–128 karakter.");
      return;
    }
    try {
      await invokeAccountAdmin({ action: "reset-password", userId: account.user_id, password });
      flash("Password akun berhasil direset.");
    } catch (error) { flash(messageFrom(error)); }
  };

  const renameAccount = async (account: UserAccount) => {
    if (account.is_super_admin) return;
    const fullName = window.prompt("Nama pengguna:", account.display_name);
    if (fullName === null || fullName.trim() === account.display_name) return;
    try {
      await invokeAccountAdmin({ action: "update-profile", userId: account.user_id, fullName: fullName.trim() });
      setRefreshKey((value) => value + 1);
      flash("Nama pengguna berhasil diperbarui.");
    } catch (error) { flash(messageFrom(error)); }
  };

  const updateAccountRole = async (account: UserAccount, role: string) => {
    if (!isPlatformAdmin || account.is_super_admin) return;
    try {
      await invokeAccountAdmin({ action: "set-role", userId: account.user_id, role });
      setRefreshKey((value) => value + 1);
      flash("Role akun diperbarui.");
    } catch (error) { flash(messageFrom(error)); }
  };



  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user || !workspaceId || !canManage) return;
    const name = categoryForm.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      const payload = { name, color: categoryForm.color };
      const result = editingCategoryId
        ? await supabase.from("hw_categories").update(payload).eq("id", editingCategoryId).eq("workspace_id", workspaceId)
        : await supabase.from("hw_categories").insert({ workspace_id: workspaceId, created_by: user.id, ...payload });
      if (result.error) throw result.error;
      setCategoryForm({ name: "", color: "#16836A" }); setEditingCategoryId(null);
      setRefreshKey((value) => value + 1);
      flash(editingCategoryId ? "Kategori berhasil diperbarui." : "Kategori berhasil ditambahkan.");
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
  };
  const removeCategory = async (category: Category) => {
    if (!supabase || !window.confirm(`Hapus kategori "${category.name}"?`)) return;
    if (tasks.some((task) => task.category === category.name)) { flash("Kategori masih dipakai oleh task. Ubah kategori task terlebih dahulu."); return; }
    const { error } = await supabase.from("hw_categories").delete().eq("id", category.id).eq("workspace_id", workspaceId);
    if (error) flash(messageFrom(error));
    else { setRefreshKey((value) => value + 1); flash("Kategori dihapus."); }
  };
  const saveDivision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !user || !workspaceId || !canManage) return;
    const name = divisionForm.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      const payload = { name, color: divisionForm.color, updated_at: new Date().toISOString() };
      const result = editingDivisionId
        ? await supabase.from("hw_divisions").update(payload).eq("id", editingDivisionId).eq("workspace_id", workspaceId)
        : await supabase.from("hw_divisions").insert({ workspace_id: workspaceId, created_by: user.id, ...payload });
      if (result.error) throw result.error;
      setDivisionForm({ name: "", color: "#4386AE" }); setEditingDivisionId(null);
      setRefreshKey((value) => value + 1);
      flash(editingDivisionId ? "Divisi berhasil diperbarui." : "Divisi berhasil ditambahkan.");
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
  };
  const removeDivision = async (division: Division) => {
    if (!supabase || !window.confirm(`Hapus divisi "${division.name}"?`)) return;
    if (tasks.some((task) => (task.division_ids ?? []).includes(division.id))) { flash("Divisi masih dipakai oleh task. Ubah pilihan divisi pada task terlebih dahulu."); return; }
    const { error } = await supabase.from("hw_divisions").delete().eq("id", division.id).eq("workspace_id", workspaceId);
    if (error) flash(messageFrom(error));
    else { setRefreshKey((value) => value + 1); flash("Divisi dihapus."); }
  };

  const downloadBackup = () => {
    const backup = {
      app: "HUB WORKSPACE",
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace: { id: activeWorkspace?.id, name: activeWorkspace?.name },
      data: { tasks, notes, events },
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hub-workspace-backup-${localDateKey(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    flash("Backup berhasil diunduh.");
  };

  const restoreBackup = async (file?: File) => {
    if (!file || !supabase || !user || !activeWorkspace) return;
    if (file.size > 10 * 1024 * 1024) { flash("Ukuran file backup maksimal 10 MB."); return; }
    if (!window.confirm("Pulihkan data dari file backup? Data yang ada tidak dihapus; data backup akan ditambahkan ke workspace ini.")) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; backupVersion?: number; data?: { tasks?: Task[]; notes?: Note[]; events?: EventItem[] } };
      if (parsed.app !== "HUB WORKSPACE" || parsed.backupVersion !== 1 || !parsed.data) throw new Error("File backup tidak dikenali atau versinya tidak didukung.");
      const backupTasks = Array.isArray(parsed.data.tasks) ? parsed.data.tasks : [];
      const backupNotes = Array.isArray(parsed.data.notes) ? parsed.data.notes : [];
      const backupEvents = Array.isArray(parsed.data.events) ? parsed.data.events : [];
      if (backupTasks.length > 5000 || backupNotes.length > 2000 || backupEvents.length > 2000) throw new Error("Jumlah data dalam backup melebihi batas.");
      const taskRows = backupTasks.filter((item) => item && typeof item.title === "string" && item.title.trim()).map((item) => ({
        workspace_id: activeWorkspace.id, created_by: user.id,
        title: item.title.slice(0, 240), description: (item.description ?? "").slice(0, 5000),
        status: (["todo","in_progress","waiting","done","cancelled"].includes(item.status) ? item.status : "todo"),
        priority: (["low","medium","high","urgent"].includes(item.priority) ? item.priority : "medium"),
        progress: Math.max(0, Math.min(100, Number(item.progress) || 0)),
        start_date: item.start_date || null,
        due_date: item.due_date || null,
        category: typeof item.category === "string" && categories.some((category) => category.name === item.category) ? item.category : (categories[0]?.name ?? "Operasional"),
        division_ids: Array.isArray(item.division_ids) ? item.division_ids.filter((id: string) => divisions.some((division) => division.id === id)) : [],
        assigned_to: item.assigned_to && members.some((member) => member.user_id === item.assigned_to) ? item.assigned_to : null,
      }));
      const noteRows = backupNotes.filter((item) => item && typeof item.content === "string").map((item) => ({
        workspace_id: activeWorkspace.id, created_by: user.id,
        title: (item.title || "Catatan Pulihan").slice(0, 240), content: item.content.slice(0, 12000), is_pinned: Boolean(item.is_pinned),
      }));
      const eventRows = backupEvents.filter((item) => item && typeof item.title === "string" && item.starts_at && !Number.isNaN(new Date(item.starts_at).getTime())).map((item) => ({
        workspace_id: activeWorkspace.id, created_by: user.id,
        title: item.title.slice(0, 240), description: (item.description ?? "").slice(0, 5000),
        location: (item.location ?? "").slice(0, 500), starts_at: new Date(item.starts_at).toISOString(),
        ends_at: item.ends_at && !Number.isNaN(new Date(item.ends_at).getTime()) ? new Date(item.ends_at).toISOString() : null,
        all_day: Boolean(item.all_day),
      }));
      if (taskRows.length) { const { error } = await supabase.from("hw_tasks").insert(taskRows); if (error) throw error; }
      if (noteRows.length) { const { error } = await supabase.from("hw_notes").insert(noteRows); if (error) throw error; }
      if (eventRows.length) { const { error } = await supabase.from("hw_calendar_events").insert(eventRows); if (error) throw error; }
      setRefreshKey((value) => value + 1);
      flash(`Pemulihan selesai: ${taskRows.length} tugas, ${noteRows.length} catatan, ${eventRows.length} agenda.`);
    } catch (error) { flash(messageFrom(error)); }
    finally { setBusy(false); }
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
    setLoginId("");
    setIsAppAdmin(false);
    setIsPlatformAdmin(false);
    setAccounts([]);
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

  const title = ({ overview: "Dashboard", calendar: "Kalender", tasks: "Daftar Tugas", board: "Kanban", notes: "Catatan Cepat", settings: "Pengaturan & Backup", team: "Team & Access", users: "Manajemen Pengguna" } as Record<ViewId, string>)[activeView];
  const upcomingEvents = events.filter((event) => new Date(event.starts_at).getTime() >= Date.now()).slice(0, 4);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">H</div>
          <div><b>HUB WORKSPACE</b><span>Task & Kalender Kerja</span></div>
        </div>
        <div className="workspace-picker workspace-single">
          <div className="workspace-symbol">⌂</div>
          <div className="workspace-picker-copy"><small>WORKSPACE UTAMA</small><strong>HUB WORKSPACE</strong></div>
        </div>
        <div className="sidebar-section-label">MENU UTAMA</div>
        <nav className="side-nav">
          {navItems.map((item) => (
            <button key={item.id} className={activeView === item.id || (item.id === "settings" && (activeView === "team" || activeView === "users")) ? "nav-item active" : "nav-item"} onClick={() => setActiveView(item.id)}>
              <span className="nav-icon">{item.icon}</span><span className="nav-text">{item.label}</span>
              {item.id === "tasks" && tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length > 0 && <small>{tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-info">
          <b>Workspace terhubung</b>
          <span>Data tersimpan aman di cloud dan dapat diakses bersama sesuai hak akses.</span>
          <i><span /></i>
          <small>SUPABASE CLOUD SYNC</small>
        </div>
        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="avatar">{initials(profileName)}</div>
            <div className="profile-copy"><b>{profileName}</b><span>ID: {loginId.toUpperCase()} · {isPlatformAdmin ? "SUPER ADMIN" : isAppAdmin ? "ADMIN" : "USER"}</span></div>
            <button className="icon-button" onClick={signOut} title="Keluar">↗</button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>HUB WORKSPACE</span><b>/</b><strong>{title}</strong></div>
          <div className="topbar-right">
            <span className="sync-label"><i /> Cloud tersinkron</span>
            <span className="top-role">{isPlatformAdmin ? "SUPER ADMIN" : isAppAdmin ? "ADMIN" : "WORKSPACE USER"}</span>
            <button className="avatar top-avatar" onClick={signOut} title="Keluar">{initials(profileName)}</button>
          </div>
        </header>
        <div className="page-content">
          <div className="mobile-page-heading">
            <div className="mobile-brand-mark">H</div>
            <div><b>HUB WORKSPACE</b><span>{activeWorkspace?.name ?? "Workspace"}</span></div>
            <button className="icon-button" onClick={signOut}>↗</button>
          </div>


          {activeView === "overview" && <>
            <div className="workspace-banner">
              <div><span>HUB WORKSPACE · WORKSPACE AKTIF</span><b>{activeWorkspace?.name ?? "Workspace"}</b><small>Kelola pekerjaan, deadline, agenda, dan catatan dari satu tempat.</small></div>
              <span className="cloud-badge"><i /> CLOUD SYNC AKTIF</span>
            </div>
            <div className="page-heading">
              <div><div className="eyebrow">RINGKASAN AKTIVITAS</div><h1>To-Do List & <em>Kalender Kerja</em></h1><p>Pantau tugas harian, prioritas, deadline, agenda, dan progres pekerjaan.</p></div>
              <div className="heading-actions"><button className="secondary-button" onClick={() => { setEditingNoteId(null); setNoteForm({ title: "", content: "" }); setShowNoteModal(true); }}>＋ Catatan Cepat</button><button className="primary-button" onClick={() => openTaskEditor()}>＋ Input Task</button><button className="print-button" onClick={() => window.print()}>Print / PDF</button></div>
            </div>
            <div className="stats-grid six-stats">
              <StatCard label="Total Task" value={tasks.length} detail="Semua tugas tersimpan" icon="☷" />
              <StatCard label="Selesai" value={completedCount} detail="Tugas yang sudah closed" icon="✓" accent="green" />
              <StatCard label="Progress" value={avgProgress} detail="Rata-rata penyelesaian (%)" icon="◔" accent="orange" />
              <StatCard label="Terlambat" value={overdueCount} detail="Butuh follow up" icon="!" accent="red" />
              <StatCard label="Hari Ini" value={todayTasks.length} detail="Tugas jatuh tempo hari ini" icon="◷" />
              <StatCard label="Minggu Ini" value={weekTasks.length} detail="Agenda 7 hari ke depan" icon="▦" accent="green" />
            </div>
            <div className="dashboard-columns">
              <section className="panel-card dashboard-visual">
                <div className="section-head"><div><div className="eyebrow">ANALISIS PEKERJAAN</div><h3>Dashboard Visual</h3><p>Distribusi tugas berdasarkan kategori dan prioritas.</p></div><button className="text-button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh</button></div>
                <div className="chart-pair">
                  <div className="chart-block"><b>By Category</b><div className="horizontal-bars">{categoryRows.map((row) => <div className="bar-row" key={row.label}><span>{row.label}</span><i><b style={{ width: `${tasks.length ? row.count / tasks.length * 100 : 0}%` }} /></i><strong>{row.count}</strong></div>)}</div></div>
                  <div className="chart-block"><b>By Priority</b><div className="horizontal-bars priority-bars">{priorityRows.map((row) => <div className="bar-row" key={row.tone}><span>{row.label}</span><i><b className={row.tone} style={{ width: `${tasks.length ? row.count / tasks.length * 100 : 0}%` }} /></i><strong>{row.count}</strong></div>)}</div></div>
                </div>
                <div className="dashboard-bottom-note"><span>✦</span><div><b>Jaga fokus pada prioritas berikutnya.</b><small>Mulai dari tugas yang mendekati deadline dan berdampak paling besar.</small></div></div>
              </section>
              <div className="dashboard-side">
                <section className="panel-card today-panel">
                  <div className="section-head"><div><div className="eyebrow">TODAY AT A GLANCE</div><h3>Ringkasan Hari Ini</h3></div><span className="today-date">{new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" }).format(new Date())}</span></div>
                  <div className="today-summary"><strong>{todayTasks.length}</strong><span>tugas jatuh tempo hari ini</span><small>{overdueCount} tugas terlambat perlu follow up</small></div>
                  <div className="today-focus"><b>Fokus berikutnya</b>{(todayTasks[0] || weekTasks[0]) ? <span>{(todayTasks[0] || weekTasks[0]).title}</span> : <span>Belum ada deadline dekat. Waktunya merencanakan pekerjaan.</span>}</div>
                  <button className="text-button" onClick={() => setActiveView("tasks")}>Lihat semua tugas ↗</button>
                </section>
                <section className="panel-card quick-tips">
                  <div className="section-head"><div><div className="eyebrow">QUICK TIPS</div><h3>Tips Produktivitas</h3></div><span className="tips-icon">✦</span></div>
                  <p>Tugas tanpa deadline cenderung tertunda. Tentukan tenggat dan PIC agar tindak lanjut lebih jelas.</p>
                  <div className="tip-footer"><span>1 TIP HARI INI</span><b>Plan · Prioritize · Finish</b></div>
                </section>
              </div>
            </div>
            <section className="panel-card dashboard-priorities">
              <div className="section-head"><div><div className="eyebrow">PRIORITAS 7 HARI KE DEPAN</div><h3>Agenda dan deadline terdekat</h3></div><button className="text-button" onClick={() => setActiveView("calendar")}>Buka Kalender ↗</button></div>
              {weekTasks.length ? <div className="upcoming-task-list">{weekTasks.slice(0, 6).map((task) => <div className="upcoming-task" key={task.id}><span className="upcoming-date">{dateLabel(task.due_date)}</span><b>{task.title}</b><span className={`pill ${priorityMeta[task.priority].tone}`}>{priorityMeta[task.priority].label}</span><span className={`pill ${statusMeta[task.status].tone}`}>{statusMeta[task.status].label}</span><button className="icon-button" onClick={() => openTaskEditor(task)}>✎</button></div>)}</div> : <EmptyInline title="Belum ada deadline minggu ini." detail="Tambahkan deadline agar agenda lebih mudah dipantau." action="＋ Input Task" onClick={() => openTaskEditor()} />}
            </section>
          </>}
 
          {activeView === "tasks" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">PENGELOLAAN PEKERJAAN</div><h1>Daftar <em>Tugas</em></h1><p>Semua pekerjaan, deadline, PIC, prioritas, dan progres dalam satu tabel.</p></div><button className="primary-button" onClick={() => openTaskEditor()}>＋ Input Task</button></div>
            <div className="task-toolbar"><div className="search-box"><span>⌕</span><input value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} placeholder="Cari tugas, PIC, atau keterangan…" /></div><select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}><option value="all">Semua Status</option><option value="todo">Belum dikerjakan</option><option value="in_progress">Berjalan</option><option value="waiting">Menunggu</option><option value="done">Selesai</option><option value="cancelled">Dibatalkan</option></select><button className="secondary-button" onClick={() => setActiveView("board")}>▥ Tampilan Kanban</button></div>
            <section className="panel-card table-card">
              <div className="task-list-heading"><div><b>Daftar seluruh pekerjaan</b><span>{visibleTasks.length} tugas ditemukan</span></div><span className="table-info">Klik Edit untuk memperbarui data tugas</span></div>
              {visibleTasks.length === 0 ? <EmptyState title="Belum ada tugas pada filter ini." detail="Tambahkan pekerjaan atau ubah filter pencarian." action="＋ Input Task" onClick={() => openTaskEditor()} /> :
                <div className="task-table-wrap"><table className="task-table office-task-table"><thead><tr><th>Tanggal</th><th>Deadline</th><th>Kategori</th><th>Divisi</th><th>Tugas</th><th>PIC</th><th>Priority</th><th>Status</th><th>Progress</th><th>Aksi</th></tr></thead><tbody>
                  {visibleTasks.map((task) => <tr key={task.id}>
                    <td className="date-cell">{dateLabel(task.start_date || task.created_at.slice(0,10))}</td>
                    <td className="date-cell">{dateLabel(task.due_date)}</td>
                    <td><span className="category-tag">{task.category || "Tanpa kategori"}</span></td>
                    <td><div className="task-division-tags">{(task.division_ids ?? []).map((id) => divisions.find((division) => division.id === id)).filter(Boolean).map((division) => <span key={division!.id}>{division!.name}</span>)}</div></td>
                    <td><div className="table-task-title"><b>{task.title}</b><span>{task.description || "Tidak ada keterangan"}</span></div></td>
                    <td><span className="pic-name">{members.find((member) => member.user_id === task.assigned_to)?.display_name ?? (task.assigned_to === user?.id ? profileName : "Belum ditentukan")}</span></td>
                    <td><span className={`priority-text ${task.priority}`}>{priorityMeta[task.priority].label}</span></td>
                    <td><select className={`status-select status-${task.status}`} value={task.status} onChange={(e) => changeTask(task.id, { status: e.target.value as Task["status"], progress: e.target.value === "done" ? 100 : task.progress })}><option value="todo">Belum</option><option value="in_progress">Berjalan</option><option value="waiting">Menunggu</option><option value="done">Selesai</option><option value="cancelled">Batal</option></select></td>
                    <td><div className="table-progress"><span>{task.progress}%</span><i><b style={{ width: `${task.progress}%` }} /></i></div></td>
                    <td><button className="edit-task-button" onClick={() => openTaskEditor(task)}>Edit</button><button className="icon-button danger-hover" title="Hapus tugas" onClick={() => deleteTask(task.id)}>×</button></td>
                  </tr>)}
                </tbody></table></div>}
            </section>
          </>}
 
          {activeView === "board" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">VISUAL WORKFLOW</div><h1>Kanban <em>Board</em></h1><p>Pindahkan kartu sesuai perkembangan pekerjaan.</p></div><button className="primary-button" onClick={() => openTaskEditor()}>＋ Input Task</button></div>
            <div className="kanban-intro"><span>WORKFLOW TUGAS</span><b>{tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length} pekerjaan aktif</b><small>Drag & drop kartu untuk mengubah status.</small></div>
            <div className="board-scroll"><div className="kanban-grid">
              {(["todo", "in_progress", "waiting", "done"] as const).map((status) => {
                const columnTasks = tasks.filter((task) => task.status === status);
                return <section className={`kanban-column kanban-${status}`} key={status} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (draggedTask) { void changeTask(draggedTask, { status, progress: status === "done" ? 100 : (tasks.find((task) => task.id === draggedTask)?.progress ?? 0) }); setDraggedTask(null); } }}>
                  <div className="kanban-head"><span className={`status-dot ${statusMeta[status].tone}`} /><b>{status === "todo" ? "Belum Dikerjakan" : status === "in_progress" ? "Sedang Berjalan" : status === "waiting" ? "Menunggu" : "Selesai"}</b><small>{columnTasks.length}</small></div>
                  {columnTasks.map((task) => <article className="kanban-card" key={task.id} draggable onDragStart={() => setDraggedTask(task.id)} onDragEnd={() => setDraggedTask(null)}>
                    <div className="kanban-card-top"><span className={`pill ${priorityMeta[task.priority].tone}`}>{priorityMeta[task.priority].label}</span><div className="row-actions"><button className="icon-button tiny" title="Edit task" onClick={() => openTaskEditor(task)}>✎</button><button className="icon-button tiny danger-hover" title="Hapus task" onClick={() => deleteTask(task.id)}>×</button></div></div>
                    <span className="category-tag">{task.category || "Tanpa kategori"}</span><h4>{task.title}</h4><p>{task.description || "Tidak ada keterangan tambahan."}</p>
                    <div className="kanban-progress"><span><i style={{ width: `${task.progress}%` }} /></span><small>{task.progress}%</small></div>
                    <div className="kanban-card-bottom"><span>◷ {dateLabel(task.due_date)}</span><span className="kanban-assignee">{members.find((member) => member.user_id === task.assigned_to)?.display_name ?? "Belum ada PIC"}</span></div>
                    <select className="kanban-status-change" value={task.status} aria-label="Ubah status tugas" onChange={(e) => changeTask(task.id, { status: e.target.value as Task["status"], progress: e.target.value === "done" ? 100 : task.progress })}><option value="todo">Belum dikerjakan</option><option value="in_progress">Sedang berjalan</option><option value="waiting">Menunggu</option><option value="done">Selesai</option></select>
                  </article>)}
                  {columnTasks.length === 0 && <div className="kanban-empty">Belum ada kartu tugas</div>}
                </section>;
              })}
            </div></div>
          </>}
 
          {activeView === "calendar" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">PERENCANAAN & AGENDA</div><h1>Kalender <em>Bulanan</em></h1><p>Pantau deadline tugas dan agenda dalam satu tampilan kalender.</p></div><button className="primary-button" onClick={() => openTaskEditor()}>＋ Input Task</button></div>
            <section className="panel-card calendar-month-panel">
              <div className="calendar-month-head"><div><span>KALENDER KERJA</span><h3>{new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(calendarMonth)}</h3></div><div className="calendar-month-controls"><button className="secondary-button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>←</button><button className="secondary-button" onClick={() => setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hari ini</button><button className="secondary-button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>→</button></div></div>
              <div className="month-grid">
                {["Senin","Selasa","Rabu","Kamis","Jumat","Sabtu","Minggu"].map((day) => <div className="month-weekday" key={day}>{day}</div>)}
                {calendarCells.map((day) => {
                  const key = localDateKey(day);
                  const dayTasks = tasks.filter((task) => task.due_date === key);
                  const dayEvents = events.filter((event) => localDateKey(new Date(event.starts_at)) === key);
                  const inMonth = day.getMonth() === calendarMonth.getMonth();
                  return <div className={`month-day ${inMonth ? "" : "outside-month"} ${key === todayKey ? "is-today" : ""}`} key={key} onDoubleClick={() => openTaskEditor(undefined, key)}>
                    <div className="month-day-head"><b>{day.getDate()}</b><small>{dayTasks.length + dayEvents.length} agenda</small></div>
                    <div className="month-day-items">
                      {dayTasks.slice(0, 3).map((task) => <button key={task.id} className={`calendar-task-chip ${task.status}`} onClick={() => openTaskEditor(task)} title={task.title}>{task.title}</button>)}
                      {dayEvents.slice(0, 2).map((event) => <span key={event.id} className="calendar-event-chip" title={event.title}>● {event.title}</span>)}
                      {dayTasks.length + dayEvents.length > 5 && <small className="more-agenda">+{dayTasks.length + dayEvents.length - 5} lainnya</small>}
                    </div>
                    <button className="add-on-day" onClick={() => openTaskEditor(undefined, key)}>＋</button>
                  </div>;
                })}
              </div>
              <p className="calendar-hint">Tips: klik agenda untuk mengedit, atau klik dua kali tanggal untuk membuat tugas baru.</p>
            </section>
            <div className="calendar-summary-grid">
              <section className="panel-card"><div className="section-head"><div><div className="eyebrow">DEADLINE DEKAT</div><h3>Prioritas 7 Hari ke Depan</h3></div><span className="subtle-count">{weekTasks.length} tugas</span></div>{weekTasks.length ? weekTasks.slice(0,5).map((task) => <div className="event-row" key={task.id}><div className="event-date"><b>{new Date(task.due_date + "T00:00:00").getDate()}</b><span>{new Intl.DateTimeFormat("id-ID",{month:"short"}).format(new Date(task.due_date + "T00:00:00"))}</span></div><div className="event-copy"><b>{task.title}</b><span>{dateLabel(task.due_date)} · {priorityMeta[task.priority].label}</span></div><button className="icon-button" onClick={() => openTaskEditor(task)}>✎</button></div>) : <EmptyInline title="Tidak ada deadline dekat." detail="Semua agenda mendatang akan tampil di sini." action="＋ Buat tugas" onClick={() => openTaskEditor()} />}</section>
              <section className="panel-card calendar-side"><div className="eyebrow">AGENDA WORKSPACE</div><h3>Waktu kerja lebih tertata.</h3><p>Jadikan deadline dan agenda terlihat sejak awal agar tim dapat menentukan prioritas.</p><div className="calendar-side-stat"><b>{todayTasks.length}</b><span>Jatuh tempo hari ini</span></div><div className="calendar-side-stat"><b>{overdueCount}</b><span>Terlambat</span></div></section>
            </div>
          </>}
 
          {activeView === "notes" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">RUANG IDE & CATATAN</div><h1>Catatan <em>Cepat</em></h1><p>Simpan informasi, ide, dan hasil diskusi agar mudah ditemukan kembali.</p></div><button className="primary-button" onClick={() => { setEditingNoteId(null); setNoteForm({ title: "", content: "" }); setShowNoteModal(true); }}>＋ Catatan Baru</button></div>
            {notes.length === 0 ? <section className="panel-card"><EmptyState title="Belum ada catatan." detail="Mulai dengan catatan meeting, ide singkat, atau informasi penting." action="＋ Buat Catatan" onClick={() => setShowNoteModal(true)} /></section> :
              <div className="notes-grid">{notes.map((note) => <article className="note-card" key={note.id}><div className="note-card-head"><span className="note-symbol">▤</span><div className="note-actions"><button className={note.is_pinned ? "icon-button pinned" : "icon-button"} title="Pin catatan" onClick={() => togglePin(note)}>◆</button><button className="icon-button danger-hover" title="Hapus catatan" onClick={() => deleteNote(note.id)}>×</button></div></div><button className="note-content-button" onClick={() => { setEditingNoteId(note.id); setNoteForm({ title: note.title, content: note.content }); setShowNoteModal(true); }}><h3>{note.title}</h3><p>{note.content || "Catatan kosong. Tambahkan informasi…"}</p></button><div className="note-card-foot"><span>{note.is_pinned ? "PINNED" : "CATATAN"}</span><small>Diperbarui {dateLabel(note.updated_at.slice(0, 10))}</small></div></article>)}</div>}
          </>}
 
          {activeView === "settings" && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">PENGATURAN WORKSPACE</div><h1>Pengaturan <em>Master Data & Pengguna</em></h1><p>Workspace hanya satu. Kelola kategori, divisi, dan akun pengguna dari sini.</p></div></div>
            {(isAppAdmin || isPlatformAdmin) && <>
              <div className="access-section-heading"><div><div className="eyebrow">TEAM ACCESS & USER MANAGEMENT</div><h2>Manajemen Pengguna</h2><p>Tambah akun dan tentukan hak aksesnya sekaligus.</p></div><button className="primary-button" onClick={() => { setAccountForm({ loginId: "", fullName: "", password: "", role: "user", workspaceRole: "member" }); setShowAccountModal(true); }}>＋ Tambah Akun / Pengguna</button></div>
              <div className="stats-grid account-stats">
                <StatCard label="Total akun" value={accounts.length} detail="Akun terdaftar" icon="♙" />
                <StatCard label="Akun aktif" value={accounts.filter((account) => account.is_active).length} detail="Dapat login" icon="✓" accent="green" />
                <StatCard label="Administrator" value={accounts.filter((account) => account.account_role === "admin" || account.is_super_admin).length} detail="Admin aplikasi" icon="⚙" accent="orange" />
                <StatCard label="Nonaktif" value={accounts.filter((account) => !account.is_active).length} detail="Akses login diblokir" icon="!" accent="red" />
              </div>
              <section className="panel-card table-card account-table-card">
                <div className="section-head account-table-head"><div><div className="eyebrow">USER DIRECTORY</div><h3>Daftar akun pengguna</h3></div><span className="subtle-count">{accounts.length} akun</span></div>
                {accounts.length === 0 ? <EmptyState title="Belum ada akun tambahan." detail="Tambahkan pengguna pertama ke workspace utama." action="＋ Tambah Pengguna" onClick={() => setShowAccountModal(true)} /> :
                  <div className="task-table-wrap"><table className="task-table account-table"><thead><tr><th>Pengguna</th><th>ID Login</th><th>Role Aplikasi</th><th>Akses Workspace</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>
                    {accounts.map((account) => <tr key={account.user_id}>
                      <td><div className="account-person"><div className="avatar">{initials(account.display_name)}</div><div className="table-task-title"><b>{account.display_name}</b><span>{account.is_super_admin ? "Super Admin" : account.account_role === "admin" ? "Admin aplikasi" : "User"}</span></div></div></td>
                      <td><code className="login-id-code">{account.login_id.toUpperCase()}</code></td>
                      <td>{account.is_super_admin ? <span className="role-pill owner">Super Admin</span> : isPlatformAdmin ? <select className="status-select" value={account.account_role} onChange={(e) => updateAccountRole(account, e.target.value)}><option value="user">User</option><option value="admin">Admin</option></select> : <span className="role-pill">{account.account_role}</span>}</td>
                      <td><span className="role-pill">{account.workspace_role || "Belum diberi akses"}</span></td>
                      <td><span className={account.is_active ? "status-label active" : "status-label inactive"}><i />{account.is_active ? "Aktif" : "Nonaktif"}</span></td>
                      <td className="date-cell">{dateLabel(account.created_at.slice(0, 10))}</td>
                      <td><div className="account-actions">{!account.is_super_admin && <><button className="icon-button" title="Ubah nama" onClick={() => renameAccount(account)}>✎</button><button className="icon-button" title="Reset password" onClick={() => resetAccountPassword(account)}>↻</button><button className={account.is_active ? "icon-button danger-hover" : "icon-button"} title={account.is_active ? "Nonaktifkan akun" : "Aktifkan akun"} onClick={() => changeAccountStatus(account)}>{account.is_active ? "⊘" : "✓"}</button></>}</div></td>
                    </tr>)}
                  </tbody></table></div>}
              </section>
            </>}
            {canManage && <div className="master-data-grid">
              <section className="panel-card master-data-card">
                <div className="section-head"><div><div className="eyebrow">MASTER DATA</div><h3>Kategori Task</h3><p>Kategori tampil di form input dan dashboard.</p></div><span className="subtle-count">{categories.length} kategori</span></div>
                <form className="master-data-form" onSubmit={saveCategory}>
                  <label>Nama Kategori<input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="Contoh: Audit / Monitoring" required /></label>
                  <label>Warna<input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })} /></label>
                  <div><button className="primary-button">{editingCategoryId ? "Simpan Perubahan" : "＋ Tambah Kategori"}</button>{editingCategoryId && <button type="button" className="secondary-button" onClick={() => { setEditingCategoryId(null); setCategoryForm({ name: "", color: "#16836A" }); }}>Batal</button>}</div>
                </form>
                <div className="master-data-list">{categories.map((category) => <div className="master-data-row" key={category.id}><span className="master-color-dot" style={{ background: category.color }} /><b>{category.name}</b><small>{tasks.filter((task) => task.category === category.name).length} task</small><button className="icon-button" title="Edit kategori" onClick={() => { setEditingCategoryId(category.id); setCategoryForm({ name: category.name, color: category.color }); }}>✎</button><button className="icon-button danger-hover" title="Hapus kategori" onClick={() => removeCategory(category)}>×</button></div>)}</div>
              </section>
              <section className="panel-card master-data-card">
                <div className="section-head"><div><div className="eyebrow">MASTER DATA</div><h3>Divisi</h3><p>Satu task bisa ditautkan ke beberapa divisi sekaligus.</p></div><span className="subtle-count">{divisions.length} divisi</span></div>
                <form className="master-data-form" onSubmit={saveDivision}>
                  <label>Nama Divisi<input value={divisionForm.name} onChange={(e) => setDivisionForm({ ...divisionForm, name: e.target.value })} placeholder="Contoh: Transport / Line Haul" required /></label>
                  <label>Warna<input type="color" value={divisionForm.color} onChange={(e) => setDivisionForm({ ...divisionForm, color: e.target.value })} /></label>
                  <div><button className="primary-button">{editingDivisionId ? "Simpan Perubahan" : "＋ Tambah Divisi"}</button>{editingDivisionId && <button type="button" className="secondary-button" onClick={() => { setEditingDivisionId(null); setDivisionForm({ name: "", color: "#4386AE" }); }}>Batal</button>}</div>
                </form>
                <div className="master-data-list">{divisions.map((division) => <div className="master-data-row" key={division.id}><span className="master-color-dot" style={{ background: division.color }} /><b>{division.name}</b><small>{tasks.filter((task) => (task.division_ids ?? []).includes(division.id)).length} task</small><button className="icon-button" title="Edit divisi" onClick={() => { setEditingDivisionId(division.id); setDivisionForm({ name: division.name, color: division.color }); }}>✎</button><button className="icon-button danger-hover" title="Hapus divisi" onClick={() => removeDivision(division)}>×</button></div>)}</div>
              </section>
            </div>}
            <div className="settings-grid settings-bottom-grid">
              <section className="panel-card settings-card"><div className="settings-icon">⇩</div><div className="eyebrow">DATA & KEAMANAN</div><h3>Backup Workspace</h3><p>Unduh salinan tugas, catatan, dan agenda dari satu workspace utama.</p><button className="primary-button" onClick={downloadBackup}>Unduh Backup JSON ↗</button><small>Data workspace saat ini saja.</small></section>
              <section className="panel-card settings-card"><div className="settings-icon">↥</div><div className="eyebrow">PEMULIHAN DATA</div><h3>Restore dari Backup</h3><p>Pulihkan data dari file backup HUB WORKSPACE. Data yang ada tidak dihapus.</p><label className="restore-file-button">Pilih File Backup<input type="file" accept="application/json,.json" onChange={(e) => { const file = e.target.files?.[0]; if (file) void restoreBackup(file); e.currentTarget.value = ""; }} /></label><small>Format .json · Maksimal 10 MB</small></section>
            </div>
            <section className="panel-card settings-note"><b>Informasi penyimpanan</b><p>Semua pengguna mengakses satu workspace bersama. Hak edit dan baca diatur berdasarkan role masing-masing.</p><span><i /> Koneksi database aktif</span></section>
          </>}
 
          {busy && <div className="loading-strip"><i /> Syncing workspace data</div>}
        </div>
        <footer className="app-footer"><span>HUB WORKSPACE</span><span>Personal focus. Shared momentum.</span><span>v1.0</span></footer>
      </main>

      <nav className="mobile-nav">{navItems.map((item) => <button key={item.id} className={activeView === item.id || (item.id === "settings" && (activeView === "team" || activeView === "users")) ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setActiveView(item.id)}><span>{item.icon}</span><small>{item.id === "overview" ? "Home" : item.id === "tasks" ? "Tugas" : item.id === "calendar" ? "Kalender" : item.id === "board" ? "Kanban" : item.id === "notes" ? "Catatan" : "Akses"}</small></button>)}</nav>

      {showTaskModal && <Modal className="task-modal" title={editingTaskId ? "Edit Task" : "Input Task"} subtitle="Lengkapi detail agar tugas mudah dipantau dan ditindaklanjuti." onClose={() => { setShowTaskModal(false); setEditingTaskId(null); }}>
        <form className="task-entry-form" onSubmit={createTask}>
          <div className="task-entry-grid">
            <label>Tanggal Rencana<input type="date" value={taskForm.start_date} onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value })} required /></label>
            <label>Deadline<input type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} /></label>
            <label>Kategori<select value={taskForm.category} onChange={(e) => setTaskForm({ ...taskForm, category: e.target.value })}>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
            <label>Priority<select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}><option value="low">Rendah</option><option value="medium">Medium</option><option value="high">Tinggi</option><option value="urgent">Urgent</option></select></label>
            <div className="task-division-picker task-field-wide-four"><span>Divisi <small>(bisa pilih lebih dari satu)</small></span><div>{divisions.map((division) => <label key={division.id} className={taskForm.division_ids.includes(division.id) ? "division-option selected" : "division-option"}><input type="checkbox" checked={taskForm.division_ids.includes(division.id)} onChange={(e) => setTaskForm({ ...taskForm, division_ids: e.target.checked ? [...taskForm.division_ids, division.id] : taskForm.division_ids.filter((id) => id !== division.id) })} /><i style={{ background: division.color }} />{division.name}</label>)}{divisions.length === 0 && <small>Tambahkan master divisi melalui Pengaturan.</small>}</div></div>
            <label className="task-field-wide-three">Rencana / Kegiatan<textarea autoFocus rows={3} value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="Contoh: Membuat laporan mingguan, follow up data supplier, menyiapkan materi meeting…" required /></label>
            <label>Status<select value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}><option value="todo">Belum Mulai</option><option value="in_progress">Sedang Berjalan</option><option value="waiting">Menunggu</option><option value="done">Selesai</option><option value="cancelled">Dibatalkan</option></select></label>
            <label>Progress (%)<input type="number" min="0" max="100" step="5" value={taskForm.status === "done" ? 100 : taskForm.progress} onChange={(e) => setTaskForm({ ...taskForm, progress: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
            <label>PIC / Owner<select value={taskForm.assigned_to} onChange={(e) => setTaskForm({ ...taskForm, assigned_to: e.target.value })}><option value="">Optional</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}{member.user_id === user?.id ? " (Kamu)" : ""}</option>)}</select></label>
            <label className="task-field-wide-two">Catatan / Next Action<textarea rows={3} value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Optional. Contoh: menunggu data dari PIC terkait, follow up besok…" /></label>
          </div>
          <div className="task-entry-actions"><button className="primary-button" disabled={busy}>{busy ? "Menyimpan…" : editingTaskId ? "Simpan Perubahan" : "Simpan Task"}</button><button type="button" className="secondary-button" onClick={() => setTaskForm(defaultTaskForm())}>Kosongkan Form</button></div>
        </form>
      </Modal>}

      {showNoteModal &&<Modal title={editingNoteId ? "Edit note" : "Write a note"} subtitle="A place for the details worth keeping." onClose={() => { setShowNoteModal(false); setEditingNoteId(null); }}><form className="modal-form" onSubmit={createNote}><label>Title<input autoFocus value={noteForm.title} onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })} placeholder="A thought to keep…" /></label><label>Your note<textarea rows={7} value={noteForm.content} onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })} placeholder="Write freely…" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setShowNoteModal(false); setEditingNoteId(null); }}>Cancel</button><button className="primary-button" disabled={busy}>{editingNoteId ? "Save changes ↗" : "Save note ↗"}</button></div></form></Modal>}

      {showEventModal && <Modal title="Add an event" subtitle="Put an important moment on the shared calendar." onClose={() => setShowEventModal(false)}><form className="modal-form" onSubmit={createEvent}><label>Event title<input autoFocus value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} placeholder="Team sync, project deadline…" required /></label><label>Description<textarea rows={2} value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} placeholder="What should everyone know?" /></label><label>Location<input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} placeholder="Meeting room or online link" /></label><div className="form-two"><label>Starts at<input type="datetime-local" value={eventForm.starts_at} onChange={(e) => setEventForm({ ...eventForm, starts_at: e.target.value })} required /></label><label>Ends at<input type="datetime-local" value={eventForm.ends_at} onChange={(e) => setEventForm({ ...eventForm, ends_at: e.target.value })} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowEventModal(false)}>Cancel</button><button className="primary-button" disabled={busy}>Add event ↗</button></div></form></Modal>}

      {showAccountModal && <Modal title="Buat Akun & Atur Akses" subtitle="Akun langsung ditambahkan ke workspace yang dipilih setelah disimpan." onClose={() => setShowAccountModal(false)}>
        <form className="modal-form account-entry-form" onSubmit={createAccount}>
          <div className="form-two">
            <label>ID Pengguna<input autoFocus value={accountForm.loginId} onChange={(e) => setAccountForm({ ...accountForm, loginId: e.target.value.toLowerCase().replace(/\s+/g, "") })} placeholder="Contoh: 10001597" autoCapitalize="none" required /></label>
            <label>Nama lengkap<input value={accountForm.fullName} onChange={(e) => setAccountForm({ ...accountForm, fullName: e.target.value })} placeholder="Nama pengguna" required /></label>
          </div>
          <label>Password awal<input type="password" value={accountForm.password} onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })} placeholder="Minimal 8 karakter" minLength={8} required /></label>
          <div className="form-two">
            <label>Workspace tujuan<input value="HUB WORKSPACE" readOnly /></label>
            <label>Role akses<select value={accountForm.workspaceRole} onChange={(e) => setAccountForm({ ...accountForm, workspaceRole: e.target.value })}><option value="member">Member — mengerjakan tugas</option><option value="admin">Admin — mengelola workspace</option><option value="viewer">Viewer — lihat saja</option></select></label>
          </div>
          {isPlatformAdmin && <label>Role aplikasi<select value={accountForm.role} onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value })}><option value="user">User</option><option value="admin">Admin aplikasi</option></select></label>}
          <div className="account-access-preview"><b>Akses setelah dibuat</b><span>HUB WORKSPACE · {accountForm.workspaceRole}</span><small>Pengguna dapat langsung melihat workspace ini setelah login menggunakan ID dan password.</small></div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAccountModal(false)}>Batal</button><button className="primary-button" disabled={busy}>Simpan Akun & Akses ↗</button></div>
        </form>
      </Modal>}

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
function Modal({ title, subtitle, children, onClose, className = "" }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><div className="eyebrow">HUB WORKSPACE</div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button close-button" onClick={onClose}>×</button></div>{children}</section></div>;
}
