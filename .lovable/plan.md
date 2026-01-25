
# Project Cleanup Plan

## Summary

Remove unused configuration files and dependencies left over from previous architecture iterations. The project has evolved to use a single consolidated Node.js container, making the old Nginx and Bun-related files obsolete.

---

## Files to Delete

| File | Reason |
|------|--------|
| `config/nginx.conf` | Not used - the consolidated Dockerfile uses Express to serve static files directly, not Nginx |
| `config/docker/.gitkeep` | Empty placeholder for an unused directory |
| `server/entrypoint.sh` | Not referenced in Dockerfile - CMD uses `node index.js` directly |
| `bun.lockb` | Binary Bun lockfile - project uses npm (package-lock.json exists) |
| `bun.lock` | Text Bun lockfile - same reason, npm is the package manager |
| `.lovable/plan.md` | Old plan file from the previous fix, no longer needed |

---

## Directory to Remove

| Directory | Reason |
|-----------|--------|
| `config/` | Will be empty after removing nginx.conf and docker/.gitkeep |

---

## Files to Update

### `.gitignore`
Add Bun lockfiles to prevent them from reappearing if someone accidentally runs `bun install`:

```diff
+ # Bun lockfiles (project uses npm)
+ bun.lockb
+ bun.lock
```

### `.dockerignore`
Add Bun lockfiles and config directory to keep Docker builds clean:

```diff
+ bun.lockb
+ bun.lock
+ config/
```

---

## Optional: README.md Improvement

The current README says "DO NOT USE THIS" at the top which is a bit odd. Could update it to be more useful, but this is low priority.

---

## Summary of Changes

| Action | Count |
|--------|-------|
| Files deleted | 6 |
| Directories deleted | 1 |
| Files updated | 2 |

This cleanup removes approximately 850 lines of unused configuration and lockfile data from the repository.
