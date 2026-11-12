// The GitHub REST API, called from the browser with the user's token (CORS is allowed by GitHub).
// cache: 'no-cache' makes the browser revalidate with the ETag it holds: an unchanged answer comes
// back as 304, which GitHub does not count against the rate limit.

const API = 'https://api.github.com';

export class ApiError extends Error {
  constructor(status, path, message) {
    super(`${status} ${path}: ${message}`);
    this.status = status;
    this.path = path;
  }
}

export class GitHub {
  constructor(token) {
    this.token = token;
  }

  async request(method, path, body) {
    const res = await fetch(API + path, {
      method,
      cache: 'no-cache',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).message ?? message;
      } catch {
        // not JSON
      }
      throw new ApiError(res.status, path, message);
    }
    return res.status === 204 ? null : res.json();
  }

  get(path) {
    return this.request('GET', path);
  }

  // Starts a workflow of main with the input sha. GitHub answers 204 without the run: the next
  // refresh shows it.
  dispatch(repo, file, sha) {
    return this.request('POST', `/repos/${repo}/actions/workflows/${file}/dispatches`, { ref: 'main', inputs: { sha } });
  }
}
