"use strict";

const moment = require("moment-timezone");

const DELIM  = "!";
const USER_LEVEL = {
	BOT          : 0,
	USER         : 1,
	SUBSCRIBER   : 2,
	CHANNEL_MOD  : 3,
	CHANNEL_OWNER: 4,
	BOT_OWNER    : 5
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

const COOLDOWN_DEF_TIME  = 10;
const COOLDOWN_DEF_LINES = 1;

class Command {
	constructor(chat, cmd, opt = {}) {
		this.chat      = chat;
		this.command   = cmd;
		this.interval  = null;
		this.last_time = Number.MIN_SAFE_INTEGER;
		this.last_msg  = Number.MIN_SAFE_INTEGER;

		this.source         = opt.source;
		this.disabled       = opt.disabled       || false;
		this.level          = opt.level          || USER_LEVEL.BOT;
		this.usage          = opt.usage          || "";
		this.description    = opt.description    || "";
		this.timer          = opt.timer          || 0;
		this.cooldown_time  = opt.cooldown_time  || 0;
		this.cooldown_lines = opt.cooldown_lines || 0;
	}

	serialize() {
		const res = {
			source:         this.source         || undefined,
			disabled:       this.disabled       || undefined,
			timer:          this.timer          || undefined,
			cooldown_time:  (this.cooldown_time !== COOLDOWN_DEF_TIME && this.cooldown_time)    || undefined,
			cooldown_lines: (this.cooldown_lines !== COOLDOWN_DEF_LINES && this.cooldown_lines) || undefined,
		};
		return (Object.keys(res).some( (k) => res[k] !== undefined )) ? res : undefined;
	}

	get disabled() { return this._disabled; }
	set disabled(d) {
		if (this._disabled !== d) {
			this._disabled = d;

			if (d)
				this.disable();
			else
				this.enable();
		}
	}

	get timer() { return this._timer; }
	set timer(t) {
		this.stop();
		this._timer = t;
		this.start();
	}

	enable() {
		this.disable();
		this.start();
	}

	disable() {
		this.stop();
	}

	start() {
		this.stop();
		if (this._timer > 0 && this.chat) {
			this.interval = setInterval( () => this.execute( (s) => this.chat.say(s) ), this._timer * 60000);
		}
	}

	stop() {
		if (this.interval !== null) {
			clearInterval(this.interval);
			this.interval = null;
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
			`${this.usage?"Usage: "+this.command+" "+this.usage+". ":""}` +
			`${this.timer?this.timer+" minute":"No"} cycle. ` +
			`${this.cooldown_time?this.cooldown_time+" second(s)":"No"} cooldown. ` +
			`${this.cooldown_lines?this.cooldown_lines+" line(s)":"No"} spacing. ` +
			(lvl[this.level]||""));
	}

	respond(resp) {
		error("Invalid command usage");
	}

	execute(resp, user_level = USER_LEVEL.BOT, arg = []) {
		if (this.disabled && user_level < USER_LEVEL.BOT_OWNER) return;
		if (user_level < this.level) return;
		const force = (user_level >= USER_LEVEL.CHANNEL_MOD);

		const msg = this.chat && this.chat.num_seen;
		if (!force && (Math.abs(msg - this.last_msg) < this.cooldown_lines)) return;

		const now = new Date();
		if (!force && ((now - this.last_time) < this.cooldown_time*1000)) return;

		this.stop();
		try {
			this.respond(resp, arg.slice());
			return true;
		} finally {
			this.last_time = now;
			this.last_msg  = msg;
			this.start();
		}
	}
}

class CustomCommand extends Command {
	constructor(chat, cmd, opt = {}) {
		if (typeof opt === "string")
			opt = {response: opt};

		super(chat, cmd, opt);
		this.response = opt.response;
		this.chance   = opt.chance   || 0;
		this.triggers = opt.triggers || 0;
		this.locked   = opt.locked   || false;
		this.cooldown_time  = opt.cooldown_time  || COOLDOWN_DEF_TIME;
		this.cooldown_lines = opt.cooldown_lines || COOLDOWN_DEF_LINES;
	}

	serialize() {
		const res = Object.assign({}, super.serialize(), {
			response: this.response || undefined,
			chance:   this.chance   || undefined,
			triggers: this.triggers || undefined
		});
		return (Object.keys(res).some( (k) => res[k] !== undefined )) ? res : undefined;
	}

	respond(resp) {
		if (!this.response || !this.response.length || this.chance > Math.random()*100) return;
		return resp(Array.isArray(this.response)
			? this.response[Math.floor(Math.random() * this.response.length)]
			: this.response
		);
	}

	execute(...args) {
		const res = super.execute(...args);
		if (res) {
			this.triggers += 1;
		}
		return res;
	}

	describe() {
		return super.describe() +
			` ${100 - this.chance}% respond chance.` +
			` Triggered ${this.triggers} time(s).`;
	}
}

class Command_DiscordGuild extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.BOT_OWNER;
		this.usage = "[id]";
		this.description = "Get/Set Discord guild";
	}

	respond(resp, [guild]) {
		if (!this.chat) return;

		if (guild) {
			this.chat.discord_guild = guild;
			resp(AFFERMATIVE());
		} else {
			resp(`Current guild: "${this.chat.discord_guild||"unset"}"`);
		}
	}
}

class Command_DiscordModRole extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_OWNER;
		this.usage = "[role]";
		this.description = "Get/Set Discord moderator role";
	}

	respond(resp, [role]) {
		if (!this.chat) return;

		if (role) {
			this.chat.discord_mods = role;
			resp(AFFERMATIVE());
		} else {
			resp(`Current role: "${this.chat.discord_mods||"unset"}"`);
		}
	}
}

class Command_DiscordLogChannel extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_OWNER;
		this.usage = "[channel]";
		this.description = "Get/Set Discord log channel";
	}

	respond(resp, [chan]) {
		if (!this.chat) return;

		if (chan) {
			const r = chan.match(/^<#(\d+)>$/);
			this.chat.discord_log = (r && r[1]) || chan;
			resp(AFFERMATIVE());
		} else {
			resp(`Current channel: "<#${this.chat.discord_log||"unset"}>"`);
		}
	}
}

class Command_ModRights extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_OWNER;
		this.description = "Toggle Twitch moderator command rights";
	}

	respond(resp) {
		if (!this.chat) return;
		this.chat.no_mod_rights = !this.chat.no_mod_rights;
		resp((this.chat.no_mod_rights)
			? "Twitch moderators lost elevated command rights."
			: "Twitch moderators gained elevated command rights."
		);
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
			return resp(`Usage: ${this.command} ${this.usage}. Supported timezones: https://docs.nightbot.tv/commands/variables/time#timezones`);

		if (!moment.tz.zone(tz))
			resp(`Unknown timezone "${tz}". Supported timezones: https://docs.nightbot.tv/commands/variables/time#timezones`);
		else {
			this.chat.timezone = tz;
			resp(AFFERMATIVE());
		}
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
		else if (c instanceof Command_Enable || c instanceof Command_Disable || c instanceof Command_Help)
			resp("Not happening.")
		else {
			c.disabled = true;
			resp(AFFERMATIVE());
		}
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

		const c = this.chat.command(cmd) || this.chat.setCommand(cmd, {});
		if (!(c instanceof CustomCommand) || c.locked)
			resp(`Command "${cmd}" locked. Pick another.`);
		else {
			c.response = msg.join(" ");
			c.disabled = false;
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

		const c = this.chat.command(cmd);
		if (!c || !(c instanceof CustomCommand))
			resp(`Unknown custom command "${cmd}"`);
		else if (c.locked)
			resp(`Command "${cmd}" locked. Use !disable.`);
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

		time = parseInt(time);
		if (!cmd || !time && time !== 0)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c || !(c instanceof CustomCommand))
			resp(`Unknown custom command "${cmd}"`);
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

		lines = parseInt(lines);
		if (!cmd || !lines && lines !== 0)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c || !(c instanceof CustomCommand))
			resp(`Unknown custom command "${cmd}"`);
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

		time = parseInt(time);
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

class Command_Chance extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[cmd] [0-100%]";
		this.description = "Set chance for a response message";
	}

	respond(resp, [cmd, chance]) {
		if (!this.chat) return;

		chance = parseInt(chance);
		if (!cmd || !chance && chance !== 0)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const c = this.chat.command(cmd);
		if (!c || !(c instanceof CustomCommand))
			resp(`Unknown custom command "${cmd}"`);
		else {
			c.chance = 100-Math.max(Math.min(chance, 100), 0);
			resp(AFFERMATIVE());
		}
	}
}

class Command_ChanceOff extends Command_Chance {
	constructor(...args) {
		super(...args);
		this.usage = "[cmd]";
		this.description = "Removes response chance (always respond)";
	}

	respond(resp, [cmd]) {
		super.respond(resp, [cmd, 100]);
	}
}

class Command_Say extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[message]";
		this.description = "Say message in Twitch chat.";
	}

	respond(resp, msg) {
		if (!this.chat) return
		if (msg.length < 1)
			return resp(`Usage: ${this.command} ${this.usage}`);

		this.chat.say(msg.join(" "));
	}
}

class Command_LastSeen extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[username]";
		this.description = "Show what user x said last and when it was said";
	}

	respond(resp, [user]) {
		if (!this.chat || !this.chat.users) return;
		if (!user)
			return resp(`Usage: ${this.command} ${this.usage}`);

		const last = this.chat.users[user.toLowerCase()];
		resp(last && last[2]
			? `${user} was last seen ${moment(last[0]).fromNow()} saying "${last[2]}"`
			: `${user} has not been seen chatting`
		);
	}
}

class Command_Winner extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.usage = "[minutes]";
		this.description = "Pick random user from chat who said something in the last x minutes";
	}

	respond(resp, [min = 10]) {
		if (!this.chat || !this.chat.users) return;

		const threshold = new Date() - ((parseInt(min)||1) * 60000);
		const users = Object.keys(this.chat.users).filter( (u) => !this.chat.users[u][3] && this.chat.users[u][0] > threshold);
		if (users.length < 1) return;

		resp("@" + users[Math.floor(Math.random() * users.length)]);
	}
}

class Command_Help extends Command {
	constructor(...args) {
		super(...args);
		this.level = USER_LEVEL.CHANNEL_MOD;
		this.description = "List bot configuration commands";
	}

	respond(resp) {
		if (!this.chat) return;

		if (this.chat.muted)
			try {
				this.chat.muted = false;
				return resp("Muted. Use !unmute first.");
			} finally {
				this.chat.muted = true;
			}

		let mod = [];
		let cus = [];
		let off = [];
		for (let cmd in this.chat.commands) {
			cmd = this.chat.commands[cmd];
			if (cmd.level > USER_LEVEL.CHANNEL_MOD || cmd===this)
				continue;

			if (cmd.disabled)
				off.push(cmd.command);
			else if (cmd.level === USER_LEVEL.CHANNEL_MOD)
				mod.push(cmd.command)
			else
				cus.push(cmd.command);
		}

		resp("Reporting for duty."
			+ ' Use !mute to silence me or'
			+ ` !command [cmd] for specific command info (e.g. !command muddyhelp).`
			+ " \nModerator Commands: " + mod.join(" ") + "."
			+ (cus.length > 0 ? " \nUser Commands: " + cus.join(" ") + "." : "")
			+ (off.length > 0 ? " \nDisabled Commands: " + off.join(" ") + "." : ""));
	}
}

class Command_Cmd extends CustomCommand {
	constructor(...args) {
		super(...args);
		this.description = "List usable commands";
		this.locked = true;
	}

	respond(resp) {
		if (!this.chat) return;

		let user = [];
		let subs = [];
		for (let cmd in this.chat.commands) {
			cmd = this.chat.commands[cmd];
			if (cmd.disabled || cmd===this) continue;
			if (cmd.level <= USER_LEVEL.USER)
				user.push(cmd.command);
			else if (cmd.level <= USER_LEVEL.SUBSCRIBER)
				subs.push(cmd.command);
		}

		if (user.length < 1 && subs.length < 1) return;
		resp("Use me: " + user.join(" ") + (subs.length > 0 ? " \nSubscribers ony: " + subs.join(" ") : ""));
	}
}

class Command_Time extends CustomCommand {
	constructor(...args) {
		super(...args);
		this.description = "Get or convert local time";
		this.locked = true;
	}

	respond(resp, time) {
		if (!this.chat) return;

		const convert = time.length > 0;
		let  timezone = this.chat.timezone;
		if (time.length > 1 && !time[time.length - 1].match(/^(am|pm)$/i)) {
			timezone = time.pop();
			if (!moment.tz.zone(timezone)) {
				resp(`Invalid timezone. Supported timezones: https://docs.nightbot.tv/commands/variables/time#timezones`);
				return;
			}
		}

		const t = (time.length > 0)
			? moment.tz(time.join(" ").trim().replace(/\./g, ":"), ["ha", "h a", "h:ma", "h:m a", "H:m"], true, timezone)
			: moment().tz(timezone);

		if (!t.isValid()) {
			resp(`Invalid time format. Valid examples: ${this.command} 10:30 pm, ${this.command} 22:30, ${this.command} 22:30 CET`);
			return;
		}

		resp(convert
			? `${time.join(" ")} is ${t.fromNow()}. That's
				${t.tz("America/Los_Angeles").format("HH:mm")} in Los Angeles (${t.tz("America/Los_Angeles").format("z")}),
				${t.tz("America/New_York").format("HH:mm")}    in New York    (${t.tz("America/New_York").format("z")}),
				${t.tz("Europe/Paris").format("HH:mm")}        in Paris       (${t.tz("Europe/Paris").format("z")}),
				${t.tz("Europe/Moscow").format("HH:mm")}       in Moscow      (${t.tz("Europe/Moscow").format("z")}),
				${t.tz("Asia/Shanghai").format("HH:mm")}       in Shanghai    (${t.tz("Asia/Shanghai").format("z")}), and
				${t.tz("Asia/Seoul").format("HH:mm")}          in Seoul       (${t.tz("Asia/Seoul").format("z")}).`.replace(/\s+/g, " ")
			: t.format("[Local time is] HH:mm z (MMM Do)")
		);
	}
}


const GLOBALS = {
	//CHANNEL OWNER
	"discord_guild": Command_DiscordGuild,
	"discord_mods":  Command_DiscordModRole,
	"discord_log":   Command_DiscordLogChannel,
	"modrights":     Command_ModRights,

	// MODERATOR
	"muddyhelp":     Command_Help,
	"mute":          Command_Mute,
	"unmute":        Command_Unmute,
	"command":       Command_Command,
	"enable":        Command_Enable,
	"disable":       Command_Disable,
	"set":           Command_Set,
	"unset":         Command_Unset,
	"cooldown":      Command_Cooldown,
	"cooldownoff":   Command_CooldownOff,
	"spacing":       Command_Spacing,
	"spacingoff":    Command_SpacingOff,
	"repeat":        Command_Timer,
	"repeatoff":     Command_TimerOff,
	"chance":        Command_Chance,
	"chanceoff":     Command_ChanceOff,
	"say":           Command_Say,
	"chatlog":       Command_Log,
	"timezone":      Command_Timezone,
	"lastseen":      Command_LastSeen,
	"winner":        Command_Winner,

	// USER
	"cmd":           Command_Cmd,
	"time":          Command_Time

/*
	"on":            Command_Enable,
	"off":           Command_Disable,

	"addcom":        Command_Set,
	"editcom":       Command_Set,
	"delcom":        Command_Unset,
	"add":           Command_Set,
	"rem":           Command_Unset,

	"timer":         Command_Timer,
	"timeroff":      Command_TimerOff,
	"cycle":         Command_Timer,
	"cycleoff":      Command_TimerOff,

	"dump":          Command_Log
*/
};

module.exports = {
	GLOBALS:     GLOBALS,
	DELIM:       DELIM,
	USER_LEVEL:  USER_LEVEL,
	AFFERMATIVE: AFFERMATIVE,

	Command:       Command,
	CustomCommand: CustomCommand,

	Command_DiscordGuild:      Command_DiscordGuild,
	Command_DiscordModRole:    Command_DiscordModRole,
	Command_DiscordLogChannel: Command_DiscordLogChannel,
	Command_ModRights:         Command_ModRights,
	Command_Help:              Command_Help,
	Command_Timezone:          Command_Timezone,
	Command_Mute:              Command_Mute,
	Command_Unmute:            Command_Unmute,
	Command_Log:               Command_Log,
	Command_Command:           Command_Command,
	Command_Enable:            Command_Enable,
	Command_Disable:           Command_Disable,
	Command_Set:               Command_Set,
	Command_Unset:             Command_Unset,
	Command_Cooldown:          Command_Cooldown,
	Command_CooldownOff:       Command_CooldownOff,
	Command_Spacing:           Command_Spacing,
	Command_SpacingOff:        Command_SpacingOff,
	Command_Timer:             Command_Timer,
	Command_TimerOff:          Command_TimerOff,
	Command_Say:               Command_Say,
	Command_LastSeen:          Command_LastSeen,
	Command_Winner:            Command_Winner,
	Command_Cmd:               Command_Cmd,
	Command_Time:              Command_Time
};
