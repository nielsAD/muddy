"use strict";

const moment = require("moment-timezone");

const DELIM  = "!";
const USER_LEVEL = {
	USER         : 0,
	CHANNEL_MOD  : 1,
	CHANNEL_OWNER: 2,
	BOT_OWNER    : 3
}

const AFFERMATIVE = function() {
	const arr = ["okey-dokey", "affirmative", "aye aye", "if it must be done",
	             "very well", "fo' shizzle", "yessir", "sure", "roger", "righto",
	             "straight away", "at once", "consider it done", "will do",
	             "I guess I can", "if you want", "I can do that", "be happy to",
	             "work, work", "I only wish to serve", "I bow to your will",
	             "yes, master", "thy will be done", "done.", "as fast as I can"];
	return () => arr[Math.floor(Math.random() * arr.length)];
}();

class Command {
	constructor(chat, cmd, opt = "") {
		this.chat      = chat;
		this.command   = cmd;
		this.interval  = null;
		this.last_time = Number.MIN_SAFE_INTEGER;
		this.last_msg  = Number.MIN_SAFE_INTEGER;

		this.disabled       = opt.disabled       || false;
		this.level          = opt.level          || USER_LEVEL.USER;
		this.usage          = opt.usage          || "";
		this.description    = opt.description    || "";
		this.timer          = opt.timer          || 0;
		this.cooldown_time  = opt.cooldown_time  || 0;
		this.cooldown_lines = opt.cooldown_lines || 0;

		this.start();
	}

	serialize() {
		const res = {
			disabled:       this.disabled       || undefined,
			timer:          this.timer          || undefined,
			cooldown_time:  this.cooldown_time  || undefined,
			cooldown_lines: this.cooldown_lines || undefined,
		};
		return (Object.keys(res).length > 0) ? res : undefined;
	}

	get timer() { return this._timer; }
	set timer(t) {
		this.stop();
		this._timer = t;
		this.start();
	}

	stop() {
		if (this.interval !== null) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	start() {
		this.stop();
		if (this._timer > 0 && this.chat) {
			this.interval = setInterval( () => this.execute( (s) => this.chat.say(s) ), this._timer * 60000);
		}
	}

	describe() {
		const lvl = {
			[USER_LEVEL.CHANNEL_MOD]   : "Moderators only.",
			[USER_LEVEL.CHANNEL_OWNER] : "Broadcaster only.",
			[USER_LEVEL.BOT_OWNER]     : "No plebs."
		}
		return (`${this.disabled?"Disabled. " : ""}` +
			`${this.description?this.description+". ":""}` +
			`${this.usage?"Usage: "+this.usage+". ":""}` +
			`${this.timer?this.timer+" minute ":"No"} cycle. ` +
			`${this.cooldown_time?this.cooldown_time+" second(s)":"No"} cooldown. ` +
			`${this.cooldown_lines?this.cooldown_lines+" line(s)":"No"} spacing. ` +
			(lvl[this.level]||""));
	}

	respond(resp) {
		error("Invalid command usage");
	}

	execute(resp, user_level = 0, arg = []) {
		if (this.disabled && user_level < USER_LEVEL.CHANNEL_OWNER) return;
		if (user_level < this.level) return;
		const force = (user_level > USER_LEVEL.USER);

		const msg = this.chat && this.chat.num_seen;
		if (!force && (Math.abs(msg - this.last_msg) < this.cooldown_lines)) return;

		const now = new Date();
		if (!force && ((now - this.last_time) < this.cooldown_time*1000)) return;

		this.respond(resp, arg);
		this.last_time = now;
		this.last_msg  = msg;
	}
}

class CustomCommand extends Command {
	constructor(chat, cmd, opt = "") {
		if (typeof opt === "string")
			opt = {response: opt};

		super(chat, cmd, opt);
		this.response = opt.response;
		this.cooldown_time  = opt.cooldown_time  || 5;
		this.cooldown_lines = opt.cooldown_lines || 3;
	}

	serialize() {
		return Object.assign({}, super.serialize() || {}, {
			response: this.response
		});
	}

	respond(resp) {
		return resp(this.response);
	}
}

class Command_Enable extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd]";
		this.description = "Enable bot command";
	}

	respond(resp, [cmd]) {
		if (!this.chat) return;
		if (!cmd)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c)
			resp(`Unknown command "${cmd}"`);
		else {
			c.disabled = false;
			resp(AFFERMATIVE());
		}
	}
}

class Command_Disable extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd]";
		this.description = "Disable bot command";
	}

	respond(resp, [cmd]) {
		if (!this.chat) return;
		if (!cmd)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c)
			resp(`Unknown command "${cmd}"`);
		else if (c instanceof Command_Enable || c instanceof Command_Disable)
			resp("Not happening.")
		else {
			c.disabled = true;
			resp(AFFERMATIVE());
		}
	}
}

class Command_Command extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd]";
		this.description = "Get information on command";
	}

	respond(resp, [cmd]) {
		if (!this.chat) return;
		if (!cmd)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c)
			resp(`Unknown command "${cmd}"`);
		else
			resp(c.describe());
	}
}

class Command_Mute extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
	}

	respond(resp) {
		if (!this.chat || this.chat.muted) return;
		resp(AFFERMATIVE());
		this.chat.muted = true;
	}
}

class Command_Unmute extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
	}

	respond(resp) {
		if (!this.chat || !this.chat.muted) return;
		this.chat.muted = false;
		resp(AFFERMATIVE());
	}
}

class Command_Set extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd] [response]";
		this.description = "Add custom command";
	}

	respond(resp, [cmd, ...msg]) {
		if (!this.chat) return;
		if (!cmd || msg.length < 1)
			return resp(`Usage: ${this.command} ${this.usage}`);

		if (cmd.toLowerCase() in GLOBALS)
			resp(`Command "${cmd}" locked. Pick another.`);
		else {
			this.chat.setCommand(cmd, {response: msg.join(" ")});
			resp(AFFERMATIVE());
		}
	}
}

class Command_Unset extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd]";
		this.description = "Remove custom command";
	}

	respond(resp, [cmd]) {
		if (!this.chat) return;
		if (!cmd)
			return resp(`Usage: ${this.command} ${this.usage}`);

		if (cmd.toLowerCase() in GLOBALS)
			resp(`Command "${cmd}" locked. Cannot unset.`);
		else {
			this.chat.setCommand(cmd, false);
			resp(AFFERMATIVE());
		}
	}
}

class Command_Cooldown extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd] [seconds]";
		this.description = "Require at least x second delay before responding to command again";
	}

	respond(resp, [cmd, time]) {
		if (!this.chat) return;
		if (!cmd || !time && time !== 0)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c)
			resp(`Unknown command "${cmd}"`);
		else {
			c.cooldown_time = Math.max(time, 0);
			resp(AFFERMATIVE());
		}
	}
}

class Command_CooldownOff extends Command_Cooldown {
	constructor(...args) {
		super(...args);
		this.usage = "[cmd]";
		this.description = "Turn off cooldown time for command";
	}

	respond(resp, [cmd]) {
		super.respond(resp, [cmd, 0]);
	}
}

class Command_Spacing extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd] [lines]";
		this.description = "Require at least x new chat lines before responding to command again";
	}

	respond(resp, [cmd, lines]) {
		if (!this.chat) return;
		if (!cmd || !lines && lines !== 0)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c)
			resp(`Unknown command "${cmd}"`);
		else {
			c.cooldown_lines = Math.max(lines, 0);
			resp(AFFERMATIVE());
		}
	}
}

class Command_SpacingOff extends Command_Spacing {
	constructor(...args) {
		super(...args);
		this.usage = "[cmd]";
		this.description = "Turn off minimal line spacing for command";
	}

	respond(resp, [cmd]) {
		super.respond(resp, [cmd, 0]);
	}
}

class Command_Timer extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd] [minutes]";
		this.description = "Repeats command every x minutes";
	}

	respond(resp, [cmd, time]) {
		if (!this.chat) return;
		if (!cmd || !time && time !== 0)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c)
			resp(`Unknown command "${cmd}"`);
		else {
			c.timer = Math.max(time, 0);
			resp(AFFERMATIVE());
		}
	}
}

class Command_TimerOff extends Command_Timer {
	constructor(...args) {
		super(...args);
		this.usage = "[cmd]";
		this.description = "Removes timer from command";
	}

	respond(resp, [cmd]) {
		super.respond(resp, [cmd, 0]);
	}
}

class Command_Timezone extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[zone]";
		this.description = "Set timezone";
	}

	respond(resp, [tz]) {
		if (!this.chat) return;
		if (!tz)
			return resp(`Usage: ${this.command} ${this.usage}`);

		if (!moment.tz.zone(tz))
			resp(`Unknown timezone "${tz}"`);
		else {
			this.chat.timezone = tz;
			resp(AFFERMATIVE());
		}
	}
}

class Command_Time extends Command {
	constructor(...args) {
		super(...args);
		this.description = "Get local time";
		this.cooldown_time  = this.cooldown_time  || 5;
		this.cooldown_lines = this.cooldown_lines || 3;
	}

	respond(resp) {
		if (!this.chat) return;
		resp(moment().tz(this.chat.timezone).format("[Local time is] HH:mm z (MMM Do)"));
	}
}

class Command_Log extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.description = "Save snapshot of the chatroom";
	}

	respond(resp, reason) {
		if (!this.chat) return;
		this.chat.logAction(`User triggered ${this.command} (${reason.join(" ")||"No reason specified"})`);
		resp(AFFERMATIVE());
	}
}

const GLOBALS = {
	"enable":      Command_Enable,
	"disable":     Command_Disable,
	"command":     Command_Command,
	"mute":        Command_Mute,
	"unmute":      Command_Unmute,
	"set":         Command_Set,
	"unset":       Command_Unset,
	"cooldown":    Command_Cooldown,
	"cooldownoff": Command_CooldownOff,
	"spacing":     Command_Spacing,
	"spacingoff":  Command_SpacingOff,
	"timer":       Command_Timer,
	"timeroff":    Command_TimerOff,
	"timezone":    Command_Timezone,
	"time":        Command_Time,
	"log":         Command_Log,

	"on":          Command_Enable,
	"off":         Command_Disable,

	"addcom":      Command_Set,
	"editcom":     Command_Set,
	"delcom":      Command_Unset,
	"add":         Command_Set,
	"rem":         Command_Unset,

	"repeat":      Command_Timer,
	"repeatoff":   Command_TimerOff,
	"cycle":       Command_Timer,
	"cycleoff":    Command_TimerOff,

	"dump":        Command_Log
};

module.exports = {
	GLOBALS:     GLOBALS,
	DELIM:       DELIM,
	USER_LEVEL:  USER_LEVEL,
	AFFERMATIVE: AFFERMATIVE,

	Command:       Command,
	CustomCommand: CustomCommand,

	Command_Enable:      Command_Enable,
	Command_Disable:     Command_Disable,
	Command_Mute:        Command_Mute,
	Command_Unmute:      Command_Unmute,
	Command_Set:         Command_Set,
	Command_Unset:       Command_Unset,
	Command_Cooldown:    Command_Cooldown,
	Command_CooldownOff: Command_CooldownOff,
	Command_Spacing:     Command_Spacing,
	Command_SpacingOff:  Command_SpacingOff,
	Command_Timer:       Command_Timer,
	Command_TimerOff:    Command_TimerOff,
	Command_Timezone:    Command_Timezone,
	Command_Time:        Command_Time,
	Command_Command:     Command_Command
};
