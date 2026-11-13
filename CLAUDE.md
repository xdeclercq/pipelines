# Working on Pipelines

A static page (no build, no dependency) showing the deployment pipelines of Tabula, Outsmart and
Ticket Scanner (`src/config.js`); see the README. The page is in French; code, comments and docs
in English.

- `src/model.js` stays pure (no DOM, no network) and covered by `test/model.test.js` (`npm test`).
- Text from GitHub goes into the page through `textContent` only (the `h` helper in `src/view.js`).
- No third-party script or style, and the Content-Security-Policy in `index.html` lists every host
  the page contacts: keep both that way, the page holds a GitHub token.
- What the page enables must match what the workflows of the applications check (the stage rules
  in `pipeline()`), and the names it reads (workflow files, run names `… <sha> …`, environments
  `qa`, `prod`, `android-qa`, `android-prod`, job names `test`, `build`, `deploy-qa / …`) must
  match those workflows.

Check before pushing: `npm test`, then look at the page (`python3 -m http.server`).
Finished work goes straight into `main` (fast-forward, no merge commit); GitHub Pages serves it.
