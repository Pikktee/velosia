import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Response headers of the production server (`vite preview`, see package.json
// "start"). The Content-Security-Policy is report-only for now: violations show
// up in the browser console without breaking anything, so it can be tightened
// and then enforced once it is known to be complete.
const API_ORIGIN = 'https://api.velosia.henrikheil.net'
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${API_ORIGIN} https://*.googleusercontent.com`,
  `connect-src 'self' ${API_ORIGIN} https://accounts.google.com/gsi/`,
  "frame-src https://accounts.google.com/gsi/",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = {
  'Content-Security-Policy-Report-Only': CSP,
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    host: '0.0.0.0',
    port: process.env.PORT ? parseInt(process.env.PORT) : 4173,
    allowedHosts: true,
    headers: securityHeaders,
  }
})
