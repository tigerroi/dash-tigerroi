# Roles, team accounts & database access

Who may read and write what, how a team member gets a login, and how to roll it out without
locking everyone out.

## The model

The role lives at **`/roles/{uid}`** in the database — `admin`, `user`, `advertiser`, `keuangan`.
That is the only shape the rules can check: they can read
`root.child('roles').child(auth.uid)`, but cannot find a push-keyed `/users` record by uid. An
account with no entry there is a plain `user`. The `role` column on the Team page is the copy
kept in the profile record for display; `/roles` is the one that grants anything.

(Custom claims would work too, but setting them needs the Admin SDK and a service-account key.
Storing the role in the database keeps team management inside the dashboard.)

### One account, several roles

The value is a **comma-joined string** — `"admin,keuangan"`, `"user,advertiser"` — because a PIC
who also handles the books is one person, not two logins. Every place that reads it must therefore
match **one whole role between the commas**, never compare the string as a whole:

| Where | How |
| --- | --- |
| `database.rules.json` | `.matches(/^(.*,)?admin(,.*)?$/)` |
| `src/config/access.js` | `parseRoles()` / `hasRole()` |
| `functions/roles.mjs` (CLI + functions) | `parseRoles()` / `isAdmin()` |

`val() === 'admin'` fails the moment a second role is added, which strips an admin of every right
*because* they were given more. Substring matching (`.contains('admin')`) has the mirror problem —
it would also accept `"superadmin"`. [functions/roles.test.mjs](../functions/roles.test.mjs) pulls
the regexes straight out of `database.rules.json` and runs them, so a rule that drifts back to
either shape fails the suite.

| Node | read | write |
| --- | --- | --- |
| `roles` | any logged-in user | admin |
| `users`, `domains`, `subDomains`, `adAccounts`, `dashboard/*`, `settings/*` | any logged-in user | admin |
| `adsenseAccounts`, `googleApiConfigs` | **admin** | admin |
| `expenses`, `whitelistTopup` | **admin + keuangan** | admin + keuangan |
| `reminders` | any logged-in user | admin + keuangan |

`adsenseAccounts` holds `passwordAkun` / `passwordDomain` / `passwordWp` / bank details and
`googleApiConfigs` holds `clientSecret` / `refreshToken`. They are admin-only **in full** because
RTDB read permission cascades: granting `.read` on a collection grants every field under it, and a
deeper rule cannot take it back. The dashboard lists these by reading the collection node, so
field-level hiding is not possible without moving the secrets to a separate node.

Writes are admin-only everywhere, with one carve-out: **Keuangan** does full CRUD on `expenses`,
`whitelistTopup`, and `reminders` (`KEUANGAN_WRITE_RESOURCES`). Other roles get a read-only
dashboard until the per-role CRUD matrix is decided (PRD §4 leaves it open).

`reminders` is the one node where read and write part ways: everyone who logs in reads it, only
admin + Keuangan writes. The due-date badge in the topbar is meant for the whole team — a domain
renewal that only Keuangan can see holds up nobody but Keuangan — while the ✓ "tandai selesai"
button is drawn only for those the rules would actually let through. Details in
[telegram-reminders.md](telegram-reminders.md).

One page is gated without owning a node of its own: **Laba Rugi** (`/profit-loss`) sums
`dashboard/weeklyFinancials`, `expenses`, and `whitelistTopup` into a monthly bottom line. It
follows the Keuangan rule because its answer depends on `expenses` — and the store never
subscribes a role to a collection it may not read, so opening the page up would not leak a secret,
it would render revenue minus **zero** and call it profit. See `KEUANGAN_PAGES` in
[src/config/access.js](../src/config/access.js).

The UI mirrors this in [src/config/access.js](../src/config/access.js): admin-only collections are
dropped from the sidebar and never subscribed to, direct URLs render "Akses ditolak", and
non-admins see no Tambah / Edit / Arsipkan / Sync buttons. That is convenience only — the rules
are the enforcement.

## Adding a team member

**Team → Tambah**, fill in the profile plus a **Password Login**, save. That one action does
three things:

1. creates the Firebase Auth login (so they can sign in at `/login`),
2. writes the profile to `/users` — never the password,
3. writes `/roles/{uid}` with the role picked in the form.

The password field only appears when adding. Changing the **Role** on an existing member updates
`/roles` too. **Arsipkan** removes their role, so they keep a login but see nothing; deleting the
login itself is a Firebase Console action (Authentication → Users).

The account is created through a throwaway secondary Firebase app
([src/lib/teamAccounts.js](../src/lib/teamAccounts.js)) — signing up on the main one would swap
the admin's own session for the new account.

## First admin (bootstrap)

Nobody may write `/roles` until somebody is an admin, so the first one is set from the CLI. It
signs in as `SYNC_USER_EMAIL` with the normal client SDK — no service-account key.

```bash
cd functions
npm run role:bootstrap    # SYNC_USER_EMAIL -> admin
npm run role:list         # check
cd .. && npm run deploy:rules
```

Order matters: bootstrap **before** deploying the rules, while `/roles` is still writable by any
signed-in account. `npm run role:set -- <uid> <role>` sets a role for any other uid (the uid is
stored on each team member's profile record).

`admin@rabbitracing.live` — the account the sync backend signs in as — must stay an admin, or its
writes to `adAccounts` / `adsenseAccounts` / `subDomains` will be refused.

## Sync

Sync signs in as `SYNC_USER` (`functions/db.mjs`), so the writes go through the database rules as
that account — the person who triggered the run never matters. Only one account therefore needs the
admin role for a sync to work: `SYNC_USER_EMAIL`.

## If you get locked out

Firebase Console → Realtime Database → Rules, temporarily set `.read`/`.write` back to
`"auth != null"` at the root, fix `/roles`, then redeploy `database.rules.json`.

## Known gaps

- Role `advertiser` differs from `user` in exactly one place: it may write
  `subDomains/$id/campaignCodes`, the Keitaro codes that attribute Meta spend to a subdomain.
  Everything else on the row stays admin-only, so the write must carry that field alone —
  `updateResourceFields` exists for this and deliberately omits `updatedAt`/`updatedBy`, which
  live under the admin-only parent and would sink the whole update.
- "See only my own data" (PRD §4) is not implemented — a logged-in non-admin still reads every
  domain, subdomain and ad account.
- Team members added before this change have no `uid` on their profile, so their role cannot be
  set from the dashboard. Use `npm run role:set -- <uid> <role>`, or re-add them.
