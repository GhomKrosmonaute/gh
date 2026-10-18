<div align="center">

# ghom-gh

**Push to any GitHub repository as the right account. No more `gh auth switch`.**

[![npm](https://img.shields.io/npm/v/@ghom/gh)](https://www.npmjs.com/package/@ghom/gh)
[![CI](https://github.com/GhomKrosmonaute/gh/actions/workflows/ci.yml/badge.svg)](https://github.com/GhomKrosmonaute/gh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

https://github.com/user-attachments/assets/4174bae6-392f-40d9-8af7-f85b7741bf09

You are signed in to several accounts with the [GitHub CLI](https://cli.github.com), but git only
uses the active one:

```console
$ git push
remote: Repository not found.
```

`ghom-gh` asks GitHub what each of your accounts may do on the repository, and uses the one with the
highest permission (`admin` > `maintain` > `write` > `triage` > `read`). gh's active account never
changes.

## Get started

```sh
npm install -g @ghom/gh   # Node.js 20+, gh signed in with gh auth login
ghom-gh setup
```

That's it. Plain git now picks the account for each repository:

```console
$ git push
ghom-gh: github.com/acme/website as jane-at-acme (maintain)
```

It works for `push`, `pull`, `fetch`, `clone` and your editor's git features. Commits are authored
as that account too (its name and GitHub noreply address), so strangers don't end up in a project's
history.

## Commands

| Command | What it does |
| --- | --- |
| `ghom-gh setup` | Make plain git pick the account (`--uninstall` to undo) |
| `ghom-gh check [repo]` | Show every account's permission on a repository |
| `ghom-gh push [args]` | `git push` as the best account (`--as <login>` to force one) |
| `ghom-gh run -- <cmd>` | Run any command (`gh pr create`, `git clone`…) as the best account |
| `ghom-gh list` | Your accounts, and the state of their gh tokens |
| `ghom-gh add` / `remove <login>` | Add or remove an account (`add --hostname` for Enterprise) |
| `ghom-gh prefer <login>` | Put an account first: it wins ties |
| `ghom-gh identity` | Set the commit identity of the current clone by hand |

On first use, the account list is filled from every account gh is signed in to.

## Good to know

- **Tokens stay in gh's keyring.** ghom-gh asks gh for them when it needs one and never stores them.
- **Ties** go to the account listed first: see `ghom-gh prefer`.
- **Forks:** `ghom-gh run -- gh pr create` picks the account on the repository gh targets (`-R`,
  `GH_REPO`, `gh repo set-default`, then `upstream` > `github` > `origin`), not on your fork.
- **First commit in an older clone:** the hook sets the identity and stops that commit once, because
  git has already chosen the author. Run the same commit again.
- **Opting out:** a `user.email` you set in a repository yourself is kept, and
  `git config ghom-gh.identity false` turns the identity off.
- **Pinning an account:** a login in the remote URL wins: `https://<login>@github.com/owner/repo.git`.
- **SSH remotes** keep using your SSH key. Use `ghom-gh push`, which pushes them over HTTPS.
- **Quiet:** `GHOM_GH_QUIET=1` hides the `ghom-gh:` line.
- **Files:** `~/.config/ghom-gh/` (`%APPDATA%\ghom-gh` on Windows, `GHOM_GH_CONFIG_DIR` overrides
  it). It holds the account list, a 10-minute permission cache and a one-day identity cache. None of
  them contains a token.
- **SAML SSO:** organizations need the token authorized for them. `ghom-gh check` shows the link.

## Development

```sh
bun install
bun run dev -- check owner/repo   # run from the sources
bun run check                     # typecheck, lint, tests
```

To release, run `npm version patch|minor|major && git push --follow-tags`. The
[Release workflow](.github/workflows/release.yml) publishes to npm with provenance, through trusted
publishing. Minor and major versions also get a GitHub release.

## License

MIT
