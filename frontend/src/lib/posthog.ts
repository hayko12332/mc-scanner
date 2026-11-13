import posthog from 'posthog-js'

const posthogKey = import.meta.env.VITE_POSTHOG_KEY
const posthogHost = import.meta.env.VITE_POSTHOG_HOST

export const isPostHogConfigured = () => Boolean(posthogKey && posthogHost)

export function initPostHog(): void {
  if (!isPostHogConfigured()) {
    const missingVariable = !posthogKey ? 'VITE_POSTHOG_KEY' : 'VITE_POSTHOG_HOST'
    if (import.meta.env.DEV) {
      throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`)
    }
    return
  }

  posthog.init(posthogKey, {
    api_host: posthogHost,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: 'mc-scanner-frontend',
      environment: import.meta.env.MODE,
    },
  })
}

export default posthog
