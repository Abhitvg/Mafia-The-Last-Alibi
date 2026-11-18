# Deploying Mafia: The Last Alibi

1. Unzip `netlify-ready-game.zip` on your computer.
2. Open the folder in a terminal and run `npm install` (the project needs `@netlify/blobs`).
3. Run `npm test` and `npm run build`.
4. Sign in to Netlify and open https://app.netlify.com/drop.
5. Drop the **project folder** (not only `dist`) while signed in so Netlify can detect and run the build step declared in `netlify.toml`.
6. Wait for the deploy to finish. Open the resulting `*.netlify.app` URL in two separate browsers/devices and test a 4-player room.

If Netlify Drop publishes files without running a build, the serverless function will not exist. In that case, connect the folder to a Git repository and use Netlify's normal build deploy, or deploy with the Netlify CLI after running the build.

The deployment needs no user-supplied API keys. Netlify provides the Blobs context to the function at runtime.
