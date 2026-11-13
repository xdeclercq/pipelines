// The applications, in this order (menu, overview). Each repository has the same workflows (see the
// README); qa and prod are the addresses of its servers (the app lines of its fly.*.toml).
export const APPS = [
  {
    name: 'Tabula',
    repo: 'xdeclercq/tabula',
    qa: 'https://tabula-qa.fly.dev',
    prod: 'https://tabula-prod.fly.dev',
    android: true,
  },
  {
    name: 'Outsmart',
    repo: 'xdeclercq/outsmart',
    qa: 'https://outsmart-qa.fly.dev',
    prod: 'https://outsmart-prod.fly.dev',
    android: true,
  },
  {
    name: 'Ticket Scanner',
    repo: 'xdeclercq/ticket-scanner',
    qa: 'https://ticket-scanner-6a1b3e-qa.fly.dev',
    prod: 'https://ticket-scanner-6a1b3e-prod.fly.dev',
    android: true,
  },
];

// The key of an application in the menu and in the address (#tabula).
export const keyOf = (app) => app.repo.split('/')[1];

// The workflows started from this page; each takes the input sha.
export const WORKFLOWS = {
  deployQa: { file: 'deploy-qa.yml', name: 'Deploy to qa' }, // web, then the APKs
  promote: { file: 'promote.yml', name: 'Promote to prod' },
};

// GitHub deployment environments written by the workflows.
export const ENVIRONMENTS = ['qa', 'android-qa', 'prod', 'android-prod'];

// Commits of main read per application (to place the versions), and how many of the newest are
// shown; the versions in qa and in prod are shown too, however old.
export const COMMITS = 15;
export const RECENT = 3;
