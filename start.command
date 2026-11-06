#!/bin/bash
# Double-click to run MC Scanner locally on http://localhost:3000
# (SAFER checks from your own machine need a US VPN; the Render deployment doesn't).
cd "$(dirname "$0")"
[ -d backend/node_modules ] && [ -d frontend/node_modules ] || npm run setup
npm run build && (sleep 3 && open http://localhost:3000) & npm start
