# DEPLOYMENT CHECKLIST

## Pre-Deployment (Do This Now)

### Code Review
- [ ] Review `modules/specialMoves/client/specialMovesClient.ts` changes
  - [ ] Verify `isValidationErrorCode()` doesn't include 'permission-denied' (line 96)
  - [ ] Verify `shouldFallbackFromFunctions()` includes 'permission-denied' (line 104)
  - [ ] Verify comments are clear (lines 101-102)
- [ ] Review `App.special_moves.test.tsx` new tests
  - [ ] Fallback permission-denied test looks good
  - [ ] Fallback UI sync test looks good
- [ ] Verify no unrelated changes were made
- [ ] Verify no breaking changes introduced

### Local Testing
- [ ] `npm run build` succeeds without errors
- [ ] `npx vitest run` passes all tests
  - [ ] New fallback tests pass
  - [ ] All existing tests still pass (300+)
- [ ] No console warnings or errors
- [ ] No TypeScript compilation errors

### Documentation Review
- [ ] EXECUTIVE_SUMMARY.md is clear
- [ ] FALLBACK_FIX_SUMMARY.md is accurate
- [ ] DETAILED_CODE_CHANGES.md matches actual changes
- [ ] VERIFICATION_CHECKLIST.md covers all scenarios
- [ ] IMPLEMENTATION_COMPLETE.md is ready for sign-off

---

## Deployment (Staging First)

### Staging Environment

#### Pre-Deploy
- [ ] Backup current production state (if applicable)
- [ ] Staging environment healthy
- [ ] Monitoring/logging working in staging
- [ ] Database connections healthy

#### Deploy
```bash
# 1. Build
npm run build

# 2. Deploy to staging
./deploy-staging.sh  # or your deployment script

# 3. Verify deployment
curl https://staging.example.com/health
```

- [ ] Deployment succeeded
- [ ] No build errors
- [ ] Services started correctly

#### Staging Testing (Manual)

**Test 1: Normal Mode**
- [ ] Create game in staging
- [ ] Open Director panel
- [ ] Go to Moves tab
- [ ] Select DOUBLE TROUBLE
- [ ] Arm a tile
- [ ] Verify: "MOVE DEPLOYED" toast
- [ ] Verify: Tile shows Zap icon
- [ ] Check logs: No `SMS_FUNCTIONS_ARM_FAILED_FALLBACK` entries

**Test 2: Fallback Mode**
- [ ] In DevTools: Network tab → Offline
- [ ] Try to arm another tile
- [ ] Verify: "MOVE DEPLOYED" toast still shown
- [ ] Verify: Tile shows Zap icon
- [ ] Verify: Backend mode shows "Firestore Fallback" or "In-Memory Fallback"
- [ ] Check logs: `SMS_FUNCTIONS_ARM_FAILED_FALLBACK` entry
- [ ] Check logs: `SMS_FALLBACK_ARM_SUCCESS_*` entry

**Test 3: UI Consistency**
- [ ] Armed tile looks the same in both modes
- [ ] GameBoard updates correctly
- [ ] Director panel shows correct backend mode
- [ ] QuestionModal shows armed move info
- [ ] No errors in console

**Test 4: Move Resolution**
- [ ] Arm a tile with Double Trouble
- [ ] Open the tile
- [ ] Answer wrong
- [ ] Verify: Score penalizes correctly
- [ ] Verify: Tile tag changes to 'resolved'
- [ ] Verify: Event logged correctly

#### Staging Monitoring
- [ ] Check logs for errors: No errors
- [ ] Check logs for fallback usage: Proper patterns
- [ ] Check performance: No degradation
- [ ] Check database: No unexpected writes
- [ ] Check auth: All requests authenticated

#### Staging Approval
- [ ] All manual tests passed
- [ ] No unexpected errors in logs
- [ ] Performance acceptable
- [ ] Ready for production

---

## Production Deployment

### Pre-Production Review
- [ ] Staging testing complete ✅
- [ ] Code review approved
- [ ] Documentation reviewed
- [ ] Team notified of changes
- [ ] Rollback plan confirmed

### Production Deploy
```bash
# 1. Final build
npm run build

# 2. Deploy to production
./deploy-production.sh  # or your deployment script

# 3. Verify deployment
curl https://example.com/health
```

- [ ] Deployment succeeded
- [ ] No build errors
- [ ] Services started correctly
- [ ] Database connections healthy

### Post-Deployment (First Hour)

#### Monitor These Logs
```
# Expected to see these after deployment:
- SMS_FUNCTIONS_ARM_FAILED_FALLBACK  (if users hit backend issues)
- SMS_FALLBACK_ARM_SUCCESS_OVERLAY   (fallback works via Firestore)
- SMS_FALLBACK_ARM_SUCCESS_MEMORY    (fallback works via in-memory)
- director_special_move_armed        (normal arm success)
```

- [ ] Check production logs every 5 minutes
- [ ] No unexpected errors
- [ ] Fallback logs look normal (if any)
- [ ] Error rates normal
- [ ] Performance metrics normal

#### Verify Production
- [ ] Can create games normally
- [ ] Can open Director panel
- [ ] Can arm special moves
- [ ] Backend mode shows "FUNCTIONS" (not fallback)
- [ ] No permission errors in logs

#### Alert Settings
- [ ] Alert if `SMS_FUNCTIONS_ARM_FAILED_FALLBACK` spikes
- [ ] Alert if `SMS_FALLBACK_ARM_SUCCESS_*` spikes
- [ ] Alert if error rate increases
- [ ] Alert if performance degrades

### Post-Deployment (24 Hours)

- [ ] No critical errors reported
- [ ] Fallback logs minimal (indicating backend health)
- [ ] User reports: None
- [ ] System health: Good
- [ ] Ready for normal operations

### Post-Deployment (1 Week)

- [ ] Still monitoring for issues
- [ ] Error rates stable
- [ ] Performance stable
- [ ] User experience good
- [ ] Deployment considered stable

---

## Rollback Plan (If Needed)

### Quick Rollback (< 1 minute)

If critical issues occur immediately after deployment:

```bash
# 1. Revert the changes
git revert <commit-hash>

# 2. Rebuild
npm run build

# 3. Redeploy
./deploy-production.sh

# 4. Verify
curl https://example.com/health
```

- [ ] Rollback initiated
- [ ] Build successful
- [ ] Deployment successful
- [ ] Services healthy
- [ ] Error rate back to normal

### Investigation Phase

- [ ] Collect logs from failed deployment
- [ ] Document error patterns
- [ ] Identify root cause
- [ ] Plan fix if needed

### Retry (After Fix)

- [ ] Fix identified issue
- [ ] Code reviewed
- [ ] Tests updated
- [ ] Redeploy to staging
- [ ] Repeat deployment process

---

## Communication Checklist

### Before Deployment
- [ ] Notify team of planned deployment
- [ ] Share this checklist
- [ ] Assign monitoring person
- [ ] Have rollback person on standby

### During Deployment
- [ ] Monitor team notified
- [ ] Deployment in progress
- [ ] Real-time updates in Slack/Teams

### After Deployment
- [ ] Team notified deployment complete
- [ ] All tests passed
- [ ] Monitor 24 hours
- [ ] Close deployment ticket

### If Rollback Needed
- [ ] Immediate notification
- [ ] Rollback initiated
- [ ] Status updates every 5 minutes
- [ ] Post-incident review scheduled

---

## Success Criteria

✅ **Code merged** - All changes in main branch  
✅ **Tests passing** - 300+ tests green in CI  
✅ **Staging verified** - Manual tests complete  
✅ **Logs clean** - No errors/warnings  
✅ **Performance stable** - No degradation  
✅ **Users notified** - If applicable  
✅ **Documentation updated** - Knowledge base updated  
✅ **Team trained** - Support team knows about changes  

---

## Status Tracking

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Code Review | ⬜ Pending | - | Waiting for approval |
| Local Testing | ⬜ Pending | - | Ready to run |
| Staging Deploy | ⬜ Pending | - | After code approved |
| Staging Testing | ⬜ Pending | - | After staging deploy |
| Production Deploy | ⬜ Pending | - | After staging approved |
| Production Monitoring | ⬜ Pending | - | After prod deploy |
| Sign-Off | ⬜ Pending | - | After 24-hour monitor |

---

## Sign-Off

### Code Owner
- Name: _______________
- Date: _______________
- Signature: _______________

### QA Lead
- Name: _______________
- Date: _______________
- Signature: _______________

### DevOps Lead
- Name: _______________
- Date: _______________
- Signature: _______________

### Release Manager
- Name: _______________
- Date: _______________
- Signature: _______________

---

## Emergency Contacts

**Lead Developer**: _______________  
**DevOps On-Call**: _______________  
**Manager**: _______________  
**Escalation**: _______________  

---

**Ready for Deployment** ✅

