# ⏰ **Scheduling System Design**

## **The Challenge**

Claude Code has 5-hour usage limits that reset at specific times. We need to automatically continue sessions when limits reset, but laptop sleep/wake cycles break traditional scheduling approaches.

---

## **Sleep/Wake Problems**

### **setTimeout() Issues:**

- **Windows**: Timer fires after full original duration (not remaining time after wake)
- **All platforms**: Timers can drift or be delayed significantly after system sleep
- **Known Node.js issues**: Multiple GitHub issues about this exact problem

### **Library Limitations:**

- **node-schedule**: Also has sleep/wake drift issues on Windows
- **node-cron**: Same underlying setTimeout problems
- **croner**: Better but still not sleep-aware

---

## **Polling-Based Solution (Recommended)**

Since there's no reliable sleep-aware scheduling without external dependencies, we'll use intelligent polling from the working proof of concept:

### **Smart Polling Implementation:**

```typescript
class SmartPoller {
	private pollingInterval = 30000; // Default: 30 seconds

	async monitorSession(sessionId: string) {
		while (this.isActive(sessionId)) {
			const limitInfo = await this.checkForLimits(sessionId);

			if (limitInfo) {
				const resetTime = parseResetTime(limitInfo.resetMessage);
				const timeToReset = resetTime.getTime() - Date.now();

				// Adjust polling frequency based on urgency
				if (timeToReset > 30000) {
					this.pollingInterval = 30000; // 30s when far away
				}
				else if (timeToReset > 5000) {
					this.pollingInterval = 5000; // 5s when close
				}
				else {
					this.pollingInterval = 1000; // 1s when very close
				}
			}

			await this.sleep(this.pollingInterval);
		}
	}
}
```

### **Benefits:**

- ✅ **Sleep robust**: Works regardless of laptop sleep/wake cycles
- ✅ **Self-correcting**: Automatically detects and adapts to timing changes
- ✅ **No external dependencies**: Pure Node.js implementation
- ✅ **Proven approach**: Based on working proof of concept

---

## **Polling Optimization**

### **Dynamic Intervals:**

- **30 seconds**: Normal monitoring (low CPU usage)
- **5 seconds**: When reset time approaches (increased accuracy)
- **1 second**: In final moments before reset (maximum precision)

### **CPU Efficiency:**

```typescript
// Typical session monitoring:
// - 29 minutes at 30s intervals = 58 checks
// - 25 seconds at 5s intervals = 5 checks
// - 5 seconds at 1s intervals = 5 checks
// Total: 68 checks vs 1800 checks with constant 1s polling
```

### **Sleep/Wake Robustness:**

- No timers to drift during sleep
- Resumes monitoring immediately upon wake
- Automatically catches up on missed reset times
- No complex state persistence needed

---

## **Implementation Details**

### **Limit Detection Patterns:**

```javascript
const LIMIT_PATTERNS = [
	/5-hour limit reached.*resets (\d{1,2}(?::\d{2})?(?:am|pm))/i,
	/usage limit.*resets (\d{1,2}(?::\d{2})?(?:am|pm))/i,
	/limit reached.*available (?:again )?at (\d{1,2}(?::\d{2})?(?:am|pm))/i
];
```

### **Time Parsing:**

```javascript
function parseResetTime(timeStr) {
	// "10pm" -> today 10:00 PM or tomorrow if current time > 10 PM
	// "2:30pm" -> today 2:30 PM or tomorrow if current time > 2:30 PM
	// Handle AM/PM conversion, date logic, timezone considerations
}
```

### **Continuation Logic:**

```javascript
async function attemptContinuation(sessionId) {
	// Try continuing immediately
	const success = await sendContinueCommand(sessionId);

	if (!success) {
		// Still limited, schedule next check
		return false;
	}

	// Success - enter cooldown period
	await this.sleep(5 * 60 * 1000); // 5 minute cooldown
	return true;
}
```

---

## **Why Not Other Approaches?**

### **Pure setTimeout():**

❌ Breaks on laptop sleep (timers fire late)
❌ No automatic recovery from missed executions
❌ Complex state management needed for persistence

### **External Schedulers (node-schedule, etc.):**

❌ Add dependencies for minimal benefit
❌ Still have sleep/wake issues on some platforms
❌ More complex than needed for our use case

### **OS-level Schedulers (cron, at):**

❌ Platform-specific implementations
❌ Complex setup and management
❌ No integration with session state

### **Heartbeat + setTimeout Hybrid:**

❌ Redundant approaches (only need one)
❌ More complex code for same result
❌ Still polling under the hood anyway

---

## **Conclusion**

The smart polling approach from our proof of concept is the most practical solution:

1. **Reliable**: Works across all platforms and sleep scenarios
2. **Simple**: No external dependencies or complex state
3. **Efficient**: Dynamic intervals minimize CPU usage
4. **Proven**: Already working in our prototype

This gives us the reliability of polling with the efficiency of event-driven scheduling.
