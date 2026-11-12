# Pipelines

The deployment pipelines of [Tabula](https://github.com/xdeclercq/tabula) and
[Outsmart](https://github.com/xdeclercq/outsmart) on one page, as *Continuous Delivery*
(Humble and Farley) recommends: each version (commit of `main`) and how far it went, from the
commit stage to prod, web and Android, with the buttons that move it on.

| Stage | Started | What it does |
| --- | --- | --- |
| Commit | each push to `main` (Deliver) | tests; the Docker image built once |
| qa web | right after (Deliver), at each push | that image deployed to qa, its commit checked, acceptance tests run on it |
| qa web + Android | **▶ QA** | the web as above (skipped if qa already runs that version, accepted), then the qa and prod APKs built together; the qa one sent to the Firebase group `qa` |
| Prod web + Android | **▶ Prod** | the same image in prod; the prod APK built with the tested one sent to the group `family` |

A button is enabled only for the versions that passed the previous stages, and each workflow
checks it again on its side. A button only shows where it can be used, in place of the stage it
starts: the first one not reached yet, or that failed (framed in red, to try again); never over a
stage that went well. Going back to a version already deployed (qa or prod) is done in GitHub:
Actions → *Deploy to qa* or *Promote to prod* → Run workflow, with its sha. Each application shows its 3
newest versions, and the versions in qa and in prod (web or Android) however old. Per version, a
line for the commit and one for its stages: an icon each (🌐 web, 📱 Android) with its duration,
counting while it runs. Made to fit a phone screen. The rules, the workflows and the rollback are described in the
README of each application ("Deployment pipeline").

## Using it

1. Open the page (GitHub Pages of this repository).
2. Paste a GitHub token, once: a **fine-grained token** (GitHub → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens) with
   - *Repository access*: only `xdeclercq/tabula` and `xdeclercq/outsmart`;
   - *Permissions*: **Actions** read and write (to start the workflows), **Contents** read (the
     commits), **Deployments** read;
   - an expiration date.

   The page keeps it in the browser (`localStorage`) and sends it only to `api.github.com`.
   *Oublier le jeton* (under *Comment ça marche*, at the bottom) removes it.

The page refreshes itself every 2 minutes, every 15 seconds while something runs, and when it
comes back to the foreground.

## Who can deploy

This repository is public, the applications' repositories are private. The page has no rights of
its own: every call goes to GitHub with the visitor's token, so someone without access to the
private repositories sees nothing and starts nothing. In addition, the workflows started by hand
(*Deploy to qa*, *Promote to prod*) stop at once unless started by the
repository owner.

Against a stolen token: the page loads no third-party script, its Content-Security-Policy only
lets it contact GitHub's API and the applications' `/api/auth/status`, and commit messages are
shown as text. The token covers two repositories, cannot push code nor read secrets, expires, and
can be revoked at any time on GitHub.

## Where the data comes from

All from the GitHub API, plus one address per environment:

- the commits of `main`, the runs of Deliver and their jobs (commit stage, deploy to qa);
- the GitHub deployments that the workflows record in the environments `qa`, `prod`,
  `android-qa` and `android-prod` (Android ones carry the APK's version code);
- the runs started by hand, named after the sha they work on (`Test <sha> on Android`…), which
  show a stage as running before its deployment exists, or failed when the workflow refused;
- `GET /api/auth/status` of qa and prod, whose `revision` says which commit runs there. It is only
  asked again when an environment's newest deployment changes, so the page does not keep the
  Fly machines awake.

## Publishing

GitHub → this repository → Settings → Pages → *Deploy from a branch*, branch `main`, folder `/`.
No build: the files are served as they are (`.nojekyll`).

## Development

No dependency. `src/model.js` turns the API data into the pipeline (pure, tested);
`src/load.js` fetches it, `src/view.js` renders it, `src/main.js` holds the token, the refresh
and the buttons; `src/config.js` lists the applications.

```sh
npm test                                   # the model's tests (Node 22)
python3 -m http.server 8000                # then http://localhost:8000
```

To add an application: an entry in `src/config.js` and its two addresses in the
Content-Security-Policy of `index.html`; its repository needs the same workflows (Deliver,
deploy-qa, android-qa, promote, recording their deployments).
