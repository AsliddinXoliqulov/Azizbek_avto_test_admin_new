export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed =
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true)
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    installed = true
    deferredPrompt = null
    notify()
  })
}

export function subscribeToPwaInstall(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function consumePwaInstallPrompt() {
  const prompt = deferredPrompt
  deferredPrompt = null
  notify()
  return prompt
}

export function isPwaInstalled() {
  return installed
}

export function markPwaInstalled() {
  installed = true
  deferredPrompt = null
  notify()
}
