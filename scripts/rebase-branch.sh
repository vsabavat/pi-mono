#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MAIN_BRANCH="main"
MAIN_REMOTE="origin"
FORK_REMOTE="fork"
BRANCH=""
ALLOW_DIRTY=false
PUSH_FORK_MAIN=true
PUSH_REBASED=false
NO_FETCH=false

usage() {
  cat <<'EOF'
Usage: scripts/rebase-branch.sh [options]

Options:
  -b, --branch <name>       Branch to rebase (default: current branch)
  --main-branch <name>      Main branch name (default: main)
  --main-remote <name>      Main remote (default: origin)
  --fork-remote <name>      Fork remote (default: fork)
  --no-push-fork-main       Do not push main to fork
  --push-rebased            Force-push rebased branch to its upstream
  --allow-dirty             Allow a dirty working tree
  --no-fetch                Skip git fetch
  -h, --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--branch)
      BRANCH="$2"
      shift 2
      ;;
    --main-branch)
      MAIN_BRANCH="$2"
      shift 2
      ;;
    --main-remote)
      MAIN_REMOTE="$2"
      shift 2
      ;;
    --fork-remote)
      FORK_REMOTE="$2"
      shift 2
      ;;
    --no-push-fork-main)
      PUSH_FORK_MAIN=false
      shift
      ;;
    --push-rebased)
      PUSH_REBASED=true
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      shift
      ;;
    --no-fetch)
      NO_FETCH=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$ALLOW_DIRTY" == "false" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty. Commit/stash or use --allow-dirty." >&2
    exit 1
  fi
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
target_branch="${BRANCH:-$current_branch}"

if [[ "$target_branch" == "$MAIN_BRANCH" ]]; then
  echo "Refusing to rebase the main branch." >&2
  exit 1
fi

if [[ "$NO_FETCH" == "false" ]]; then
  git fetch "$MAIN_REMOTE" "$FORK_REMOTE"
fi

git checkout "$MAIN_BRANCH"
git pull --ff-only "$MAIN_REMOTE" "$MAIN_BRANCH"

if [[ "$PUSH_FORK_MAIN" == "true" ]]; then
  if ! git show-ref --verify --quiet "refs/remotes/$FORK_REMOTE/$MAIN_BRANCH"; then
    echo "Missing remote ref: $FORK_REMOTE/$MAIN_BRANCH" >&2
    exit 1
  fi
  if git merge-base --is-ancestor "$FORK_REMOTE/$MAIN_BRANCH" "$MAIN_REMOTE/$MAIN_BRANCH"; then
    git push "$FORK_REMOTE" "$MAIN_REMOTE/$MAIN_BRANCH:$MAIN_BRANCH"
  else
    echo "Fork main has diverged; refusing to push without force." >&2
    exit 1
  fi
fi

git checkout "$target_branch"
git rebase "$MAIN_BRANCH"

if [[ "$PUSH_REBASED" == "true" ]]; then
  if ! git rev-parse --abbrev-ref --symbolic-full-name "${target_branch}@{upstream}" >/dev/null 2>&1; then
    echo "No upstream set for $target_branch; cannot push." >&2
    exit 1
  fi
  git push --force-with-lease
fi
