# Contributing

Thanks for contributing! This repo protects the `main` branch, so all changes
go through a pull request that the repository owner (**@ma731**) approves before
it can be merged. Direct pushes to `main` are disabled.

## Workflow

1. **Create a branch** off `main` for your work:

   ```bash
   git checkout main
   git pull
   git checkout -b your-name/short-feature-description
   ```

2. **Build on your branch.** Commit and push as often as you like — your branch
   is your sandbox, no approval needed:

   ```bash
   git add -A
   git commit -m "Describe what you changed"
   git push -u origin your-name/short-feature-description
   ```

3. **Open a pull request** (your branch → `main`) when you're ready to merge.
   You can open it early and keep pushing; the PR updates automatically.

4. **Wait for review.** @ma731 is the required reviewer (see `CODEOWNERS`). The
   merge button stays locked until they approve.

5. **Merge** once approved. Then delete your branch and start fresh from `main`
   for the next piece of work.

## Good habits

- **One branch per feature/person** — avoids conflicts with teammates.
- **Pull `main` before starting** new work so you branch from the latest code.
- If you push new commits *after* getting an approval, the approval is cleared
  and you'll need @ma731 to approve again — this keeps reviews on the final code.
- Write clear commit messages and a short PR description of what changed and why.

## What you can't do

- Push directly to `main`
- Force-push or rewrite `main`'s history
- Delete the `main` branch

These are enforced by the **"Protect main"** ruleset.
