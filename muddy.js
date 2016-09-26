"use strict";

const fs     = require("fs");
const util   = require("util");
const moment = require("moment-timezone");
const tmi    = require("tmi.js");
const djs    = require("discord.js");

const config   = require("./config.json");
const commands = require("./commands.js");

function pad(s, w, d=" ") {
	s = String(s);
	return (s.length < w)
		? (d.repeat(w)+s).slice(-w)
		: s;
}

function error(msg) {
	throw new Error(msg);
}

if (!config.discord || !config.discord.identity || !config.twitch || !config.channels)
	error("Invalid config file.");

let discord = new djs.Client(Object.assign({}, config.discord.connection));
let twitch  = new tmi.client(Object.assign({}, config.twitch));

let twitch_chat  = {};
let discord_chat = {};

const twitch_owners  = new Set(config.twitch.owners);
const discord_owners = new Set(config.discord.owners);

const newline = "\r\n";
const log_template = [
	"Muddy-bot Log",
	"-------------",
	"  Channel: %s",
	"  Date:    %s",
	"  Action:  %s",
	"  Mods:    %s",
	"",
	"Chat",
	"----",
	"%s"
].join(newline)

class Command_Join extends commands.Command {
	constructor(...args) {
		super(...args);
		this.level = commands.USER_LEVEL.BOT_OWNER;
		this.usage = "[chan]";
	}

	respond(resp, [chan]) {
		if (!chan && this.chat)
			return resp(`Usage: ${this.command} ${this.usage}`);
		else if (twitch_chat[(chan||"").toLowerCase()])
			return;

		TwitchChat.join(chan).then( () => {
			TwitchChat.channel(chan).say("I come from the darkness of the pit.");
		}).catch( (err) => {
			console.log(`[TWITCH] ${err.message || err}`);
			console.log(err.stack);
			resp(`Failed to join "${chan}`);
		});
	}
}

class Command_Leave extends commands.Command {
	constructor(...args) {
		super(...args);
		this.level = commands.USER_LEVEL.BOT_OWNER;
	}

	respond(resp) {
		if (!this.chat) return;
		resp(commands.AFFERMATIVE());
		this.chat.part().catch( (err) => {
			this.chat.muted = true;
			console.log(`[TWITCH] ${err.message || err}`);
			console.log(err.stack);
		});
	}
}

commands.GLOBALS["join"]  = Command_Join;
commands.GLOBALS["leave"] = Command_Leave;

class TwitchChat {
	constructor(chan, opt = {}) {
		this.chan       = chan;
		this.num_seen   = opt.num_seen   || 0;
		this.messages   = opt.messages   || [];
		this.users      = opt.users      || {};
		this.moderators = opt.moderators || new Set();

		this.no_mod_rights = opt.no_mod_rights || false;
		this.timezone      = opt.timezone      || moment.tz.guess();
		this.muted         = opt.muted         || false;

		this.discord_guild = opt.discord_guild || "";
		this.discord_mods  = opt.discord_mods  || "";
		this.discord_log   = opt.discord_log   || "";

		this.commands = {};
		if (!opt.commands)
			opt.commands = {};

		for (let cmd in commands.GLOBALS) {
			const c = commands.DELIM + cmd;
			this.commands[c] = new commands.GLOBALS[cmd](this, c, opt.commands[c]);
			delete opt.commands[c];
		}
		for (let cmd in opt.commands)
			this.setCommand(cmd, opt.commands[cmd]);
	}

	static channel(chan) {
		return twitch_chat[chan.toLowerCase()] || error(`[TWITCH] Trying to access invalid channel "${chan}"`);
	}

	static get channels() {
		return Object.keys(twitch_chat).map( (c) => twitch_chat[c]);
	}

	static join(chan, opt = {}) {
		twitch_chat[chan.toLowerCase()] = new TwitchChat(chan, opt);
		return twitch.join(chan).then( () => {
			console.log(`[TWITCH] Joined "${chan}"`);
		}).catch( (err) => {
			delete twitch_chat[chan.toLowerCase()];
		});
	}

	part() {
		this.discord_guild = "";
		for (let cmd in this.commands)
			this.commands[cmd].stop();

		return twitch.part(this.chan).then( () => {
			delete twitch_chat[this.chan.toLowerCase()];
			console.log(`[TWITCH] Left "${this.chan}"`);
		});
	}

	serialize() {
		let res = {
			no_mod_rights:   this.no_mod_rights || undefined,
			timezone:        this.timezone      || undefined,
			muted:           this.muted         || undefined,
			discord_guild:   this.discord_guild || undefined,
			discord_mods:    this.discord_mods  || undefined,
			discord_log:     this.discord_log   || undefined,
			commands:        {}
		};
		for (let cmd in this.commands)
			res.commands[this.commands[cmd].command] = this.commands[cmd].serialize();
		return res;
	}

	static serialize() {
		let res = {};
		this.channels.forEach( (c) => {
			res[c.chan] = c.serialize();
		});
		return res;
	}

	get discord_guild() { return this._discord_guild; }
	set discord_guild(g) {
		if (this.discord_guild)
			discord_chat[this.discord_guild].delete(this);
		if (!g) return;
		if (!(g in discord_chat))
			discord_chat[g] = new Set();
		this._discord_guild = g;
		discord_chat[g].add(this);
	}

	addMessage(user, message, date = new Date()) {
		const msg = [date, user, message]
		this.users[user] = msg;
		this.messages.push(msg);
	}

	truncateMessages(threshold = new Date() - 80000) {
		this.messages = this.messages.filter( (log) => log[0] > threshold );
	}

	onMessage(user, message, self) {
		this.addMessage(user.username, message);
		if (self) return;

		this.num_seen = (this.num_seen + 1) % Number.MAX_SAFE_INTEGER;

		if (message.startsWith(commands.DELIM)) {
			const [cmd, ...args] = message.split(/\s+/);
			const command = this.command(cmd);
			if (command) {
				const user_level = (
					twitch_owners.has(user.username)              ? commands.USER_LEVEL.BOT_OWNER :
					(this.chan.toLowerCase()==="#"+user.username) ? commands.USER_LEVEL.CHANNEL_OWNER :
					user.mod && !this.no_mod_rights               ? commands.USER_LEVEL.CHANNEL_MOD :
					user.mod || user.subscriber                   ? commands.USER_LEVEL.SUBSCRIBER :
					                                                commands.USER_LEVEL.USER
				);
				command.execute((s) => this.say(s), user_level, args);
			}
		}
	}

	onClear() {
		this.num_seen = 0;
	}

	say(message) {
		return !this.muted && twitch.say(this.chan, message);
	}

	logAction(action, username) {
		const now = new Date();
		const last = this.users[username];
		const chat = this.messages
			.map( ([t, u, m]) => `${(username===u)?"*":" "} ${pad(Math.round((now - t)/1000), 2)}s ago  ${pad(u, 25)}:  ${m}`)
			.join(newline);

		const name = `log${moment(now).tz(this.timezone).format("YYYYMMDD_HHmmss")}.txt`;
		const log  = Buffer.from(
			util.format(log_template,
				this.chan,
				moment(now).tz(this.timezone).format("MMMM Do YYYY, HH:mm:ss z"),
				action,
				[...this.moderators].join(", "),
				(last && this.messages[0] && this.messages[0][0] > last[0])
					? `* ${pad(Math.round((now - last[0])/1000), 2)}s ago  ${last[1]}`
					: chat
			),
			"utf8"
		);

		const target = discord.readyTime && discord.channels.get(this.discord_log);
		if (target)
			target.sendFile(log, name, `[${this.chan}] ${action}`).catch( (err) => {
				console.log(`[DISCORD] ${err.message || err}`);
				console.log(err.stack);
				console.error(log.toString());
			});
		else
			console.error(`[DISCORD] Channel unavailable ("${log.toString()}")`);
	}

	setCommand(cmd, opt) {
		if (!cmd.startsWith(commands.DELIM))
			cmd = commands.DELIM + cmd;

		const c = cmd.toLowerCase();
		if (this.commands[c])
			this.commands[c].stop();
		if (opt)
			return this.commands[c] = new commands.CustomCommand(this, cmd, opt);
		else
			delete this.commands[c];
	}

	command(cmd) {
		let c = cmd.toLowerCase();
		if (!c.startsWith(commands.DELIM))
			c = commands.DELIM + c;
		return this.commands[c];
	}
}

twitch.on("mods",  (chan, mods) => {TwitchChat.channel(chan).moderators = new Set(mods); });
twitch.on("mod",   (chan, mod)  => {TwitchChat.channel(chan).moderators.add(mod); });
twitch.on("unmod", (chan, mod)  => {TwitchChat.channel(chan).moderators.delete(mod); });

twitch.on("action", (chan, user, msg, self) => TwitchChat.channel(chan).onMessage(user, msg, self));
twitch.on("chat",   (chan, user, msg, self) => TwitchChat.channel(chan).onMessage(user, msg, self));
twitch.on("notice", (chan, id, msg) => console.log(`[TWITCH] notice: ${chan} ${id} "${msg}"`));

twitch.on("clearchat", (chan) => TwitchChat.channel(chan).onClear());

twitch.on("ban",     (chan, user, reason)      => TwitchChat.channel(chan).logAction(`${user} was banned (${reason || "No reason given"})`, user));
twitch.on("timeout", (chan, user, reason, len) => TwitchChat.channel(chan).logAction(`${user} was timed out for ${len} second${len===1?"":"s"} (${reason || "No reason given"})`, user));
twitch.on("clearchat",   (chan)                => TwitchChat.channel(chan).logAction("Chat was cleared"));
twitch.on("emoteonly",   (chan, on)            => TwitchChat.channel(chan).logAction(`Emote-only mode ${on?"enabled":"disabled"}`));
twitch.on("r9kbeta",     (chan, on)            => TwitchChat.channel(chan).logAction(`R9K mode ${on?"enabled":"disabled"}`));
twitch.on("slowmode",    (chan, on, wait)      => TwitchChat.channel(chan).logAction(`Slow mode ${on?"enabled":"disabled"} (${wait} second${wait===1?"":"s"} cooldown)`));
twitch.on("subscribers", (chan, on)            => TwitchChat.channel(chan).logAction(`Subscribers mode ${on?"enabled":"disabled"}`));

twitch.on("whisper", (frm, user, msg, self) => {
	if (self || !twitch_owners.has(user.username)) return;
	const [cmd, ...args] = msg.split(/\s+/);
	const command = commands.GLOBALS[cmd.toLowerCase()];
	if (command) {
		const chat = twitch_chat[(args[0]||"").toLowerCase()];
		(new command(chat, cmd)).execute((s) => twitch.whisper(frm, s), commands.USER_LEVEL.BOT_OWNER, chat?args.slice(1):args);
	} else {
		twitch.whisper(frm, "Invalid command.")
	}
});

twitch.on("connecting",   (addr, port) => console.log(`Connecting to Twitch (${addr}:${port})`));
twitch.on("connected",    (addr, port) => console.log(`Connected to Twitch (${addr}:${port})`));
twitch.on("logon",        ()           => console.log(`Logged in to Twitch.`));
twitch.on("disconnected", (reason)     => console.log(`Disconnected from Twitch (${reason})`));
twitch.on("reconnect",    ()           => console.log("Reconnecting to Twitch"));

discord.on("message", (m) => {
	if (m.author.bot || m.channel.type !== "text" || !m.content.startsWith(commands.DELIM))
		return;

	const chat = discord_chat[m.guild.id];
	if (!chat || chat.size < 1) return;

	const [cmd, ...args] = m.content.split(/\s+/);
	const user  = `${m.author.username}#${m.author.discriminator}`;
	const roles = [...m.member.roles.values()];

	chat.forEach( (c) => {
		const command = c.command(cmd);
		if (!command) return;

		const user_level = (
			discord_owners.has(user)                       ? commands.USER_LEVEL.BOT_OWNER :
			m.member.hasPermission("ADMINISTRATOR")        ? commands.USER_LEVEL.CHANNEL_OWNER :
			roles.some( (r) => r.name === c.discord_mods)  ? commands.USER_LEVEL.CHANNEL_MOD :
			                                                 commands.USER_LEVEL.USER
		);
		command.execute((s) => m.channel.sendMessage(`[${c.chan}] ${s}`), user_level, args);
	});
});

discord.on("ready",        ()    => console.log(`Connected to Discord`));
discord.on("reconnecting", ()    => console.log(`Reconnecting to Discord`));
discord.on("error",        (err) => console.log(`[DISCORD] ${err.message}`));

let twitch_conn  = twitch.connect();
let discord_conn = discord.login(config.discord.identity.token || config.discord.identity.email, config.discord.identity.password);

Promise.all([twitch_conn, discord_conn]).then( () => {
	for (let c in config.channels)
		TwitchChat.join(c, config.channels[c]);
}).catch( (err) => {
	console.log(`Error connection / loading config (${err.message || err}).`)
	console.log(err.stack);
});

const twitch_chat_clear = setInterval(() => {
	const threshold = new Date() - 80000;
	TwitchChat.channels.forEach( (c) => c.truncateMessages(threshold) );
}, 15000);

const config_save_clear = function() {
	let last = "";
	return setInterval(() => {
		config.channels = TwitchChat.serialize();
		const conf = JSON.stringify(config, undefined, "\t");
		if (last !== conf) {
			last = conf;
			fs.writeFile("./config.json", conf, (err) => {
				if (err) error(err);
				console.log("Updated config.json");
			});
		}
	}, 60000);
}();

process.on("SIGINT", () => {
	console.log("SIGINT received. Disconnecting..");
	clearInterval(twitch_chat_clear);
	clearInterval(config_save_clear);
	TwitchChat.channels.forEach( (c) => c.part() );
	twitch_conn.then(() => twitch.disconnect());
	discord_conn.then(() => discord.destroy());
});
