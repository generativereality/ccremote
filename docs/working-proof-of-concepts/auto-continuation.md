## 📋 **Auto-Continuation Daemon Complete Requirements Summary**

Based on our full implementation, here's everything the daemon must support:

---

## 🎯 **Core Functionality**

### **Primary Purpose**

- **Monitor tmux sessions** for Claude usage limit messages
- **Automatically continue sessions** when limits reset
- **Send user notifications** via Telegram
- **Handle system sleep/wake** scenarios robustly

### **Session Detection**

- ✅ **Monitoring target**: Active tmux session (user-specified, defaults to `claude-with-hooks`)
- ✅ **Detection patterns**:
  - `5-hour limit reached` (primary)
  - `usage limit` (fallback)
  - `limit reached` (generic)
  - `hourly limit` (variant)

---

## 🔧 **Smart Detection & Response**

### **Limit Message Recognition**

```javascript
/⎿  5-hour limit reached ∙ resets 10pm/
/upgrade to increase your usage limit.
```

### **Reset Time Extraction**

- ✅ **Pattern recognition**: `resets 10pm`, `available again at 2:30pm`, `ready at 14:00`
- ✅ **Time parsing**: Supports `10pm`, `2:30pm`, `14:00`, mixed formats
- ✅ **AM/PM conversion**: Properly handles 12-hour → 24-hour
- ✅ **Date logic**: Assumes tomorrow if parsed time < current time

### **Sanity Validation**

- ✅ **Distance check**: Reject reset times > 5 hours (Claude's window limit)
- ✅ **Reasoning**: Prevents misinterpretations (e.g., 10pm today vs tomorrow)

---

## 🚀 **Continuation Intelligence**

### **Multiple Continuation Strategies**

1. **Immediate Continuation**: If trying continue succeeds immediately
2. **Scheduled Continuation**: When limit still active, schedule for reset time
3. **Intelligent Polling**:
   - ✅ **Dynamic intervals**: 30s normally, 5s near reset, exact timing within 5s
   - ✅ **Sleep/wake robust**: No timing issues during system suspend

### **Cooldown Protection**

- ✅ **Post-continuation cooldown**: 5 minutes after successful continuation
- ✅ **Reason**: Let tmux output update before re-monitoring
- ✅ **State management**: Clear scheduled state to prevent spam

---

## 📱 **Notification System**

### **Telegram Integration**

- ✅ **Config reliance**: Uses `.env` vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- ✅ **Graceful degradation**: Continues without Telegram if not configured

### **Notification Types**

```javascript
// Usage limit detected
{ type: 'waiting', title: 'Usage Limit Reached', ... }

// Continuation successful
{ type: 'completed', title: 'Session Resumed', ... }
```

### **Spam Prevention**

- ✅ **One notification per limit detection**
- ✅ **No duplicate notifications** when re-checking scheduled reset
- ✅ **Cooldown awareness**: No notifications during cooldown period

---

## 💡 **Advanced State Management**

### **Global State Variables**

```javascript
const scheduledResetTime = null; // Next scheduled continuation
const lastContinuationTime = 0; // Last successful continuation
const CONTINUATION_COOLDOWN_MS = 5 * 60 * 1000; // 5-minute cooldown
```

### **State Change Handling**

- ✅ **Continuation completion**: Set `lastContinuationTime`, clear scheduled time
- ✅ **New limit detected**: Only schedule if not already scheduled
- ✅ **Reset time arrives**: Clear scheduled state, execute continuation

---

## 🔗 **Tmux Integration**

### **Command Injection**

```bash
# Proper sequence for tmux command injection
tmux send-keys -t $session C-u          # Clear input
tmux send-keys -t $session 'continue'   # Send command
tmux send-keys -t $session Enter        # Execute
```

### **Pane Capture**

```bash
# Capture recent session output
tmux capture-pane -t $sessionName -p
```

### **Response Validation**

- ✅ **Pre-command capture**: Get output state before continue attempt
- ✅ **Post-command capture**: Verify continue worked (limit message gone)

---

## 🛡️ **Error Handling & Robustness**

### **Fault Tolerance**

- ✅ **Tmux failures**: Graceful handling of command failures
- ✅ **Network issues**: Telegram notification failures don't stop daemon
- ✅ **Parse errors**: Invalid time formats just log and continue monitoring
- ✅ **System interruptions**: Robust sleep/wake cycle handling

### **Logging & Debugging**

- ✅ **Timestamped logs**: All events show `[9/7/2025, 1:28:15 PM]`
- ✅ **Verbose output**: Shows tmux content, detection results, pattern matches
- ✅ **State visibility**: Clear indication of daemon state (scheduled, cooldown, etc.)

---

## ⏰ **Timing & Coordination**

### **Dynamic Polling Strategy**

```javascript
// Smart sleep intervals based on urgency
if (timeToReset > 30000)    // 30s+ away: sleep 30s
if (timeToReset < 30000)    // <30s away: sleep 5s
if (timeToReset < 5000)     // <5s away: sleep exactly
```

### **Intelligent Continuation Logic**

1. **If already scheduled**: Skip continue attempts → no spam notifications
2. **If limit detected & not restricted**: Try continue → check if succeeded
3. **If failed & has reset time**: Parse time → schedule → notify once
4. **If time arrives**: Clear schedule → continue → cooldown

---

## 🎪 **Edge Cases Covered**

### **Time Zone & Date Handling**

- ✅ **Same-day resets**: 5pm today if current time < 5pm
- ✅ **Next-day resets**: 5pm tomorrow if current time > 5pm
- ✅ **Parsing failures**: Robust regex with fallback patterns

### **System State Scenarios**

- ✅ **Laptop closed/reopened**: Smart polling handles sleep transitions
- ✅ **Multiple limit hits**: Only schedules once, prevents spam
- ✅ **Rapid re-detection**: Cooldown prevents spam after successful continuation
- ✅ **Long sessions**: Proper session monitoring without interference

### **User Experience Considerations**

- ✅ **Minimal notifications**: One per limit, one per continuation
- ✅ **Clear status**: Timestamped logs show exactly what daemon is doing
- ✅ **Non-intrusive**: Doesn't interfere with user's current tmux work
- ✅ **Configurable**: Environment-based setup (session name, Telegram, etc.)
