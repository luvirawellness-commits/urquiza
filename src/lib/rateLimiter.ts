export const rateLimiter = {
  MAX_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
  STORAGE_KEY: 'luvira_login_attempts',

  getAttempts(): { count: number; lastAttempt: number; lockedUntil?: number } {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      return stored ? JSON.parse(stored) : { count: 0, lastAttempt: 0 }
    } catch {
      return { count: 0, lastAttempt: 0 }
    }
  },

  isLocked(): { locked: boolean; remainingMinutes?: number } {
    const attempts = this.getAttempts()
    if (!attempts.lockedUntil) return { locked: false }
    const now = Date.now()
    if (now < attempts.lockedUntil) {
      const remainingMs = attempts.lockedUntil - now
      const remainingMinutes = Math.ceil(remainingMs / 60000)
      return { locked: true, remainingMinutes }
    }
    this.reset()
    return { locked: false }
  },

  recordFailedAttempt(): { locked: boolean; remainingAttempts: number } {
    const attempts = this.getAttempts()
    const newCount = attempts.count + 1
    const now = Date.now()

    if (newCount >= this.MAX_ATTEMPTS) {
      const lockedUntil = now + this.LOCKOUT_MINUTES * 60 * 1000
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify({ count: newCount, lastAttempt: now, lockedUntil }),
      )
      return { locked: true, remainingAttempts: 0 }
    }

    localStorage.setItem(
      this.STORAGE_KEY,
      JSON.stringify({ count: newCount, lastAttempt: now }),
    )
    return { locked: false, remainingAttempts: this.MAX_ATTEMPTS - newCount }
  },

  recordSuccessfulLogin(): void {
    this.reset()
  },

  reset(): void {
    localStorage.removeItem(this.STORAGE_KEY)
  },
}
