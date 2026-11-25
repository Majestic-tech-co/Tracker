import { z } from "zod";

export type LatLng =[number, number];

export interface Walk {
  id: number;
  walkName: string;
  walkDate: string;
  walkNotes: string;
  path: LatLng[];
  distance: number;
}

export interface ExerciseSet {
  weight: string | number | null;
  reps: string | number;
  completed: boolean;
}

export interface Exercise {
  id: string;
  text: string;
  sets: ExerciseSet[];
}

export interface Workout {
  name: string;
  exercises: Exercise[];
}

export interface DayData {
  steps?: number;
  workout?: Workout;
}

export type DailyData = Record<string, DayData>;

export const STEPS_GOAL = 10000;

export function dateToString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => d * (Math.PI / 180);
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function totalDistance(path: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    d += calculateDistance(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  }
  return d;
}

export function generateSingleDayWorkoutPlan(): Workout {
  const pool = {
    upperBody: ["Push-ups", "Pull-ups", "Bench Press", "Overhead Press", "Rows", "Bicep Curls", "Tricep Dips"],
    lowerBody: ["Squats", "Lunges", "Deadlifts", "Leg Press", "Calf Raises", "Glute Bridges"],
    core: ["Plank", "Crunches", "Leg Raises", "Russian Twists", "Bird-dog"],
  };
  const pick = (arr: string[], n: number) => [...arr].sort(() => 0.5 - Math.random()).slice(0, n);
  const selected = [...pick(pool.upperBody, 2), ...pick(pool.lowerBody, 2), ...pick(pool.core, 1)];
  const name = "Full Body Strength";
  return {
    name,
    exercises: selected.map((text, i) => ({
      id: `${name.toLowerCase().replace(/\s/g, "-")}-${i}-${Date.now()}`,
      text,
      sets: [
        { weight: null, reps: 8, completed: false },
        { weight: null, reps: 10, completed: false },
        { weight: null, reps: 12, completed: false },
      ],
    })),
  };
}

const latLngSchema = z.tuple([z.number(), z.number()]);

const walkSchema = z.object({
  id: z.number(),
  walkName: z.string(),
  walkDate: z.string(),
  walkNotes: z.string(),
  path: z.array(latLngSchema),
  distance: z.number(),
});

const exerciseSetSchema = z.object({
  weight: z.union([z.string(), z.number(), z.null()]),
  reps: z.union([z.string(), z.number()]),
  completed: z.boolean(),
});

const workoutSchema = z.object({
  name: z.string(),
  exercises: z.array(
    z.object({ id: z.string(), text: z.string(), sets: z.array(exerciseSetSchema) }),
  ),
});

export const walksSchema = z.array(walkSchema);
export const workoutOrNullSchema = workoutSchema.nullable();
export const dailyDataSchema = z.record(
  z.string(),
  z.object({ steps: z.number().optional(), workout: workoutSchema.optional() }),
);
