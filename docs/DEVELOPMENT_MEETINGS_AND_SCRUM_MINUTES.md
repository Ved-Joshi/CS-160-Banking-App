# Development Meetings and Scrum Minutes

## Team
- Ved-Joshi
- Hazelette
- Anishka Chauhan
- Jonah
- Joshua

## Cadence
- Daily Scrum: 15 minutes (Mon-Fri)
- Weekly Planning: 45 minutes (Mon)
- Weekly Review/Retro: 45 minutes (Fri)

## Standard Scrum Format
Each person covers:
1. What was completed since last standup
2. What is planned before next standup
3. Blockers or risks

---

## Minutes Template
### Meeting Type
- Date:
- Time:
- Facilitator:
- Attendees:
- Absentees:

### Updates
- Member:
  - Completed:
  - Next:
  - Blockers:

### Decisions
- 

### Action Items
- [ ] Owner — Task — Due date

---

## Scrum Minutes Log

### Daily Scrum
- Date: 2026-04-22
- Time: 9:00 AM PT
- Facilitator: Ved-Joshi
- Attendees: Ved-Joshi, Hazelette, Anishka, Joshua
- Absentees: Jonah

### Updates
- Ved-Joshi
  - Completed: Bill pay cancel/retry flow updates in web UI.
  - Next: Validate daily cadence behavior and deposit flow edge cases.
  - Blockers: None.
- Hazelette
  - Completed: Backend bill payment updates and function cleanups.
  - Next: Verify ledger posting consistency in payment paths.
  - Blockers: None.
- Anishka
  - Completed: Admin panel layout and account reporting screens.
  - Next: Improve dashboard visibility metrics.
  - Blockers: Needs final API field mapping.
- Joshua
  - Completed: Mobile parity updates for bill pay interactions.
  - Next: Sync mobile UX wording with web.
  - Blockers: None.

### Decisions
- Keep bill payment validation in backend as source of truth so web/mobile behavior is consistent.

### Action Items
- [ ] Ved-Joshi — Add/verify backend bill pay balance guard tests — 2026-04-23
- [ ] Anishka — Align admin dashboard cards with backend metrics — 2026-04-24

---

### Weekly Planning
- Date: 2026-04-25
- Time: 10:00 AM PT
- Facilitator: Ved-Joshi
- Attendees: Ved-Joshi, Hazelette, Anishka, Jonah, Joshua
- Absentees: None

### Updates
- Team reviewed previous sprint completion and open release risks.

### Decisions
- Prioritize release readiness tasks:
  - Docker reproducibility and startup checks
  - Auth reset/login reliability
  - Migration and RLS hardening validation
  - Backlog/documentation cleanup

### Action Items
- [ ] Jonah — Web deposit tab implementation tasks (UI/upload/history/error states) — 2026-04-29
- [ ] Joshua — Continue mobile parity tasks for high-usage frontend flows — 2026-04-29
- [ ] Ved-Joshi — Finalize README user guide + setup automation scripts — 2026-04-28
- [ ] Hazelette — Validate ledger integrity and policy checks after migration updates — 2026-04-29

---

### Weekly Review and Retrospective
- Date: 2026-04-29
- Time: 3:00 PM PT
- Facilitator: Anishka
- Attendees: Ved-Joshi, Hazelette, Anishka, Jonah, Joshua
- Absentees: None

### What Went Well
- Faster onboarding with scripted Supabase setup.
- Better alignment between web and mobile feature parity.
- Clearer release readiness checklist and ownership.

### What Can Improve
- Earlier verification of auth reset links across all link formats.
- Tighter backlog hygiene to reduce duplicate/ambiguous entries.

### Decisions
- Add a pre-release auth flow validation checklist (login, forgot password, reset, post-reset login).
- Keep backend validation centralized for money movement constraints.

### Action Items
- [ ] Ved-Joshi — Add auth flow regression checklist to docs — 2026-04-30
- [ ] Team — Use the meeting template for all sprint ceremonies moving forward — Ongoing
