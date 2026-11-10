export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const etb = (santim) => Math.round(santim) / 100;

export const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

export const daysAgo = (n) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

export const int = (value, fallback = 0) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const maskName = (name) => {
  if (!name) return 'Player';
  const clean = String(name).trim();
  if (clean.length <= 2) return clean;
  return `${clean.slice(0, 1)}${'*'.repeat(Math.min(4, clean.length - 1))}`;
};
