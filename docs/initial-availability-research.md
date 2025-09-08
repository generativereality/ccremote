Improving Claude Code Workflow: Remote Approvals & Automated Continuation
Remote Permission Notifications & Approvals
Claude Code’s CLI often pauses mid-task to ask for user approval on sensitive actions (like running a Bash command or editing a file). This is a great safety feature, but it becomes a bottleneck if you’re away from your computer
zerocodingstartup.com
. Luckily, there are ways to get notified and approve these prompts remotely without disabling permissions entirely (no need for “YOLO” auto-accept mode). Here are some solutions users have developed for remote approvals:
SSH/Terminal Sharing (Tmux): A simple approach is to run Claude Code inside a persistent terminal (e.g. a tmux session) and connect to it from your phone or another device. For example, one guide shows how to SSH into your machine (using Tailscale for secure access), attach to the Claude Code tmux session, and interact with it from a mobile shell app
adim.in
. This way, whenever Claude Code prompts for confirmation, you can bring up the shared session on your phone and type the response. It’s essentially like having your terminal in your pocket. (This method is manual but effective; it doesn’t require additional code, just some setup for remote shell access.)
Claude Code Hooks (Custom Scripts): The latest versions of Claude Code support “hooks,” which are user-defined shell scripts that run on certain events
medium.com
. You can leverage hooks to automate notifications and approvals. For instance, a Pre-ToolUse hook can trigger when Claude is about to run a tool (like a shell command) – your script could then send a message to you (via Slack, Telegram, etc.) asking for approval and wait until you respond. One developer described creating an “approval-waiting” hook for sensitive commands that pauses Claude until a Slack approval comes through (they wrote a Bash script in ~/.claude/hooks/ that sends a Slack message and waits for a reply)
zerocodingstartup.com
. Using hooks, you have full control: the script can block the action until you explicitly allow it (by returning the appropriate exit code to Claude Code). This approach requires a bit of coding, but it’s very powerful and built into Claude Code’s design.
Notification Hooks to Slack/Pushover: Even if you don’t implement an interactive approval loop, you can at least get real-time notifications when Claude Code needs you. The Notification hook event triggers whenever Claude sends a notification (which includes permission prompts). Some open-source tools take advantage of this – for example, CodeInbox is a project that uses Claude Code’s hooks to forward notifications to external channels like Slack
github.com
. With a tool like that, you’d instantly see on your phone that “Claude Code is awaiting permission to run X,” and you could then jump in and approve via your preferred method. (CodeInbox in particular uses a service to deliver notifications to Slack and others, and you set it up by registering a hook command as shown
github.com
.)
Dedicated Remote Control Tools: There are community-built solutions specifically for remote-controlling Claude Code. One popular project is Claude-Code-Remote by Jessy Tsui, which bridges Claude Code with email and chat apps. It lets you receive a notification when Claude finishes a task or hits a prompt, then send new commands or approvals just by replying (via email, Discord, Telegram, etc.)
github.com
. In other words, you can start a Claude task on your PC, walk away, and when it needs input, you’ll get (for example) an email or Telegram message. Replying to that message feeds your input back into Claude Code. This tool abstracts the whole process, so you don’t have to script the hooks yourself – it configures Claude Code to send updates out and listen for replies on those channels. It’s open-source and can be configured to use fast messaging platforms (Discord or Telegram will be much quicker than email, avoiding the slow email issue you noted).
Slack Bot Interfaces: Another option is to integrate Claude Code directly with Slack as a chatbot. For example, there’s an open-source Slack bot that connects to Claude Code’s SDK/API, allowing you to chat with Claude in Slack DM or channels
github.com
. With this setup, you can effectively use Claude Code from anywhere: you give it instructions via Slack messages, and it performs them on your machine (with access to your code) and streams results back to the Slack thread. This particular bot supports things like threads (to preserve context) and even shows streaming responses in real time
github.com
. Using a Slack interface might slightly change your workflow (you’d be typing commands in Slack rather than directly in a terminal), but it ensures you’re always notified of questions and can respond on the go. If you prefer Slack and want a more structured solution, this could be worth exploring. (It likely uses the underlying Claude Code API or Anthropics API under the hood, similar to how tools like Cline or RooCode operate.)
Each approach has its trade-offs. Hooks + your own scripts give a lot of flexibility (and can integrate with any service – Slack, Pushover, SMS, etc.), whereas ready-made bots/tools might be easier to set up if they already match your needs. The key point is that you don’t need to sit at the computer for every approval – you can receive instant notifications on your phone and even send the “yes/no” or next command remotely. By leveraging Claude Code’s hooks or third-party integrations, many users have achieved a much more asynchronous workflow where Claude can work for hours and ping them only when human input is truly needed.
Automating Continuation After 5-Hour Usage Windows
Another pain point is Claude Code’s 5-hour rolling usage window. As you noted, each session has a limited token quota and a 5-hour time window; after that, you have to wait for the window to reset (or start a new session) to continue heavy work. According to Anthropic’s documentation, a session “begins with your first message to Claude and expires exactly five hours later” regardless of usage
apidog.com
. Hitting the cap often means Claude stops mid-task and you might have to come back later to resume. To streamline this, you can set up automatic session continuation so that your work resumes right when the next window opens:
Track Your Session Window: First, you need to know when your current 5-hour window will reset. There are tools like the ccusage CLI and the Claude Code Usage Monitor that can display your session timing. For example, running npm exec ccusage (or the more detailed npx ccusage@latest blocks --live) will show your session’s start time and end time, current usage, etc.
reddit.com
reddit.com
. This lets you see exactly when the 5-hour mark is up. (Some users prefer the fancier usage monitor UI, but the idea is the same – you get a countdown or timestamp for when you’ll have tokens again.)
Schedule a “Continue” Prompt: Once you know the reset time, you can schedule Claude to continue the task automatically. Claude Code has a built-in way to resume a conversation: the claude --continue command. In fact, you can use claude --continue --print "Continue" to non-interactively send a message to your last session
docs.anthropic.com
. This will reopen the most recent conversation (maintaining all its context) and feed it the prompt "Continue" (or whatever you want to say) as soon as it starts. In practice, you could set up a cron job or a simple timed script to execute this command a few minutes after the window reopens. For example, if your session started at 9:00 AM, it expires by 2:00 PM; you might schedule claude --continue --print "continue where you left off" at 2:01 PM. Claude will then wake up and carry on with the previous task as if you had come back and manually told it to continue.
Automation Tools or Scripts: If you prefer not to manually calculate times, you could write a small script to query the session status and sleep until the reset. Some community members even suggested using external automation – one person mentioned triggering a GitHub Action at the window reset time to send a command
reddit.com
. You might not need to go that far, but it illustrates that it’s doable to automate. A straightforward local approach is: use the ccusage data or Claude’s own status line (if enabled) to get the remaining time, then use a sleep in a bash script or a scheduled task to run the --continue command when ready.
Be Mindful of Session Limits: One caveat – each 5-hour window counts as a session, and Anthropic does impose a monthly session limit (for example, some users noticed if you exceed ~50 sessions in a month, you could be throttled)
reddit.com
. Automating continuous sessions back-to-back could approach that limit if you truly run it around the clock. It’s worth planning around this (e.g. maybe you only auto-continue a couple of times per day when you really need long runs). In practice, if you’re on a Pro/Max plan and only scheduling one continuation when you hit a limit overnight or during a break, it should be fine – just avoid creating an endless loop of sessions.
By implementing a timed “continue” mechanism, you ensure Claude Code picks up right where it left off as soon as it’s allowed to. For example, if a long code generation got cut off at the end of the window, Claude can resume and finish it without you having to watch the clock. Combined with the remote notifications above, this means you could let Claude work on a big task, step away for a few hours, and it will automatically resume and perhaps even complete the task in the next window – all while keeping you posted via your phone. Sources:
Anthropic Claude documentation and community tips on usage limits
apidog.com
reddit.com
Open-source tools and write-ups for Claude Code remote control and hooks
github.com
github.com
medium.com
Discussions of scheduling around the 5-hour window on Reddit
reddit.com
docs.anthropic.com
 (various strategies to maximize uninterrupted usage without manual intervention).
Citations

How Claude Code Hook with Slack Helps Me Build My Dreams — While Raising a Kid and Working Full-Time | by Zero Code Startup | Jul, 2025 | Medium
https://zerocodingstartup.com/how-claude-hook-with-slack-helps-me-build-my-dreams-while-raising-a-kid-and-working-full-time-fc5283aa94ee?gi=547755edeebb
Remote controlling Claude Code | ~/adi
https://adim.in/p/remote-control-claude-code/

How I’m Using Claude Code Hooks To Fully Automate My Workflow | Medium
https://medium.com/@joe.njenga/use-claude-code-hooks-newest-feature-to-fully-automate-your-workflow-341b9400cfbe

GitHub - codeinbox/codeinbox: Notifications from Claude sent to Slack & other channels
https://github.com/codeinbox/codeinbox

GitHub - codeinbox/codeinbox: Notifications from Claude sent to Slack & other channels
https://github.com/codeinbox/codeinbox

GitHub - JessyTsui/Claude-Code-Remote: Control Claude Code remotely via email、discord、telegram. Start tasks locally, receive notifications when Claude completes them, and send new commands by simply replying to emails.
https://github.com/JessyTsui/Claude-Code-Remote

GitHub - mpociot/claude-code-slack-bot: Connect your local Claude Code agent with Slack
https://github.com/mpociot/claude-code-slack-bot

GitHub - mpociot/claude-code-slack-bot: Connect your local Claude Code agent with Slack
https://github.com/mpociot/claude-code-slack-bot

How to Monitor Claude Code Usage in Real-time with this Open Source Tool:
https://apidog.com/blog/claude-code-usage-monitor/

Abusing the 5 hour window of Claude Code : r/ClaudeCode
https://www.reddit.com/r/ClaudeCode/comments/1m6pvc5/abusing_the_5_hour_window_of_claude_code/

Abusing the 5 hour window of Claude Code : r/ClaudeCode
https://www.reddit.com/r/ClaudeCode/comments/1m6pvc5/abusing_the_5_hour_window_of_claude_code/

Common workflows - Anthropic
https://docs.anthropic.com/en/docs/claude-code/common-workflows

Abusing the 5 hour window of Claude Code : r/ClaudeCode
https://www.reddit.com/r/ClaudeCode/comments/1m6pvc5/abusing_the_5_hour_window_of_claude_code/

Abusing the 5 hour window of Claude Code : r/ClaudeCode
https://www.reddit.com/r/ClaudeCode/comments/1m6pvc5/abusing_the_5_hour_window_of_claude_code/

Abusing the 5 hour window of Claude Code : r/ClaudeCode
https://www.reddit.com/r/ClaudeCode/comments/1m6pvc5/abusing_the_5_hour_window_of_claude_code/

Abusing the 5 hour window of Claude Code : r/ClaudeCode
https://www.reddit.com/r/ClaudeCode/comments/1m6pvc5/abusing_the_5_hour_window_of_claude_code/

Common workflows - Anthropic
https://docs.anthropic.com/en/docs/claude-code/common-workflows
