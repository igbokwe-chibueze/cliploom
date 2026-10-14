export const CLIP_COUNT_STORAGE_KEY = 'cliploom.requestedClipCount';
export function validClipCount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string' || value === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 10 ? count : null;
}
export function initialClipCount(saved: unknown, serverDefault: number, userChoice: number | null) {
  return validClipCount(userChoice) ?? validClipCount(saved) ?? validClipCount(serverDefault) ?? 5;
}
