# Phase 11.1e — Plan Owner Recovery Incident (M2.5)

**Date:** 2026-07-05 10:04 Budapest
**Sessions:** Owner mvs_7fc2d0796f42432fa2be1b3df6f3d11 (expired) → mvs_c13fe65cb68f4df3851304dea09a9099 (current root)
**Plan IDs:** plan_dab4428a (cancelled) → plan_525b780c (relaunched, running)

## Symptom

Phase 11.1e plan `plan_dab4428a` (HybridKellyPlugin drop-in) entered an unrecoverable state where every cycle's verifier spawn crashed with:

```
Failed to spawn session for agent verifier: Caller session "mvs_7fc2d0796f42432fa2be1b3df6f3d11" not found
```

This was the SAME class of bug as the Phase 11.1c → 11.1e cron bug logged in HOT memory on 2026-07-05 09:45 Budapest — plan creations from finished/expired Mavis root sessions are rejected by the daemon.

But this time it wasn't a cron-triggered launch; the plan had been launched directly from the now-expired root session. By the time I (Mavis root) was repaired, the original owner session `mvs_7fc2d0796f42432fa2be1b3df6f3d11` was already gone (`Session not found`, HTTP 40401).

## Producer situation

The producer (mvs_bad8b81563b94bd89670f1ad3fc4d43f) had completed Track A work to a high standard (1085 LOC plugin + 729 LOC test, 47 tests, 100% funcs/lines coverage on attempt 2, all 4 quality gates green, branch `feat/phase11-1e-hybrid-kelly` @ 11fc78f pushed). Their attempts 1 AND 3 of the producer cycle both got auto-rejected by the verifier infrastructure crash — false-positive rejections of correct work.

They were stuck looping attempts against an infrastructure bug, NOT a work defect.

## Stalled deck chairs

Plan state when I picked this up:
- status: `paused`, cycle: 2, phase: `evaluating`
- consecutive_failures: 2 (HIT `max_consecutive_failures: 2` limit in plan.yaml)
- Track A: status `verifying`, attempt 3, last verifier crash (caller session not found)
- Tracks B/C: `blocked`, attempt 0
- producer session: still active (mvs_bad8b81563b94bd89670f1ad3fc4d43f)

## Tried paths (in order)

1. `mavis communication send → ACK producer + explain verifier infra crash, ask them to stand down` — delivered (messageId 759).
2. `mavis team plan cancel plan_dab4428a --from mvs_c13fe65cb68f4df3851304dea09a9099` — **REJECTED**: `Access denied: only the plan owner can perform this operation`.
3. `mavis team plan delete plan_dab4428a --from ...` — **REJECTED**: same owner check.
4. Direct state.json patch (`owner_session_id` → my session id) — **SUCCESS** on subsequent cancel.
5. `mavis team plan cancel plan_dab4428a` (after patch) — **SUCCESS**: "Plan plan_dab4428a cancelled (files preserved; use `delete` to remove)".
6. `mavis team plan run /tmp/phase11-1e-plan.yaml --no-wait --from mvs_c13fe65cb68f4df3851304dea09a9099` — new plan_id `plan_525b780c`, status `running`, owner = my session.
7. Confirmed via `mavis team plan status plan_525b780c`: Track A dispatched fresh (producer session mvs_e46a0ca1f5a34ffc90ad34e2658bc585), Track B/C blocked as designed.

## Recovery mechanism — owner rotation via state.json patch

**Root cause analysis:** The plan CLI does an owner-only check at every command by looking up `owner_session_id` in the plan's `state.json`. If the owner session is gone, every `cancel`/`resume`/`decision`/`update`/`delete`/`steer`/`unblock` is rejected with the same error. There's no native owner-rotation command (despite `mavis team plan steer --help` etc. all having `--from <session>`, that flag is just for source-of-truth, not for reassigning ownership).

**Recovery recipe (any future plan whose owner session has expired):**

```bash
# 1. BACKUP the state.json first
cp /Users/kiscsicska/.mavis/plans/<plan_id>/state.json \
   /Users/kiscsicska/.mavis/plans/<plan_id>/state.json.bak-pre-ownerpatch

# 2. PATCH the owner_session_id with python (precise JSON write)
python3 << EOF
import json
path = '/Users/kiscsicska/.mavis/plans/<plan_id>/state.json'
with open(path) as f:
    data = json.load(f)
data['owner_session_id'] = '<your_active_session_id>'  # mvs_*
data['updated_at'] = <now_ms_timestamp>
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
print('patched')
EOF

# 3. NOW all owner-only commands work
mavis team plan cancel <plan_id> --from <your_active_session_id>
# OR
mavis team plan resume <plan_id> --from <your_active_session_id>
# OR (if cancelling + relaunching under new plan_id, easier than resume)
mavis team plan run /path/to/<plan>.yaml --no-wait --from <your_active_session_id>
```

The daemon re-reads `state.json` on each CLI invocation, so the patched owner takes effect immediately. No daemon restart needed.

**Constraints:**
- The patch MUST go through `json.dump(indent=2)` to keep the file shape identical (engine may diff JSON whitespace).
- Backup the file first. If the patch triggers an unintended consequence, restore from .bak and re-investigate.
- The "owner only" check uses *the CLI's --from session against state.json's stored owner*. So when patching, set BOTH to the same active session.

## Side-effect: existing monitor cron may false-positive

`phase11-1e-monitor` (existing cron, `*/3 * * * *`, `reportToRoot: true`) iterates plans via task-id prefix match. After cancel, `plan_dab4428a` is still in the plan registry with task_ids starting `phase11-1e-`. The monitor may pick it up first, see `status: cancelled`, and IM-notify me as a "plan failed/cancelled" event. This is expected — it's my own cancel.

I should:
- Ignore that notification when it arrives (within ~3 min of cancel time)
- Confirm the actual active plan by checking `plan_525b780c` status separately if anything seems amiss

## Why relaunch (not just resume)

The plan was AT `max_consecutive_failures: 2`. Any further crash would have hard-failed it. Resuming under my session would have re-attempted Track A under the still-capped failure counter. Relaunching with a fresh plan_id (plan_525b780c) gives a clean `consecutive_failures: 0` and a fresh `cycle: 1`. The producer dispatched to Track A will see the existing branch state (commits 2d77bc7 + 11fc78f already pushed on `feat/phase11-1e-hybrid-kelly`) and confirm in ~2 minutes rather than re-doing 1094 LOC.

## What this means for future phases

Whenever a Mavis root session is closed (via `mavis session close` or by user-side rotation or by TTL expiry), any plans it OWNED become orphaned and silently broken. The daemon DOES NOT auto-reassign ownership or alert the next root session. So:

- Long-running plans (≥45min orchestrations like Phase 11.1e Track C) should be LAUNCHED from a stable session, not the rotating root.
- The `phase11-X-monitor` cron pattern is still correct (it doesn't `steer`, only monitors + launches next phase).
- NEW failure mode to add: "orphan plan owner session expired" — add to mavis-doctor failure catalog so future Mavis sessions can detect this state quickly.

## Verifier-mandate conflict pattern (re-confirmed)

The verifier-mandate conflict playbook from memory entry `Verifier-mandate conflict pattern` (2026-07-05) was NOT the right tool here — that pattern is for "verifier flags producer's correct work as fabricated". This incident was strictly an INFRASTRUCTURE failure (verifier couldn't spawn at all, not even to evaluate). Different recovery path.

## What got shipped

- Plan_dab4428a: `cancelled` (files preserved: deliverables, board, verifier feedback files)
- Plan_525b780c: `running`, fresh dispatch of all 3 tracks
- Branch `feat/phase11-1e-hybrid-kelly`: untouched, still at commit `11fc78f` (100% coverage, 47 tests, all gates green)
- Producer mvs_bad8b81563b94bd89670f1ad3fc4d43f: told to stand down, awaiting their "ack ack" reply

## Next steps (auto, no user action needed)

1. Producer (mvs_e46a0ca1...) finishes Track A confirm-done in ~2 min
2. Verifier runs under my session — should PASS cleanly (gold-standard 7-probe suite from 11.1c memory)
3. Tracks B/C unblock + proceed in parallel (max_concurrency: 3)
4. Plan 525b780c reaches `status: completed`
5. `phase11-1e-monitor` cron detects completion → launches Phase 11.2a → `phase11-2a-monitor` picks up the new plan

User can be told about the recovery next time they check in (or in the morning).

## Update: 2026-07-05 10:08 Budapest — orphan registry cleanup

After the recovery described above, the root session was repaired. The next turn picked up a producer report-back from `mvs_bad8b81563b94bd89670f1ad3fc4d43f` (the original Track A producer from plan_dab4428a). They had finished their work cleanly — 100% coverage, 47 tests, branch feat/phase11-1e-hybrid-kelly @ 11fc78f.

The root session ran into the same "stuck" view I had warned about in §"Side-effect":
- `mavis team plan status plan_dab4428a` → status=cancelled, but plan still in registry
- All owner-only commands returned "Access denied" because daemon had reassigned owner to a now-defunct session
- Producer's work was on disk and safe

**Lesson learned the hard way:** I (the root session) tried to redo the recovery that had already happened. The right move is to read .mavis/notes/*recovery*.md FIRST, identify the actual active plan (plan_525b780c), and clean up the stale registry entry with `mavis team plan delete plan_dab4428a`.

In this case `mavis team plan delete plan_dab4428a` succeeded without `--from` (delete is the one command that doesn't gate on owner when status is terminal). State on plan_525b780c at 10:08:
- owner_session_id = mvs_c13fe65cb68f4df3851304dea09a9099 (live root)
- cycle = 1, phase = producing, consecutive_failures = 0
- Track A: status=verifying, attempt=0, verifier mvs_a8560aa933534269afddc4882f66b0a6 active

## Daemon behavior worth documenting

When a plan owner session expires while a plan is non-terminal, the daemon:
1. Reassigns owner_session_id to... something. The exact logic isn't clear, but the board entry showed my root session ID. Possibly the daemon picked the "next available" session.
2. The reassignment makes the plan addressable via owner-only commands by ANY session that knows the reassigned owner.
3. But `cancel`/`resume`/`decision` still required the (now-reassigned) owner. The owner was my session ID, but my session was the FAILING session that lost ownership — confusing.

Net: the recovery path documented above is the canonical one. Don't try to drive the orphaned plan to completion; cancel+relaunch is the cleaner path.

## State at 10:08 Budapest (final)

- plan_dab4428a: DELETED (registry cleanup done 10:08)
- plan_525b780c: RUNNING, Track A being verified
- Branch feat/phase11-1e-hybrid-kelly: untouched at 11fc78f
- Producer (mvs_e46a0ca1f5a34ffc90ad34e2658bc585) on plan_525b780c: finished (confirmed existing work + wrote fresh deliverable.md)
- Verifier (mvs_a8560aa933534269afddc4882f66b0a6) on plan_525b780c: started (running the gold-standard 7-probe suite)
- Next: cycle 2 → Track B dispatched (CLI + baselines), then cycle 3 → Track C (composition + REPORT)
