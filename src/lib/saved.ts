export interface SavedWatch {
  host: string;
  port?: number;
  name?: string;
  serial?: string;
  pairedAt?: number;
}

const KEY = "watch-drive:device";

export function loadSaved(): SavedWatch | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

export function saveWatch(w: Partial<SavedWatch>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadSaved(), ...w }));
  } catch {
    /* storage unavailable */
  }
}

export function forgetWatch() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
