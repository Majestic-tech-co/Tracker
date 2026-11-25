import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { ChevronLeft, ChevronRight, Footprints, Pencil, Trash2, Check, X } from "lucide-react";
import { LazyWalkMap as WalkMap } from "@/components/tracker/LazyWalkMap";
import {
  type DailyData,
  type Exercise,
  type LatLng,
  type Walk,
  type Workout,
  STEPS_GOAL,
  calculateDistance,
  dailyDataSchema,
  walksSchema,
  workoutOrNullSchema,
  dateToString,
  generateSingleDayWorkoutPlan,
  totalDistance,
} from "@/lib/tracker-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "A Step in the Right Direction — Tracker" },
      { name: "description", content: "Track walks on a map, generate workouts, log steps, and view it all on a calendar." },
      { property: "og:title", content: "A Step in the Right Direction" },
      { property: "og:description", content: "Your Walk, Your Workout." },
    ],
  }),
  component: TrackerPage,
});

type TabKey = "welcome" | "walks" | "workouts" | "steps" | "calendar";

const TABS: { key: TabKey; label: string }[] = [
  { key: "welcome", label: "Welcome" },
  { key: "walks", label: "Walks" },
  { key: "workouts", label: "Workouts" },
  { key: "steps", label: "Steps" },
  { key: "calendar", label: "Calendar" },
];

function useStored<T>(
  key: string,
  initial: T,
  schema: z.ZodType<T>,
  onError?: (message: string) => void,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const warnedWrite = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          setValue(parsed.data);
        } else {
          // Keep the unreadable data so it can be recovered, then start fresh.
          localStorage.setItem(`${key}.invalid`, raw);
          onErrorRef.current?.(`Saved "${key}" data was unreadable and has been reset.`);
        }
      }
    } catch {
      onErrorRef.current?.(`Saved "${key}" data could not be read.`);
    }
    loaded.current = true;
  }, [key, schema]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      warnedWrite.current = false;
    } catch {
      if (!warnedWrite.current) {
        warnedWrite.current = true;
        onErrorRef.current?.(
          "Could not save your data — browser storage may be full or disabled. Recent changes may be lost.",
        );
      }
    }
  }, [key, value]);

  return [value, setValue];
}

const MAX_ACCURACY_M = 50; // ignore GPS fixes less accurate than this
const MIN_STEP_KM = 0.005; // ignore points closer than 5 m to the last one

function useWalkDraft() {
  const [path, setPath] = useState<LatLng[]>([]);
  const [walkName, setWalkName] = useState("");
  const [walkDate, setWalkDate] = useState(dateToString(new Date()));
  const [walkNotes, setWalkNotes] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [liveLocation, setLiveLocation] = useState<LatLng | null>(null);
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);
  const [recording, setRecording] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // One-off fix to centre the map. Only requested on user action via locate().
  function locate() {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: LatLng = [pos.coords.latitude, pos.coords.longitude];
        setLiveLocation(p);
        setFlyTo(p);
        setGeoError(null);
      },
      (err) => setGeoError(err.message || "Unable to get your location."),
    );
  }

  // Continuous tracking only runs while the user is explicitly recording.
  useEffect(() => {
    if (!recording) return;
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by this browser.");
      setRecording(false);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p: LatLng = [pos.coords.latitude, pos.coords.longitude];
        setLiveLocation(p);
        setGeoError(null);
        if (pos.coords.accuracy > MAX_ACCURACY_M) return;
        setPath((prev) => {
          const last = prev[prev.length - 1];
          if (last && calculateDistance(last[0], last[1], p[0], p[1]) < MIN_STEP_KM) return prev;
          return [...prev, p];
        });
      },
      (err) => {
        setGeoError(err.message || "Unable to track your location.");
        if (err.code === err.PERMISSION_DENIED) setRecording(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [recording]);

  function reset() {
    setRecording(false);
    setPath([]);
    setWalkName("");
    setWalkDate(dateToString(new Date()));
    setWalkNotes("");
    setEditingId(null);
  }

  return {
    path, setPath, walkName, setWalkName, walkDate, setWalkDate, walkNotes, setWalkNotes,
    editingId, setEditingId, liveLocation, flyTo, setFlyTo, recording, setRecording,
    geoError, locate, reset,
  };
}

type WalkDraft = ReturnType<typeof useWalkDraft>;

interface ModalState {
  open: boolean;
  title: string;
  message: string;
  celebration?: boolean;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string | null;
}

function TrackerPage() {
  const [tab, setTab] = useState<TabKey>("welcome");
  const [modal, setModal] = useState<ModalState>({ open: false, title: "", message: "" });
  const showAlert = (title: string, message: string, celebration = false) =>
    setModal({ open: true, title, message, celebration, cancelLabel: null });
  const storageError = (message: string) => showAlert("Storage problem", message);

  const [walks, setWalks] = useStored<Walk[]>("walks", [], walksSchema, storageError);
  const [workout, setWorkout] = useStored<Workout | null>(
    "singleDayWorkout",
    null,
    workoutOrNullSchema,
    storageError,
  );
  const [dailyData, setDailyData] = useStored<DailyData>("dailyData", {}, dailyDataSchema, storageError);
  const draft = useWalkDraft();
  const showConfirm = (title: string, message: string, onConfirm: () => void) =>
    setModal({ open: true, title, message, onConfirm, confirmLabel: "Delete", cancelLabel: "Cancel" });
  const closeModal = () => setModal((m) => ({ ...m, open: false }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-8">
          <div className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Footprints size={20} aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">A Step in the Right Direction</div>
              <div className="text-xs text-muted-foreground">Walk, workout and step tracker</div>
            </div>
          </div>
          <nav role="tablist" aria-label="Sections" className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="max-w-6xl mx-auto">
        <div>
          <aside className="w-full p-4 sm:p-8">
            {tab === "welcome" && <WelcomeTab />}
            {tab === "walks" && (
              <WalksTab draft={draft} walks={walks} setWalks={setWalks} showAlert={showAlert} showConfirm={showConfirm} />
            )}
            {tab === "workouts" && (
              <WorkoutsTab workout={workout} setWorkout={setWorkout} dailyData={dailyData} setDailyData={setDailyData} showAlert={showAlert} />
            )}
            {tab === "steps" && <StepsTab dailyData={dailyData} setDailyData={setDailyData} showAlert={showAlert} />}
            {tab === "calendar" && <CalendarTab dailyData={dailyData} />}
          </aside>
        </div>
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center z-[2000] p-4" onClick={closeModal}>
          <div
            role="dialog" aria-modal="true" aria-label={modal.title}
            onClick={(e) => e.stopPropagation()}
            className={`bg-card border ${modal.celebration ? "border-secondary shadow-xl ring-1 ring-secondary" : "border-border"} rounded-xl p-6 max-w-md w-full shadow-xl`}
          >
            <h3 className={`text-xl font-bold mb-2 ${modal.celebration ? "text-secondary" : "text-foreground"}`}>{modal.title}</h3>
            <p className="text-muted-foreground mb-6">{modal.message}</p>
            <div className="flex gap-2 justify-end">
              {modal.cancelLabel !== null && (
                <button
                  onClick={closeModal}
                  className="px-4 py-2 rounded-md bg-muted text-foreground hover:bg-border"
                >
                  {modal.cancelLabel ?? "Cancel"}
                </button>
              )}
              <button
                onClick={() => {
                  modal.onConfirm?.();
                  closeModal();
                }}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90"
              >
                {modal.confirmLabel ?? "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Welcome ---------------- */

function WelcomeTab() {
  return (
    <div className="max-w-4xl mx-auto py-6 sm:py-12">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-tertiary">Your Walk, Your Workout</p>
        <h1 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
          A Step in the Right Direction
        </h1>
        <p className="mt-5 mx-auto max-w-2xl text-lg text-muted-foreground leading-relaxed">
          Record your walking routes on a map, generate single-day workout plans, and log your daily
          steps. Everything lands on one calendar so you can see your progress at a glance.
        </p>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { title: "Walks", body: "Trace a route with GPS or a tap on the map and track the distance." },
          { title: "Workouts", body: "Generate a full-body plan, adjust it, and log every set." },
          { title: "Steps", body: "Track daily steps against your goal and review them by date." },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-semibold text-foreground">{f.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Walks ---------------- */

function WalksTab({
  draft,
  walks,
  setWalks,
  showAlert,
  showConfirm,
}: {
  draft: WalkDraft;
  walks: Walk[];
  setWalks: (next: Walk[] | ((prev: Walk[]) => Walk[])) => void;
  showAlert: (t: string, m: string) => void;
  showConfirm: (t: string, m: string, onConfirm: () => void) => void;
}) {
  const {
    path, setPath, walkName, setWalkName, walkDate, setWalkDate, walkNotes, setWalkNotes,
    editingId, setEditingId, liveLocation, flyTo, setFlyTo, recording, setRecording, geoError, locate,
  } = draft;
  const resetForm = draft.reset;
  const [locationQuery, setLocationQuery] = useState("");

  const distance = useMemo(() => totalDistance(path), [path]);
  const canSave = walkName.trim() !== "" && walkDate.trim() !== "" && path.length > 0;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setRecording(false);
    const newWalk: Walk = {
      id: editingId ?? Date.now(),
      walkName,
      walkDate,
      walkNotes,
      path,
      distance,
    };
    setWalks((prev) =>
      editingId ? prev.map((w) => (w.id === editingId ? newWalk : w)) : [...prev, newWalk],
    );
    resetForm();
  }

  function handleEdit(walk: Walk) {
    setRecording(false);
    setEditingId(walk.id);
    setWalkName(walk.walkName);
    setWalkDate(walk.walkDate);
    setWalkNotes(walk.walkNotes);
    setPath(walk.path);
  }

  function handleDelete(id: number) {
    showConfirm("Confirm Deletion", "Are you sure you want to delete this walk?", () => {
      setWalks((prev) => prev.filter((w) => w.id !== id));
      if (editingId === id) resetForm();
    });
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!locationQuery.trim()) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationQuery)}&format=json`,
      );
      const data = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (data.length > 0) {
        setFlyTo([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
      } else {
        showAlert("Error", "Location not found.");
      }
    } catch {
      showAlert("Error", "An error occurred while searching.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)] items-start">
      <div className="space-y-6 min-w-0">
      <div className="text-sm text-muted-foreground bg-card border border-border rounded-xl shadow-sm p-4 space-y-3">
        <p>
          {recording
            ? "Recording your walk. Your path is drawn automatically."
            : "Press Start to record your path with GPS, or click on the map to add points manually."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRecording(!recording)}
            className={`px-4 py-2 rounded-md font-semibold ${
              recording ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
            }`}
          >
            {recording ? "Stop Recording" : "Start Recording"}
          </button>
          <button
            type="button"
            onClick={locate}
            className="px-4 py-2 rounded-md bg-muted text-foreground border border-border hover:bg-border"
          >
            Find My Location
          </button>
        </div>
        {geoError && <p className="text-destructive" role="alert">{geoError}</p>}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-4">
        <form onSubmit={handleSearch} className="space-y-2">
          <label className="block text-sm font-medium">Find a starting point</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="Enter a location"
              className="flex-1 px-3 py-2 rounded-md bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold">
              Search
            </button>
          </div>
        </form>

        <form onSubmit={handleSave} className="space-y-4">
          {editingId !== null && (
            <div className="flex items-center justify-between bg-primary/10 border border-primary/30 rounded-md px-3 py-2 text-sm">
              <strong>Editing Walk</strong>
              <button type="button" onClick={resetForm} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
          )}
          <Field label="Walk Name">
            <input
              type="text"
              required
              value={walkName}
              onChange={(e) => setWalkName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Field>
          <Field label="Date">
            <input
              type="date"
              required
              value={walkDate}
              onChange={(e) => setWalkDate(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Field>
          <div className="bg-primary/10 border border-primary/30 rounded-md p-3 flex justify-between">
            <span className="text-sm text-muted-foreground">Distance</span>
            <span className="font-bold text-primary">{distance.toFixed(2)} km</span>
          </div>
          <Field label="Notes">
            <textarea
              value={walkNotes}
              onChange={(e) => setWalkNotes(e.target.value)}
              placeholder="Add any notes about your walk..."
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSave}
              className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Walk
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-md bg-muted text-foreground border border-border hover:bg-border"
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* Map (mobile shows below sidebar; on lg+ it lives in a right pane) */}
      <div className="lg:hidden h-[400px]">
        <WalkMap
          path={path}
          liveLocation={liveLocation}
          flyTo={flyTo}
          onAddPoint={(p) => setPath((prev) => [...prev, p])}
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Previous Walks</h3>
        {walks.length === 0 ? (
          <p className="text-muted-foreground italic text-sm">No walks saved yet.</p>
        ) : (
          <ul className="space-y-2">
            {walks.map((walk) => (
              <li
                key={walk.id}
                className={`flex items-start justify-between gap-3 p-3 rounded-md border ${
                  editingId === walk.id ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setRecording(false);
                    setPath(walk.path);
                    if (walk.path.length > 0) setFlyTo(walk.path[0]);
                  }}
                  className="flex-1 text-left"
                >
                  <div className="font-semibold">{walk.walkName}</div>
                  <div className="text-xs text-muted-foreground">{walk.walkDate}</div>
                  <div className="text-sm text-primary">{walk.distance.toFixed(2)} km</div>
                  {walk.walkNotes && <div className="text-xs text-muted-foreground mt-1">{walk.walkNotes}</div>}
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleEdit(walk)}
                    className="p-2 rounded-md bg-muted hover:bg-border"
                    aria-label="Edit walk"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(walk.id)}
                    className="p-2 rounded-md bg-muted hover:bg-destructive hover:text-destructive-foreground"
                    aria-label="Delete walk"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>

      <div className="hidden lg:block sticky top-6 h-[calc(100vh-3rem)] min-h-[420px] rounded-xl overflow-hidden border border-border shadow-sm">
        <WalkMap
          path={path}
          liveLocation={liveLocation}
          flyTo={flyTo}
          onAddPoint={(p) => setPath((prev) => [...prev, p])}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

/* ---------------- Workouts ---------------- */

function WorkoutsTab({
  workout,
  setWorkout,
  dailyData,
  setDailyData,
  showAlert,
}: {
  workout: Workout | null;
  setWorkout: (w: Workout | null | ((prev: Workout | null) => Workout | null)) => void;
  dailyData: DailyData;
  setDailyData: (d: DailyData | ((prev: DailyData) => DailyData)) => void;
  showAlert: (t: string, m: string) => void;
}) {
  function update(mut: (w: Workout) => Workout) {
    setWorkout((prev) => (prev ? mut(prev) : prev));
  }

  function addExercise() {
    const newEx: Exercise = {
      id: `custom-${Date.now()}`,
      text: "New Exercise",
      sets: [
        { weight: null, reps: "", completed: false },
        { weight: null, reps: "", completed: false },
        { weight: null, reps: "", completed: false },
      ],
    };
    update((w) => ({ ...w, exercises: [...w.exercises, newEx] }));
  }

  function saveToToday() {
    if (!workout) {
      showAlert("Error", "Please generate a workout plan first.");
      return;
    }
    const key = dateToString(new Date());
    setDailyData((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), workout: JSON.parse(JSON.stringify(workout)) } }));
    showAlert("Saved", "Workout saved to today's calendar.");
  }

  return (
    <div className="max-w-3xl mx-auto bg-card border border-border rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setWorkout(generateSingleDayWorkoutPlan())}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold"
        >
          Generate New Single-Day Plan
        </button>
        <button
          onClick={() => setWorkout({ name: "My Custom Workout", exercises: [] })}
          className="px-4 py-2 rounded-md bg-muted text-foreground border border-border hover:bg-border"
        >
          Create a Workout
        </button>
        {workout && (
          <button
            onClick={saveToToday}
            className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground font-semibold"
          >
            Save to Today's Calendar
          </button>
        )}
      </div>

      {!workout ? (
        <p className="italic text-muted-foreground text-center py-8">
          Click 'Generate New Single-Day Plan' to get started.
        </p>
      ) : (
        <div className="space-y-4">
          <input
            value={workout.name}
            onChange={(e) => update((w) => ({ ...w, name: e.target.value }))}
            className="w-full text-2xl font-bold bg-transparent border-b border-border focus:outline-none focus:border-primary py-1"
          />
          {workout.exercises.map((ex) => (
            <div key={ex.id} className="border border-border rounded-lg p-3 space-y-2 bg-muted/40">
              <div className="flex justify-between gap-2">
                <input
                  value={ex.text}
                  onChange={(e) =>
                    update((w) => ({
                      ...w,
                      exercises: w.exercises.map((x) => (x.id === ex.id ? { ...x, text: e.target.value } : x)),
                    }))
                  }
                  className="flex-1 font-semibold bg-transparent border-b border-transparent focus:border-primary focus:outline-none"
                />
                <button
                  onClick={() =>
                    update((w) => ({ ...w, exercises: w.exercises.filter((x) => x.id !== ex.id) }))
                  }
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove exercise"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {ex.sets.map((set, si) => (
                <div key={si} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="w-12 text-muted-foreground">Set {si + 1}:</label>
                  <input
                    type="number"
                    placeholder="Weight (lbs)"
                    value={set.weight ?? ""}
                    onChange={(e) =>
                      update((w) => ({
                        ...w,
                        exercises: w.exercises.map((x) =>
                          x.id === ex.id
                            ? { ...x, sets: x.sets.map((s, i) => (i === si ? { ...s, weight: e.target.value } : s)) }
                            : x,
                        ),
                      }))
                    }
                    className="w-28 px-2 py-1 rounded bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-muted-foreground">x</span>
                  <input
                    type="text"
                    placeholder="Reps"
                    value={set.reps}
                    onChange={(e) =>
                      update((w) => ({
                        ...w,
                        exercises: w.exercises.map((x) =>
                          x.id === ex.id
                            ? { ...x, sets: x.sets.map((s, i) => (i === si ? { ...s, reps: e.target.value } : s)) }
                            : x,
                        ),
                      }))
                    }
                    className="w-20 px-2 py-1 rounded bg-background border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <label className="ml-auto flex items-center gap-1 text-muted-foreground">
                    Done
                    <input
                      type="checkbox"
                      checked={set.completed}
                      onChange={(e) =>
                        update((w) => ({
                          ...w,
                          exercises: w.exercises.map((x) =>
                            x.id === ex.id
                              ? { ...x, sets: x.sets.map((s, i) => (i === si ? { ...s, completed: e.target.checked } : s)) }
                              : x,
                          ),
                        }))
                      }
                      className="accent-primary w-4 h-4"
                    />
                  </label>
                </div>
              ))}
            </div>
          ))}
          <button
            onClick={addExercise}
            className="px-4 py-2 rounded-md bg-muted text-foreground border border-border hover:bg-border"
          >
            Add Exercise
          </button>
        </div>
      )}
      {/* Silence unused warning */}
      <span className="hidden">{Object.keys(dailyData).length}</span>
    </div>
  );
}

/* ---------------- Steps ---------------- */

function StepsTab({
  dailyData,
  setDailyData,
  showAlert,
}: {
  dailyData: DailyData;
  setDailyData: (d: DailyData | ((prev: DailyData) => DailyData)) => void;
  showAlert: (t: string, m: string, celebration?: boolean) => void;
}) {
  const todayKey = dateToString(new Date());
  const currentSteps = dailyData[todayKey]?.steps ?? 0;
  const [input, setInput] = useState("");

  const radius = 85;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(1, currentSteps / STEPS_GOAL);
  const dashOffset = circumference - progress * circumference;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(input, 10);
    if (isNaN(n) || n < 0) {
      showAlert("Error", "Please enter a valid positive number.");
      return;
    }
    setDailyData((prev) => ({ ...prev, [todayKey]: { ...(prev[todayKey] ?? {}), steps: n } }));
    setInput("");
    if (n >= STEPS_GOAL) {
      showAlert("Congratulations!", `You crushed your daily goal of ${STEPS_GOAL.toLocaleString()} steps!`, true);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-card border border-border rounded-xl shadow-sm p-6 text-center space-y-6">
      <div>
        <h3 className="text-2xl font-bold">Steps Tracker</h3>
        <p className="text-muted-foreground">Daily Goal: {STEPS_GOAL.toLocaleString()} steps</p>
      </div>

      <div className="relative inline-block">
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--muted)" strokeWidth="14" />
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="var(--tertiary)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 100 100)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-bold">{currentSteps.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">/ {STEPS_GOAL.toLocaleString()} steps</div>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="number"
          min={0}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter steps"
          required
          className="w-full px-3 py-2 rounded-md bg-background border border-border text-center focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button type="submit" className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold">
          Update Steps
        </button>
      </form>
    </div>
  );
}

/* ---------------- Calendar ---------------- */

function CalendarTab({ dailyData }: { dailyData: DailyData }) {
  const [viewed, setViewed] = useState(new Date());
  const [selected, setSelected] = useState(new Date());

  const year = viewed.getFullYear();
  const month = viewed.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const todayKey = dateToString(new Date());
  const selectedKey = dateToString(selected);
  const dayData = dailyData[selectedKey];

  function shift(delta: number) {
    setViewed(new Date(year, month + delta, 1));
  }

  return (
    <div className="max-w-3xl mx-auto bg-card border border-border rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => shift(-1)}
          className="p-2 rounded-md bg-muted hover:bg-border"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <h3 className="text-lg font-semibold">
          {viewed.toLocaleString("default", { month: "long", year: "numeric" })}
        </h3>
        <button
          onClick={() => shift(1)}
          className="p-2 rounded-md bg-muted hover:bg-border"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground font-semibold">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1;
          const key = dateToString(new Date(year, month, d));
          const data = dailyData[key];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          return (
            <button
              key={d}
              onClick={() => setSelected(new Date(year, month, d))}
              className={`relative aspect-square rounded-md text-sm font-medium border transition-all ${
                isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : isToday
                    ? "bg-card border-secondary text-secondary"
                    : "bg-card border-border hover:border-primary/50"
              }`}
            >
              {d}
              <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                {data?.workout && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                {data?.steps !== undefined && <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <h4 className="font-semibold mb-3">Daily Data for {selectedKey}</h4>
        {!dayData || (dayData.steps === undefined && !dayData.workout) ? (
          <p className="italic text-muted-foreground text-sm">No data saved for this day.</p>
        ) : (
          <div className="space-y-4">
            {dayData.steps !== undefined && (
              <div className="bg-muted/40 border border-border rounded-lg p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Steps Count</div>
                <div className="text-2xl font-bold text-tertiary">{dayData.steps.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">
                  Goal: {STEPS_GOAL.toLocaleString()} ({Math.min(100, Math.round((dayData.steps / STEPS_GOAL) * 100))}%)
                </div>
              </div>
            )}
            {dayData.workout && (
              <div className="bg-muted/40 border border-border rounded-lg p-3">
                <h5 className="font-semibold mb-2">{dayData.workout.name}</h5>
                <div className="space-y-2">
                  {dayData.workout.exercises.map((ex) => (
                    <div key={ex.id}>
                      <div className="text-sm font-medium">{ex.text}</div>
                      {ex.sets.map((s, i) => (
                        <div key={i} className="flex items-center text-xs text-muted-foreground gap-2 pl-3">
                          <span>
                            Set {i + 1}:{" "}
                            {s.weight !== null && s.weight !== "" ? `${s.weight} lbs x ` : ""}
                            {s.reps}
                          </span>
                          {s.completed && <Check size={12} className="text-primary" />}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
