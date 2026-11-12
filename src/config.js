// The applications shown, in this order. Each repository has the same workflows (see the README).
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
];

// The workflows started from this page; each takes the input sha.
export const WORKFLOWS = {
  deployQa: { file: 'deploy-qa.yml', name: 'Deploy to qa' },
  testAndroid: { file: 'android-qa.yml', name: 'Test on Android' },
  promote: { file: 'promote.yml', name: 'Promote to prod' },
};

// GitHub deployment environments written by the workflows.
export const ENVIRONMENTS = ['qa', 'android-qa', 'prod', 'android-prod'];

// Commits of main shown per application.
export const COMMITS = 15;
