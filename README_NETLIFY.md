Prepared frontend for Netlify
============================

What I changed:
- Added a BACKEND_BASE_URL placeholder in script files: https://REPLACE_WITH_RAILWAY_URL
- If your site uses server calls, replace the placeholder with your Railway backend URL
- Ensured there's a script.js that handles login with PIN 1234 (single-user)

How to deploy to Netlify (quick):
1. Create a new site on Netlify and connect your GitHub repo (or drag & drop this folder)
2. If you're using this prepared folder as the repo root, Netlify can deploy it without build commands.
3. After deploying, update the BACKEND_BASE_URL in script.js to your Railway URL (e.g. https://your-backend.up.railway.app)
