# @ghom/gh

[![npm](https://img.shields.io/npm/v/@ghom/gh)](https://www.npmjs.com/package/@ghom/gh)
[![CI](https://github.com/GhomKrosmonaute/gh/actions/workflows/ci.yml/badge.svg)](https://github.com/GhomKrosmonaute/gh/actions/workflows/ci.yml)

Push to any GitHub repository as the right account, without `gh auth switch`.

You are signed in to several GitHub accounts with the [GitHub CLI](https://cli.github.com) (work,
personal, a client's org…), but git only uses the *active* one, so pushing to a repository of the
other account means switching by hand first. `ghom-gh` keeps a list of your gh accounts, asks
GitHub what each of them may do on the repository you push to, and pushes as the one with the
highest permission. gh's active account never changes.

```console
$ git push
remote: Repository not found.
fatal: repository 'https://github.com/acme/website.git/' not found

$ ghom-gh push
› Pushing to github.com/acme/website as jane-at-acme (maintain)
To https://github.com/acme/website.git
   1556ab9..8f2c4e1  main -> main
```

https://github.com/user-attachments/assets/4174bae6-392f-40d9-8af7-f85b7741bf09

## Install

Requires Node.js 20+ and gh (signed in with `gh auth login`).

```sh
npm install -g @ghom/gh
```

## The account list

Tokens stay in gh's keyring: `ghom-gh` reads them with `gh auth token --user <login>` when it needs
one and never stores them. Its own list only says which accounts to consider and in what order.

```sh
ghom-gh list                 # the list, with the state of each gh token
ghom-gh import               # add every account gh is already signed in to
ghom-gh add [login]          # add one, running gh auth login if it is not signed in yet
ghom-gh add --hostname github.example.com     # GitHub Enterprise
ghom-gh add -- --with-token < token.txt       # flags after -- go to gh auth login
ghom-gh remove <login>       # take it off the list (--logout also signs it out of gh)
ghom-gh prefer <login>       # move it first
```

On first use, the list is created from every account gh is signed in to.

**Which account is used:** the one with the highest permission on the repository
(`admin` > `maintain` > `write` > `triage` > `read`). When several accounts share it, the one
listed first wins, so `prefer` decides who acts on repositories all your accounts can push to.

## Pushing

```sh
ghom-gh check                    # every account's permission on this clone's repository
ghom-gh check owner/repo         # …or any repository (owner/repo, host/owner/repo, URL)

ghom-gh push                     # git push as the best account
ghom-gh push -u origin feature   # any git push arguments work
ghom-gh push --as <login>        # force an account
ghom-gh push --refresh           # ask GitHub again instead of using the cache
```

`ghom-gh push` refuses to push when no listed account has write access, and shows what each one
has. Remotes using SSH (`git@github.com:…`) are pushed over HTTPS for that push, otherwise the
SSH key, not `ghom-gh`, would decide the account.

### Any other command

`ghom-gh run` runs a command with the best account for a repository: gh gets its token through
`GH_TOKEN`, git through the credential helper, which picks the account for each repository it
reaches (so `git fetch --all` over remotes of different accounts works). `--as` pins one account
for everything. gh commands are matched on the repository gh acts on: `-R`, then
`GH_REPO`, then the remote `gh repo set-default` chose, else `upstream`, `github`, `origin`. So in a
fork, `ghom-gh run -- gh pr create` uses the best account on the parent repository, not on the fork.

```sh
ghom-gh run -- gh pr create --fill
ghom-gh run --repo acme/website -- gh issue list
ghom-gh run --as jane-at-acme -- git clone https://github.com/acme/website.git
```

## Plain `git push`

```sh
ghom-gh setup
```

makes `ghom-gh` git's credential helper for HTTPS on your accounts' hosts (in the global git
config, in place of gh's helper). From then on `git push`, `git pull`, `git clone` and the git
features of your editor pick the account for each repository themselves:

```console
$ git push
ghom-gh: github.com/acme/website as jane-at-acme (maintain)
```

Commits follow the same account, so the history of a repository does not fill up with an identity
that has nothing to do with it. `setup` also adds two git hooks (config-based, git 2.54+; they run
next to each repository's own hooks):

- after `git clone`, the clone gets the account's GitHub name and noreply address
  (`<id>+<login>@users.noreply.github.com`) as its local `user.name` / `user.email`;
- in a repository cloned before, the first `git commit` sets them and stops, because git already
  picked the author when the hook runs: run the same commit again.

```console
$ git commit -m "Fix the footer"
ghom-gh: this repository now commits as Jane <123+jane-at-acme@users.noreply.github.com> (jane-at-acme, maintain on github.com/acme/website).
ghom-gh: nothing was committed; run the same git commit again.
```

A `user.email` you set in a repository yourself is left alone. `ghom-gh identity` applies the
identity to the current clone by hand, and `git config ghom-gh.identity false` (in a repository, or
`--global`) turns it off.

- A login written in the remote URL wins: `https://<login>@github.com/owner/repo.git`.
- SSH remotes are not affected; use `ghom-gh push` for them, or switch them to HTTPS.
- `GHOM_GH_QUIET=1` hides the line above.
- `ghom-gh setup --uninstall` puts back the helper you had before.

Install `ghom-gh` globally before running `setup`: git calls the exact path it was run from.

## Where things are

- The account list and the permission cache are in `~/.config/ghom-gh/` (`%APPDATA%\ghom-gh` on
  Windows; `GHOM_GH_CONFIG_DIR` overrides it). Neither holds a token.
- Permissions are cached for 10 minutes per repository so that git, which may ask for credentials
  several times in one command, does not query the API for every account each time. A failed push,
  or credentials rejected by GitHub, clears that repository's entry.
- Account identities (name and noreply address, no token) are cached a day in `identities.json`.
- Organizations with SAML SSO need the token authorized for them; `ghom-gh check` shows the link.

## Development

```sh
bun install
bun run dev -- check owner/repo   # run from the sources
bun run check                     # typecheck, lint, tests
bun run build                     # compile to dist/
```

### Releasing

Pushing a version that is not on npm yet to `main` publishes it:

```sh
npm version patch        # or minor / major: bumps package.json, commits and tags
git push --follow-tags
```

The [Release workflow](.github/workflows/release.yml) then checks and builds the package, publishes
it to npm with provenance, and, for a minor or major version, opens a GitHub release with generated
notes. Patch versions only go to npm (their tag is pushed all the same); the next minor release's
notes cover them. Pushes that keep the
same version publish nothing.

npm authentication, set up once:

1. npm only lets a package trust a workflow once the package exists, so the first version goes out
   with a token: either publish it by hand (`npm login && npm publish`), or add an `NPM_TOKEN`
   repository secret (an npm granular token allowed to publish `@ghom/gh`) and re-run the
   Release workflow. Until then, the workflow skips publishing with a warning.
2. On npmjs.com, in the package's *Settings → Trusted publishing*, add GitHub Actions with
   `GhomKrosmonaute`, `gh` and `release.yml`.
3. Delete the `NPM_TOKEN` secret: from then on the workflow authenticates through OIDC, with no
   token to leak or renew.

## License

MIT
