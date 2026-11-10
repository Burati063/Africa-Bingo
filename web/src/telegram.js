export const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#05070f');
    tg.setBackgroundColor?.('#05070f');
  } catch {
    /* older Telegram clients */
  }
}

export function haptic(type = 'light') {
  try {
    if (type === 'success' || type === 'error') {
      tg?.HapticFeedback?.notificationOccurred(type);
    } else {
      tg?.HapticFeedback?.impactOccurred(type);
    }
  } catch {
    /* ignore */
  }
}

export function telegramUser() {
  return tg?.initDataUnsafe?.user || null;
}
